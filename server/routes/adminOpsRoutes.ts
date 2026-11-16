import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { db, UPLOAD_ROOT } from '../db.ts';
import { type AuthRequest, buildInviteLink, requireAuth, requireRole, writeAuditLog } from '../auth.ts';

const router = Router();

function buildModeratorCommonLink(baseUrl: string, accessKey: string): string {
  const clean = (baseUrl || '').trim().replace(/\/+$/, '');
  const sep = clean.includes('?') ? '&' : '/?';
  return `${clean}${sep}panel=moderator-login&mod_access=${encodeURIComponent(accessKey)}`;
}

function ensureSuperAdminAssigneeRow(userId: number): number | null {
  const existing = db.prepare('SELECT id FROM moderators WHERE user_id = ?').get(userId) as { id: number } | undefined;
  if (existing) return existing.id;

  const adminUser = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.mobile, u.created_at, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = ? AND r.name = 'super_admin' AND u.status = 'Active'`
    )
    .get(userId) as any;

  if (!adminUser) return null;

  const empCode = `IT-HEAD-${String(adminUser.id).padStart(3, '0')}`;
  const res = db
    .prepare(
      `INSERT INTO moderators (
        user_id, employee_code, full_name, email, phone, specialization, assigned_location_ids, date_of_joining, status, max_capacity
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 'Active', 50)`
    )
    .run(
      adminUser.id,
      empCode,
      adminUser.full_name,
      adminUser.email,
      adminUser.mobile || 'IT Head Desk',
      'Super Admin / IT Head Escalations',
      (adminUser.created_at || new Date().toISOString()).slice(0, 10)
    );
  return Number(res.lastInsertRowid);
}

const invoiceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
      cb(null, `inv-${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// --- REFERENCE DATA: Locations, Departments, Vendors ---
router.get('/locations', requireAuth, (_req, res) => {
  const locations = db.prepare('SELECT * FROM locations ORDER BY name ASC').all();
  res.json({ locations });
});

router.post('/locations', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const { code, name, type, city, state, address, manager_name } = req.body;
  if (!code || !name || !city || !state || !address) {
    return res.status(400).json({ error: 'Code, name, city, state, and address are required' });
  }
  try {
    const r = db
      .prepare('INSERT INTO locations (code, name, type, city, state, address, manager_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(code.trim(), name.trim(), type || 'Warehouse', city.trim(), state.trim(), address.trim(), manager_name || '');
    writeAuditLog({
      userId: req.user!.id,
      userEmail: req.user!.email,
      roleName: req.user!.role,
      action: 'CREATE_LOCATION',
      entityType: 'location',
      entityId: String(r.lastInsertRowid),
      details: { code, name },
      ipAddress: req.ip,
    });
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/departments', requireAuth, (_req, res) => {
  const departments = db.prepare('SELECT * FROM departments ORDER BY name ASC').all();
  res.json({ departments });
});

router.get('/vendors', requireAuth, (_req, res) => {
  const vendors = db.prepare('SELECT * FROM vendors ORDER BY name ASC').all();
  res.json({ vendors });
});

router.post('/vendors', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const { name, category, contact_person, phone, email, tax_id, address } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'Vendor name and category required' });
  const r = db
    .prepare('INSERT INTO vendors (name, category, contact_person, phone, email, tax_id, address) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, category, contact_person || '', phone || '', email || '', tax_id || '', address || '');
  res.status(201).json({ id: r.lastInsertRowid });
});

// --- EMPLOYEES & USER ACCOUNTS ---
router.get('/employees', requireAuth, requireRole('super_admin', 'management'), (req: AuthRequest, res) => {
  const isAdmin = req.user!.role === 'super_admin';
  const employees = db
    .prepare(
      `SELECT e.*,
              d.name as department_name,
              l.name as location_name,
              l.city as location_city,
              u.status as account_status,
              COALESCE(e.last_login_at, u.last_login_at) as last_login_at,
              COALESCE(e.last_login_ip, u.last_login_ip) as last_login_ip,
              MAX(COALESCE(e.login_count, 0), (SELECT COUNT(*) FROM login_sessions ls WHERE ls.user_id = e.user_id)) as login_count,
              (SELECT ls.user_agent FROM login_sessions ls WHERE ls.user_id = e.user_id ORDER BY ls.id DESC LIMIT 1) as last_user_agent,
              (SELECT COUNT(*) FROM login_sessions ls WHERE ls.user_id = e.user_id AND ls.is_active = 1) as active_sessions,
              u.must_reset_password,
              r.name as role_name,
              ${isAdmin ? 'u.invite_token, u.invited_link_base, u.invite_expires_at,' : ''}
              (SELECT COUNT(*) FROM tickets t WHERE t.employee_id = e.id OR (e.user_id IS NOT NULL AND t.created_by_user_id = e.user_id)) as ticket_count,
              (SELECT COUNT(*) FROM tickets t WHERE (t.employee_id = e.id OR (e.user_id IS NOT NULL AND t.created_by_user_id = e.user_id)) AND t.status NOT IN ('Completed','Resolved','Closed')) as open_ticket_count,
              (SELECT COUNT(*) FROM tickets t WHERE (t.employee_id = e.id OR (e.user_id IS NOT NULL AND t.created_by_user_id = e.user_id)) AND t.status IN ('Completed','Resolved','Closed')) as resolved_ticket_count,
              (SELECT t.ticket_number FROM tickets t WHERE t.employee_id = e.id OR (e.user_id IS NOT NULL AND t.created_by_user_id = e.user_id) ORDER BY t.id DESC LIMIT 1) as latest_ticket_number,
              (SELECT t.created_at FROM tickets t WHERE t.employee_id = e.id OR (e.user_id IS NOT NULL AND t.created_by_user_id = e.user_id) ORDER BY t.id DESC LIMIT 1) as latest_ticket_at
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN locations l ON e.location_id = l.id
       LEFT JOIN users u ON e.user_id = u.id
       LEFT JOIN roles r ON u.role_id = r.id
       ORDER BY COALESCE(e.last_login_at, u.last_login_at, e.created_at) DESC, e.full_name ASC`
    )
    .all();
  res.json({ employees });
});

router.get('/employees/:id/details', requireAuth, requireRole('super_admin', 'management'), (req: AuthRequest, res) => {
  const empId = Number(req.params.id);
  const employee = db
    .prepare(
      `SELECT e.*, d.name as department_name, l.name as location_name, l.city as location_city,
              u.status as account_status, COALESCE(e.last_login_at, u.last_login_at) as last_login_at,
              COALESCE(e.last_login_ip, u.last_login_ip) as last_login_ip, r.name as role_name
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN locations l ON e.location_id = l.id
       LEFT JOIN users u ON e.user_id = u.id
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE e.id = ?`
    )
    .get(empId) as any;

  if (!employee) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  const sessions = employee.user_id
    ? db
        .prepare(
          `SELECT * FROM login_sessions
           WHERE user_id = ?
           ORDER BY login_at DESC, id DESC
           LIMIT 100`
        )
        .all(employee.user_id)
    : [];

  const tickets = db
    .prepare(
      `SELECT t.*, l.name as location_name, m.full_name as moderator_name
       FROM tickets t
       LEFT JOIN locations l ON t.location_id = l.id
       LEFT JOIN moderators m ON t.assigned_moderator_id = m.id
       WHERE t.employee_id = ? OR (? IS NOT NULL AND t.created_by_user_id = ?)
       ORDER BY t.created_at DESC, t.id DESC`
    )
    .all(empId, employee.user_id ?? null, employee.user_id ?? null);

  res.json({ employee, sessions, tickets });
});

router.post('/employees', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const {
    employee_code,
    full_name,
    department_id,
    designation,
    mobile,
    email,
    location_id,
    reporting_manager,
    password,
    role_name,
    portal_url,
  } = req.body;

  if (!employee_code || !full_name || !email || !designation || !mobile) {
    return res.status(400).json({ error: 'Employee code, name, email, designation, and mobile are required' });
  }

  const targetRole = role_name === 'management' ? 'management' : 'employee';
  const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(targetRole) as { id: number };
  const rawPassword = typeof password === 'string' && password.trim() ? password.trim() : crypto.randomBytes(16).toString('hex');
  const hash = bcrypt.hashSync(rawPassword, 10);
  const mustReset = typeof password === 'string' && password.trim() ? 0 : 1;
  const inviteToken = crypto.randomBytes(24).toString('hex');
  const inviteExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const baseUrl = (portal_url || process.env.APP_URL || `${req.protocol}://${req.get('host')}`).trim().replace(/\/+$/, '');

  try {
    const tx = db.transaction(() => {
      const uRes = db
        .prepare(
          `INSERT INTO users (role_id, email, password_hash, full_name, status, must_reset_password, invite_token, invite_expires_at, invited_link_base)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          roleRow.id,
          email.trim().toLowerCase(),
          hash,
          full_name.trim(),
          'Active',
          mustReset,
          inviteToken,
          inviteExpires,
          baseUrl
        );

      const eRes = db
        .prepare(
          `INSERT INTO employees (user_id, employee_code, full_name, department_id, designation, mobile, email, location_id, reporting_manager)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          uRes.lastInsertRowid,
          employee_code.trim(),
          full_name.trim(),
          department_id ? Number(department_id) : null,
          designation.trim(),
          mobile.trim(),
          email.trim().toLowerCase(),
          location_id ? Number(location_id) : null,
          reporting_manager || ''
        );
      return { employeeId: Number(eRes.lastInsertRowid), userId: Number(uRes.lastInsertRowid) };
    });
    const { employeeId, userId } = tx();
    const loginLink = buildInviteLink(baseUrl, inviteToken);
    writeAuditLog({
      userId: req.user!.id,
      userEmail: req.user!.email,
      roleName: req.user!.role,
      action: 'CREATE_EMPLOYEE',
      entityType: 'employee',
      entityId: String(employeeId),
      details: { employee_code, email, role: targetRole, invited_link_base: baseUrl },
      ipAddress: req.ip,
    });
    res.status(201).json({ id: employeeId, user_id: userId, invite_token: inviteToken, login_link: loginLink });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Bulk CSV/JSON Import of Employees
router.post('/employees/import', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const { rows } = req.body as {
    rows: Array<{
      employee_code: string;
      full_name: string;
      email: string;
      mobile: string;
      designation: string;
      department?: string;
      location_code?: string;
      reporting_manager?: string;
    }>;
  };
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No employee rows provided for import' });
  }
  const roleRow = db.prepare("SELECT id FROM roles WHERE name = 'employee'").get() as { id: number };
  const defaultHash = bcrypt.hashSync('LogiCore@2026', 10);

  let imported = 0;
  const skipped: string[] = [];

  for (const r of rows) {
    if (!r.employee_code || !r.email || !r.full_name) {
      skipped.push(r.email || r.employee_code || 'Missing fields');
      continue;
    }
    const existing = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(r.email.trim());
    if (existing) {
      skipped.push(`${r.email} (already exists)`);
      continue;
    }
    const dept = r.department
      ? (db.prepare('SELECT id FROM departments WHERE lower(name) = lower(?)').get(r.department.trim()) as { id: number } | undefined)
      : undefined;
    const loc = r.location_code
      ? (db.prepare('SELECT id FROM locations WHERE lower(code) = lower(?) OR lower(name) = lower(?)').get(r.location_code.trim(), r.location_code.trim()) as { id: number } | undefined)
      : undefined;

    const uRes = db
      .prepare('INSERT INTO users (role_id, email, password_hash, full_name, status, must_reset_password) VALUES (?, ?, ?, ?, ?, 1)')
      .run(roleRow.id, r.email.trim().toLowerCase(), defaultHash, r.full_name.trim(), 'Active');

    db.prepare(
      `INSERT INTO employees (user_id, employee_code, full_name, department_id, designation, mobile, email, location_id, reporting_manager)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uRes.lastInsertRowid,
      r.employee_code.trim(),
      r.full_name.trim(),
      dept?.id ?? null,
      r.designation || 'Logistics Staff',
      r.mobile || 'N/A',
      r.email.trim().toLowerCase(),
      loc?.id ?? null,
      r.reporting_manager || ''
    );
    imported++;
  }

  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'BULK_IMPORT_EMPLOYEES',
    entityType: 'employee',
    details: { imported, skipped_count: skipped.length },
    ipAddress: req.ip,
  });

  res.json({ imported, skipped });
});

router.patch('/users/:userId/status', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const userId = Number(req.params.userId);
  const { status } = req.body as { status: 'Active' | 'Inactive' };
  if (!['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
  db.prepare('UPDATE moderators SET status = ? WHERE user_id = ?').run(status, userId);
  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'TOGGLE_USER_STATUS',
    entityType: 'user',
    entityId: String(userId),
    details: { status },
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

router.delete('/users/:userId', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const userId = Number(req.params.userId);
  if (userId === req.user!.id) {
    return res.status(400).json({ error: 'Cannot delete currently signed-in Super Admin account' });
  }
  const hasTickets = (
    db.prepare('SELECT COUNT(*) as c FROM tickets WHERE created_by_user_id = ?').get(userId) as { c: number }
  ).c;
  if (hasTickets > 0) {
    return res.status(400).json({
      error: 'User has submitted tickets in immutable audit history. Deactivate the account instead of deleting.',
    });
  }
  try {
    db.transaction(() => {
      db.prepare('UPDATE tickets SET assigned_moderator_id = NULL WHERE assigned_moderator_id IN (SELECT id FROM moderators WHERE user_id = ?)').run(userId);
      db.prepare('UPDATE tickets SET admin_verified_by = NULL WHERE admin_verified_by = ?').run(userId);
      db.prepare('DELETE FROM moderators WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM employees WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    })();
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Cannot delete user due to existing historical records' });
  }
  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'DELETE_USER',
    entityType: 'user',
    entityId: String(userId),
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

router.post('/users/:userId/invite-link', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const userId = Number(req.params.userId);
  const { portal_url } = req.body as { portal_url?: string };
  const targetUser = db.prepare('SELECT id, email, full_name, invited_link_base FROM users WHERE id = ?').get(userId) as any;
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  const inviteToken = crypto.randomBytes(24).toString('hex');
  const inviteExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const baseUrl = (portal_url || targetUser.invited_link_base || process.env.APP_URL || `${req.protocol}://${req.get('host')}`)
    .trim()
    .replace(/\/+$/, '');

  db.prepare('UPDATE users SET invite_token = ?, invite_expires_at = ?, invited_link_base = ? WHERE id = ?').run(
    inviteToken,
    inviteExpires,
    baseUrl,
    userId
  );

  const loginLink = buildInviteLink(baseUrl, inviteToken);
  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'GENERATE_USER_INVITE_LINK',
    entityType: 'user',
    entityId: String(userId),
    details: { target_email: targetUser.email, base_url: baseUrl },
    ipAddress: req.ip,
  });

  res.json({ invite_token: inviteToken, login_link: loginLink, expires_at: inviteExpires });
});

// --- MODERATORS & PERFORMANCE ---
// Common Moderator Portal Access Link (Super Admin ONLY)
router.get('/moderators/common-access-link', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const row = db.prepare("SELECT value_json, updated_at FROM integration_settings WHERE key = 'moderator_common_portal'").get() as
    | { value_json: string; updated_at: string }
    | undefined;

  let cfg: { access_key: string; base_url?: string } | null = null;
  if (row) {
    try {
      cfg = JSON.parse(row.value_json);
    } catch {
      cfg = null;
    }
  }

  const defaultBase = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).trim().replace(/\/+$/, '');
  if (!cfg || !cfg.access_key) {
    const accessKey = crypto.randomBytes(16).toString('hex');
    cfg = { access_key: accessKey, base_url: defaultBase };
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO integration_settings (key, value_json, updated_by, updated_at)
       VALUES ('moderator_common_portal', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    ).run(JSON.stringify(cfg), req.user!.id, nowIso);
    return res.json({
      access_key: accessKey,
      base_url: defaultBase,
      login_link: buildModeratorCommonLink(defaultBase, accessKey),
      updated_at: nowIso,
    });
  }

  const baseUrl = (cfg.base_url || defaultBase).trim().replace(/\/+$/, '');
  res.json({
    access_key: cfg.access_key,
    base_url: baseUrl,
    login_link: buildModeratorCommonLink(baseUrl, cfg.access_key),
    updated_at: row?.updated_at || null,
  });
});

router.post('/moderators/common-access-link', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const { portal_url } = req.body as { portal_url?: string };
  const baseUrl = (portal_url || process.env.APP_URL || `${req.protocol}://${req.get('host')}`).trim().replace(/\/+$/, '');
  const accessKey = crypto.randomBytes(16).toString('hex');
  const nowIso = new Date().toISOString();
  const payload = { access_key: accessKey, base_url: baseUrl };

  db.prepare(
    `INSERT INTO integration_settings (key, value_json, updated_by, updated_at)
     VALUES ('moderator_common_portal', ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(JSON.stringify(payload), req.user!.id, nowIso);

  const loginLink = buildModeratorCommonLink(baseUrl, accessKey);
  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'GENERATE_COMMON_MODERATOR_LINK',
    entityType: 'auth',
    entityId: 'moderator_common_portal',
    details: { base_url: baseUrl },
    ipAddress: req.ip,
  });

  res.json({
    access_key: accessKey,
    base_url: baseUrl,
    login_link: loginLink,
    updated_at: nowIso,
  });
});

router.get('/moderators', requireAuth, (req: AuthRequest, res) => {
  const user = req.user!;
  const isAdmin = user.role === 'super_admin';
  const includeSuperAdmin = req.query.include_super_admin === '1' && user.role !== 'moderator';
  const period = (req.query.period as string) || 'monthly'; // daily, weekly, monthly, all
  let dateFilter = '';
  if (period === 'daily') dateFilter = "AND date(t.created_at) = date('now')";
  else if (period === 'weekly') dateFilter = "AND datetime(t.created_at) >= datetime('now', '-7 days')";
  else if (period === 'monthly') dateFilter = "AND datetime(t.created_at) >= datetime('now', '-30 days')";

  if (includeSuperAdmin && isAdmin) {
    ensureSuperAdminAssigneeRow(user.id);
  }

  // Moderators must NOT view other moderators' private performance metrics
  const whereClauses: string[] = [];
  const modParams: any[] = [];
  if (user.role === 'moderator') {
    whereClauses.push('m.id = ?');
    modParams.push(user.moderator_id ?? -1);
  } else if (includeSuperAdmin) {
    whereClauses.push("r.name IN ('moderator', 'super_admin')");
  } else {
    whereClauses.push("r.name = 'moderator'");
  }
  const modWhere = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const mods = db
    .prepare(
      `SELECT m.*,
              r.name as assignee_role,
              u.last_login_at,
              u.must_reset_password,
              ${isAdmin ? 'u.invite_token, u.invite_expires_at, u.invited_link_base,' : ''}
              (SELECT COUNT(*) FROM tickets t WHERE t.assigned_moderator_id = m.id AND t.status NOT IN ('Completed','Resolved','Closed')) as current_workload,
              (SELECT COUNT(*) FROM tickets t WHERE t.assigned_moderator_id = m.id ${dateFilter}) as total_assigned,
              (SELECT COUNT(*) FROM tickets t WHERE t.assigned_moderator_id = m.id AND t.status IN ('Completed','Resolved','Closed') ${dateFilter}) as resolved_tickets,
              (SELECT COUNT(*) FROM tickets t WHERE t.assigned_moderator_id = m.id AND t.status NOT IN ('Completed','Resolved','Closed') ${dateFilter}) as pending_tickets,
              (SELECT COUNT(*) FROM tickets t WHERE t.assigned_moderator_id = m.id AND t.status IN ('Reopened','Revision Required') ${dateFilter}) as reopened_tickets,
              (SELECT COUNT(*) FROM tickets t WHERE t.assigned_moderator_id = m.id AND t.sla_breached = 1 AND t.status NOT IN ('Completed','Resolved','Closed') ${dateFilter}) as overdue_tickets,
              (SELECT ROUND(AVG((julianday(t.resolved_at) - julianday(t.created_at)) * 24), 1) FROM tickets t WHERE t.assigned_moderator_id = m.id AND t.resolved_at IS NOT NULL ${dateFilter}) as avg_resolution_hours,
              (SELECT ROUND(AVG((julianday(t.first_response_at) - julianday(t.created_at)) * 1440), 0) FROM tickets t WHERE t.assigned_moderator_id = m.id AND t.first_response_at IS NOT NULL ${dateFilter}) as avg_first_response_mins,
              (SELECT COALESCE(SUM(ttl.duration_minutes), 0) FROM ticket_time_logs ttl WHERE ttl.moderator_id = m.id) as total_working_minutes,
              ${isAdmin ? '(SELECT COUNT(*) FROM audit_logs al WHERE al.user_id = m.user_id) as tracked_action_count,' : '0 as tracked_action_count,'}
              ${isAdmin ? '(SELECT MAX(al.created_at) FROM audit_logs al WHERE al.user_id = m.user_id) as last_activity_at' : 'NULL as last_activity_at'}
       FROM moderators m
       JOIN users u ON m.user_id = u.id
       JOIN roles r ON u.role_id = r.id
       ${modWhere}
       ORDER BY CASE WHEN r.name = 'super_admin' THEN 0 ELSE 1 END, m.full_name ASC`
    )
    .all(...modParams) as any[];

  const locations = db.prepare('SELECT id, name, code FROM locations').all() as { id: number; name: string; code: string }[];
  const locMap = new Map(locations.map((l) => [l.id, `${l.name} (${l.code})`]));

  const enriched = mods.map((m) => {
    let locIds: number[] = [];
    try {
      locIds = JSON.parse(m.assigned_location_ids || '[]');
    } catch {
      locIds = [];
    }
    return {
      ...m,
      assigned_location_ids: locIds,
      assigned_location_names: locIds.map((id) => locMap.get(id)).filter(Boolean),
    };
  });

  res.json({ moderators: enriched });
});

router.post('/moderators', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const {
    employee_code,
    full_name,
    email,
    phone,
    specialization,
    assigned_location_ids,
    date_of_joining,
    max_capacity,
    password,
    portal_url,
  } = req.body;

  if (!employee_code || !full_name || !email || !phone || !specialization) {
    return res.status(400).json({ error: 'All moderator profile fields are required' });
  }

  const assignedPassword = typeof password === 'string' ? password.trim() : '';
  if (assignedPassword.length < 8) {
    return res.status(400).json({
      error: 'Super Admin must assign a password of at least 8 characters for each moderator.',
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existingEmail = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(normalizedEmail);
  if (existingEmail) {
    return res.status(400).json({ error: 'A user account with this email ID already exists. Assign a unique email ID.' });
  }

  const existingCode = db
    .prepare('SELECT id FROM moderators WHERE lower(employee_code) = lower(?)')
    .get(employee_code.trim());
  if (existingCode) {
    return res.status(400).json({ error: 'A moderator with this Employee ID already exists.' });
  }

  const roleRow = db.prepare("SELECT id FROM roles WHERE name = 'moderator'").get() as { id: number };
  const hash = bcrypt.hashSync(assignedPassword, 10);
  const inviteToken = crypto.randomBytes(24).toString('hex');
  const inviteExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const baseUrl = (portal_url || process.env.APP_URL || `${req.protocol}://${req.get('host')}`).trim().replace(/\/+$/, '');

  try {
    const tx = db.transaction(() => {
      const uRes = db
        .prepare(
          `INSERT INTO users (role_id, email, password_hash, full_name, status, must_reset_password, invite_token, invite_expires_at, invited_link_base)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
        )
        .run(
          roleRow.id,
          normalizedEmail,
          hash,
          full_name.trim(),
          'Active',
          inviteToken,
          inviteExpires,
          baseUrl
        );

      const mRes = db
        .prepare(
          `INSERT INTO moderators (user_id, employee_code, full_name, email, phone, specialization, assigned_location_ids, date_of_joining, max_capacity)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          uRes.lastInsertRowid,
          employee_code.trim(),
          full_name.trim(),
          normalizedEmail,
          phone.trim(),
          specialization.trim(),
          JSON.stringify(assigned_location_ids || []),
          date_of_joining || new Date().toISOString().slice(0, 10),
          Number(max_capacity) || 10
        );
      return { moderatorId: Number(mRes.lastInsertRowid), userId: Number(uRes.lastInsertRowid) };
    });
    const { moderatorId, userId } = tx();
    const loginLink = buildInviteLink(baseUrl, inviteToken);
    writeAuditLog({
      userId: req.user!.id,
      userEmail: req.user!.email,
      roleName: req.user!.role,
      action: 'CREATE_MODERATOR',
      entityType: 'moderator',
      entityId: String(moderatorId),
      details: { email: normalizedEmail, specialization, invited_link_base: baseUrl },
      ipAddress: req.ip,
    });
    res.status(201).json({
      id: moderatorId,
      user_id: userId,
      email: normalizedEmail,
      invite_token: inviteToken,
      login_link: loginLink,
      expires_at: inviteExpires,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Regenerate / update invite link for a moderator (Super Admin ONLY)
router.post('/moderators/:id/invite-link', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const modId = Number(req.params.id);
  const { portal_url } = req.body as { portal_url?: string };
  const mod = db
    .prepare(
      `SELECT m.*, u.invited_link_base FROM moderators m JOIN users u ON m.user_id = u.id WHERE m.id = ?`
    )
    .get(modId) as any;
  if (!mod) return res.status(404).json({ error: 'Moderator not found' });

  const inviteToken = crypto.randomBytes(24).toString('hex');
  const inviteExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const baseUrl = (portal_url || mod.invited_link_base || process.env.APP_URL || `${req.protocol}://${req.get('host')}`)
    .trim()
    .replace(/\/+$/, '');

  db.prepare('UPDATE users SET invite_token = ?, invite_expires_at = ?, invited_link_base = ? WHERE id = ?').run(
    inviteToken,
    inviteExpires,
    baseUrl,
    mod.user_id
  );

  const loginLink = buildInviteLink(baseUrl, inviteToken);
  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'GENERATE_MODERATOR_LOGIN_LINK',
    entityType: 'moderator',
    entityId: String(modId),
    details: { moderator_email: mod.email, base_url: baseUrl },
    ipAddress: req.ip,
  });

  res.json({ invite_token: inviteToken, login_link: loginLink, expires_at: inviteExpires });
});

// View full activity & session history of a specific moderator (STRICTLY Super Admin ONLY)
router.get('/moderators/:id/activities', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const modId = Number(req.params.id);
  const mod = db
    .prepare(
      `SELECT m.*, u.last_login_at, u.invite_token, u.invited_link_base, u.invite_expires_at, u.must_reset_password
       FROM moderators m
       JOIN users u ON m.user_id = u.id
       WHERE m.id = ?`
    )
    .get(modId) as any;
  if (!mod) return res.status(404).json({ error: 'Moderator not found' });

  const sessions = db
    .prepare(
      `SELECT ls.*, u.full_name, u.email
       FROM login_sessions ls
       JOIN users u ON ls.user_id = u.id
       WHERE ls.user_id = ?
       ORDER BY ls.login_at DESC
       LIMIT 100`
    )
    .all(mod.user_id) as any[];

  const activities = db
    .prepare(
      `SELECT * FROM audit_logs
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 300`
    )
    .all(mod.user_id) as any[];

  const ticketActivities = db
    .prepare(
      `SELECT ta.*, t.ticket_number, t.category, t.priority
       FROM ticket_activities ta
       JOIN tickets t ON ta.ticket_id = t.id
       WHERE ta.actor_user_id = ?
       ORDER BY ta.created_at DESC, ta.id DESC
       LIMIT 200`
    )
    .all(mod.user_id) as any[];

  const timeLogs = db
    .prepare(
      `SELECT ttl.*, t.ticket_number, t.category
       FROM ticket_time_logs ttl
       JOIN tickets t ON ttl.ticket_id = t.id
       WHERE ttl.moderator_id = ?
       ORDER BY ttl.started_at DESC
       LIMIT 150`
    )
    .all(mod.id) as any[];

  const totalTimeLogged = timeLogs.reduce((acc, item) => acc + (Number(item.duration_minutes) || 0), 0);

  res.json({
    moderator: mod,
    sessions,
    activities,
    ticketActivities,
    timeLogs,
    summary: {
      total_actions: activities.length,
      total_sessions: sessions.length,
      active_sessions: sessions.filter((s) => s.is_active === 1).length,
      total_time_logged_mins: totalTimeLogged,
      last_activity_at: activities[0]?.created_at || sessions[0]?.last_activity_at || mod.last_login_at || null,
    },
  });
});

router.put('/moderators/:id', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const modId = Number(req.params.id);
  const {
    full_name,
    email,
    new_password,
    phone,
    specialization,
    assigned_location_ids,
    status,
    max_capacity,
    performance_rating,
  } = req.body;
  const mod = db.prepare('SELECT * FROM moderators WHERE id = ?').get(modId) as any;
  if (!mod) return res.status(404).json({ error: 'Moderator not found' });

  let nextEmail: string | null = null;
  if (typeof email === 'string' && email.trim() && email.trim().toLowerCase() !== mod.email.toLowerCase()) {
    nextEmail = email.trim().toLowerCase();
    const dup = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?').get(nextEmail, mod.user_id);
    if (dup) {
      return res.status(400).json({ error: 'Another user account already uses this email ID.' });
    }
  }

  let nextPasswordHash: string | null = null;
  if (typeof new_password === 'string' && new_password.trim().length > 0) {
    if (new_password.trim().length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    nextPasswordHash = bcrypt.hashSync(new_password.trim(), 10);
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE moderators
       SET full_name = COALESCE(?, full_name),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone),
           specialization = COALESCE(?, specialization),
           assigned_location_ids = COALESCE(?, assigned_location_ids),
           status = COALESCE(?, status),
           max_capacity = COALESCE(?, max_capacity),
           performance_rating = COALESCE(?, performance_rating)
       WHERE id = ?`
    ).run(
      full_name ?? null,
      nextEmail,
      phone ?? null,
      specialization ?? null,
      assigned_location_ids ? JSON.stringify(assigned_location_ids) : null,
      status ?? null,
      max_capacity ? Number(max_capacity) : null,
      performance_rating ? Number(performance_rating) : null,
      modId
    );

    if (status) {
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, mod.user_id);
    }
    if (full_name) {
      db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(full_name, mod.user_id);
    }
    if (nextEmail) {
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(nextEmail, mod.user_id);
    }
    if (nextPasswordHash) {
      db.prepare('UPDATE users SET password_hash = ?, must_reset_password = 0 WHERE id = ?').run(
        nextPasswordHash,
        mod.user_id
      );
    }
  })();

  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'UPDATE_MODERATOR',
    entityType: 'moderator',
    entityId: String(modId),
    details: {
      email_updated: Boolean(nextEmail),
      password_updated: Boolean(nextPasswordHash),
      status: status || undefined,
    },
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// --- IT ASSETS & MAINTENANCE ---
router.get('/assets', requireAuth, (_req, res) => {
  const assets = db
    .prepare(
      `SELECT a.*, l.name as location_name, l.code as location_code, e.full_name as assigned_employee_name,
              (SELECT COUNT(*) FROM tickets t WHERE t.asset_id = a.id) as linked_tickets,
              (SELECT COALESCE(SUM(am.cost), 0) FROM asset_maintenance am WHERE am.asset_id = a.id) as total_maintenance_cost
       FROM it_assets a
       LEFT JOIN locations l ON a.location_id = l.id
       LEFT JOIN employees e ON a.assigned_employee_id = e.id
       ORDER BY a.asset_tag ASC`
    )
    .all();
  res.json({ assets });
});

router.post('/assets', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const {
    asset_tag,
    serial_number,
    category,
    brand,
    model,
    purchase_date,
    purchase_cost,
    warranty_expiry,
    assigned_employee_id,
    location_id,
    condition_status,
    notes,
  } = req.body;
  if (!asset_tag || !serial_number || !category || !brand || !model || !purchase_date) {
    return res.status(400).json({ error: 'Asset tag, serial number, category, brand, model, and purchase date are required' });
  }
  try {
    const r = db
      .prepare(
        `INSERT INTO it_assets (asset_tag, serial_number, category, brand, model, purchase_date, purchase_cost, warranty_expiry, assigned_employee_id, location_id, condition_status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        asset_tag.trim(),
        serial_number.trim(),
        category,
        brand.trim(),
        model.trim(),
        purchase_date,
        Number(purchase_cost) || 0,
        warranty_expiry || null,
        assigned_employee_id ? Number(assigned_employee_id) : null,
        location_id ? Number(location_id) : null,
        condition_status || 'Operational',
        notes || ''
      );
    writeAuditLog({
      userId: req.user!.id,
      userEmail: req.user!.email,
      roleName: req.user!.role,
      action: 'CREATE_ASSET',
      entityType: 'asset',
      entityId: asset_tag,
      ipAddress: req.ip,
    });
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/assets/:id', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const assetId = Number(req.params.id);
  const { condition_status, location_id, assigned_employee_id, notes } = req.body;
  const hasAssignedEmployee = assigned_employee_id !== undefined ? 1 : 0;
  db.prepare(
    `UPDATE it_assets
     SET condition_status = COALESCE(?, condition_status),
         location_id = COALESCE(?, location_id),
         assigned_employee_id = CASE WHEN ? = 1 THEN ? ELSE assigned_employee_id END,
         notes = COALESCE(?, notes)
     WHERE id = ?`
  ).run(
    condition_status ?? null,
    location_id ? Number(location_id) : null,
    hasAssignedEmployee,
    assigned_employee_id ? Number(assigned_employee_id) : null,
    notes ?? null,
    assetId
  );
  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'UPDATE_ASSET',
    entityType: 'asset',
    entityId: String(assetId),
    details: { condition_status, location_id, notes },
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

router.get('/assets/:id/maintenance', requireAuth, (req, res) => {
  const assetId = Number(req.params.id);
  const maintenance = db
    .prepare(
      `SELECT am.*, v.name as vendor_name, t.ticket_number
       FROM asset_maintenance am
       LEFT JOIN vendors v ON am.vendor_id = v.id
       LEFT JOIN tickets t ON am.ticket_id = t.id
       WHERE am.asset_id = ?
       ORDER BY am.performed_at DESC`
    )
    .all(assetId);
  const linkedTickets = db
    .prepare('SELECT id, ticket_number, category, priority, status, created_at FROM tickets WHERE asset_id = ? ORDER BY created_at DESC')
    .all(assetId);
  res.json({ maintenance, linkedTickets });
});

router.post('/assets/:id/maintenance', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const assetId = Number(req.params.id);
  const { ticket_id, maintenance_type, description, vendor_id, cost, performed_at, performed_by } = req.body;
  if (!description || !maintenance_type) {
    return res.status(400).json({ error: 'Maintenance type and description are required' });
  }
  const r = db
    .prepare(
      `INSERT INTO asset_maintenance (asset_id, ticket_id, maintenance_type, description, vendor_id, cost, performed_at, performed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      assetId,
      ticket_id ? Number(ticket_id) : null,
      maintenance_type,
      description,
      vendor_id ? Number(vendor_id) : null,
      Number(cost) || 0,
      performed_at || new Date().toISOString().slice(0, 10),
      performed_by || req.user!.full_name
    );
  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'LOG_ASSET_MAINTENANCE',
    entityType: 'asset',
    entityId: String(assetId),
    details: { maintenance_type, cost: Number(cost) || 0, description },
    ipAddress: req.ip,
  });
  res.status(201).json({ id: r.lastInsertRowid });
});

// --- IT BUDGETS & EXPENSES ---
router.get('/budgets', requireAuth, requireRole('super_admin', 'management'), (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const budgets = db
    .prepare(
      `SELECT b.*, l.name as location_name, l.code as location_code
       FROM it_budgets b
       LEFT JOIN locations l ON b.location_id = l.id
       WHERE b.fiscal_year = ?
       ORDER BY b.month ASC, b.location_id ASC`
    )
    .all(year);

  const expenses = db
    .prepare(
      `SELECT e.*, l.name as location_name, l.code as location_code, t.ticket_number,
              u.full_name as approved_by_name
       FROM expenses e
       LEFT JOIN locations l ON e.location_id = l.id
       LEFT JOIN tickets t ON e.ticket_id = t.id
       LEFT JOIN users u ON e.approved_by_user_id = u.id
       ORDER BY e.payment_date DESC, e.id DESC`
    )
    .all();

  const totalAnnualBudget =
    (
      db
        .prepare('SELECT allocated_amount FROM it_budgets WHERE fiscal_year = ? AND month = 0 AND location_id IS NULL')
        .get(year) as { allocated_amount: number } | undefined
    )?.allocated_amount || 0;

  const totalApprovedSpent =
    (
      db
        .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE approval_status = 'Approved'")
        .get() as { total: number }
    ).total || 0;

  const totalPendingSpent =
    (
      db
        .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE approval_status = 'Pending'")
        .get() as { total: number }
    ).total || 0;

  const locationSummary = db
    .prepare(
      `SELECT l.id as location_id, l.name as location_name, l.code as location_code,
              COALESCE((SELECT allocated_amount FROM it_budgets b WHERE b.location_id = l.id AND b.fiscal_year = ? AND b.month = 0 LIMIT 1), 0) as allocated,
              COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.location_id = l.id AND e.approval_status = 'Approved'), 0) as spent
       FROM locations l
       ORDER BY l.name ASC`
    )
    .all(year);

  res.json({
    year,
    budgets,
    expenses,
    summary: {
      totalAnnualBudget,
      totalApprovedSpent,
      totalPendingSpent,
      remainingBudget: Math.max(0, totalAnnualBudget - totalApprovedSpent),
      utilizationPct: totalAnnualBudget > 0 ? Math.round((totalApprovedSpent / totalAnnualBudget) * 1000) / 10 : 0,
    },
    locationSummary,
  });
});

router.post('/budgets', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const { fiscal_year, month, location_id, allocated_amount, notes } = req.body;
  if (!fiscal_year || allocated_amount === undefined) {
    return res.status(400).json({ error: 'Fiscal year and allocated amount are required' });
  }
  const r = db
    .prepare(
      `INSERT INTO it_budgets (fiscal_year, month, location_id, allocated_amount, notes, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(fiscal_year),
      Number(month) || 0,
      location_id ? Number(location_id) : null,
      Number(allocated_amount),
      notes || '',
      req.user!.id
    );
  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'CREATE_BUDGET',
    entityType: 'budget',
    entityId: String(r.lastInsertRowid),
    details: { fiscal_year, month, allocated_amount },
    ipAddress: req.ip,
  });
  res.status(201).json({ id: r.lastInsertRowid });
});

router.post('/expenses', requireAuth, requireRole('super_admin'), invoiceUpload.single('invoice'), (req: AuthRequest, res) => {
  const { category, ticket_id, vendor_id, vendor_name, location_id, amount, invoice_number, payment_date, description } = req.body;
  if (!category || !vendor_name || !amount || !invoice_number || !payment_date) {
    return res.status(400).json({ error: 'Category, vendor name, amount, invoice number, and payment date are required' });
  }
  const filePath = req.file ? req.file.filename : null;
  const approvalStatus = req.user!.role === 'super_admin' ? 'Approved' : 'Pending';
  const approvedBy = req.user!.role === 'super_admin' ? req.user!.id : null;

  const r = db
    .prepare(
      `INSERT INTO expenses (category, ticket_id, vendor_id, vendor_name, location_id, amount, invoice_number, invoice_attachment_path, payment_date, approval_status, approved_by_user_id, description, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      category,
      ticket_id ? Number(ticket_id) : null,
      vendor_id ? Number(vendor_id) : null,
      vendor_name.trim(),
      location_id ? Number(location_id) : null,
      Number(amount),
      invoice_number.trim(),
      filePath,
      payment_date,
      approvalStatus,
      approvedBy,
      description || '',
      req.user!.id
    );

  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'LOG_EXPENSE',
    entityType: 'expense',
    entityId: String(r.lastInsertRowid),
    details: { amount, invoice_number, category },
    ipAddress: req.ip,
  });

  res.status(201).json({ id: r.lastInsertRowid });
});

router.post('/expenses/:id/approve', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const expenseId = Number(req.params.id);
  const { decision, remarks } = req.body as { decision: 'Approved' | 'Rejected'; remarks?: string };
  if (!['Approved', 'Rejected'].includes(decision)) {
    return res.status(400).json({ error: 'Invalid decision' });
  }
  db.prepare('UPDATE expenses SET approval_status = ?, approved_by_user_id = ? WHERE id = ?').run(
    decision,
    req.user!.id,
    expenseId
  );
  db.prepare(
    'INSERT INTO expense_approvals (expense_id, approver_user_id, approver_name, decision, remarks) VALUES (?, ?, ?, ?, ?)'
  ).run(expenseId, req.user!.id, req.user!.full_name, decision, remarks || '');

  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'EXPENSE_APPROVAL',
    entityType: 'expense',
    entityId: String(expenseId),
    details: { decision, remarks },
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

router.get('/expenses/:id/invoice', requireAuth, requireRole('super_admin', 'management', 'moderator'), (req, res) => {
  const expense = db.prepare('SELECT invoice_attachment_path FROM expenses WHERE id = ?').get(Number(req.params.id)) as any;
  if (!expense?.invoice_attachment_path) return res.status(404).json({ error: 'Invoice attachment not found' });
  const filePath = path.join(UPLOAD_ROOT, expense.invoice_attachment_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Invoice file missing' });
  res.sendFile(filePath);
});

// --- SLA CONFIGURATIONS ---
router.get('/sla-configs', requireAuth, (_req, res) => {
  const configs = db.prepare('SELECT * FROM sla_configurations ORDER BY first_response_minutes ASC').all();
  res.json({ configs });
});

router.put('/sla-configs/:id', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { first_response_minutes, resolution_hours, working_hours_start, working_hours_end, holidays_json, auto_escalate, escalate_to_email } = req.body;
  db.prepare(
    `UPDATE sla_configurations
     SET first_response_minutes = COALESCE(?, first_response_minutes),
         resolution_hours = COALESCE(?, resolution_hours),
         working_hours_start = COALESCE(?, working_hours_start),
         working_hours_end = COALESCE(?, working_hours_end),
         holidays_json = COALESCE(?, holidays_json),
         auto_escalate = COALESCE(?, auto_escalate),
         escalate_to_email = COALESCE(?, escalate_to_email),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    first_response_minutes ? Number(first_response_minutes) : null,
    resolution_hours ? Number(resolution_hours) : null,
    working_hours_start ?? null,
    working_hours_end ?? null,
    holidays_json ?? null,
    auto_escalate !== undefined ? (auto_escalate ? 1 : 0) : null,
    escalate_to_email ?? null,
    id
  );
  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'UPDATE_SLA_CONFIG',
    entityType: 'sla_configuration',
    entityId: String(id),
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

// --- NOTIFICATIONS ---
router.get('/notifications', requireAuth, (req: AuthRequest, res) => {
  const notifications = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50')
    .all(req.user!.id);
  const unreadCount = (
    db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user!.id) as { c: number }
  ).c;
  res.json({ notifications, unreadCount });
});

router.post('/notifications/:id/read', requireAuth, (req: AuthRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user!.id);
  res.json({ ok: true });
});

router.post('/notifications/read-all', requireAuth, (req: AuthRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
  res.json({ ok: true });
});

export default router;
