import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const dataDir = path.resolve(process.cwd(), 'data');
const uploadsDir = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export const UPLOAD_ROOT = uploadsDir;
export const DB_PATH = path.join(dataDir, 'it_crm.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase() {
  db.exec(`
    -- 1. Roles
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, -- 'super_admin', 'moderator', 'employee', 'management'
      label TEXT NOT NULL,
      description TEXT
    );

    -- 2. Locations (Warehouses, Branches, Offices, Hubs)
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Warehouse', -- Warehouse, Branch, Corporate Office, Hub
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      address TEXT NOT NULL,
      manager_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 3. Departments
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      cost_center TEXT
    );

    -- 4. Users
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active', -- Active, Inactive
      must_reset_password INTEGER NOT NULL DEFAULT 0,
      reset_token TEXT,
      reset_token_expires TEXT,
      invite_token TEXT,
      invite_expires_at TEXT,
      invited_link_base TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 5. Employees
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      employee_code TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      department_id INTEGER REFERENCES departments(id),
      designation TEXT NOT NULL,
      mobile TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      location_id INTEGER REFERENCES locations(id),
      reporting_manager TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 6. Moderators
    CREATE TABLE IF NOT EXISTS moderators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      employee_code TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      specialization TEXT NOT NULL,
      assigned_location_ids TEXT NOT NULL DEFAULT '[]', -- JSON array of location IDs
      date_of_joining TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active', -- Active, Inactive
      performance_rating REAL NOT NULL DEFAULT 4.5,
      max_capacity INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 7. SLA Configurations
    CREATE TABLE IF NOT EXISTS sla_configurations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      priority TEXT NOT NULL UNIQUE, -- Critical, High, Medium, Low
      first_response_minutes INTEGER NOT NULL,
      resolution_hours INTEGER NOT NULL,
      working_hours_start TEXT NOT NULL DEFAULT '08:00',
      working_hours_end TEXT NOT NULL DEFAULT '20:00',
      holidays_json TEXT NOT NULL DEFAULT '[]',
      auto_escalate INTEGER NOT NULL DEFAULT 1,
      escalate_to_email TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 8. Vendors
    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      tax_id TEXT,
      address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 9. IT Assets
    CREATE TABLE IF NOT EXISTS it_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_tag TEXT NOT NULL UNIQUE,
      serial_number TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL, -- Laptop, Desktop, Printers, CCTV Cameras, Network Devices, Barcode Scanners, Servers, UPS, Routers, Switches, Other IT Equipment
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      purchase_date TEXT NOT NULL,
      purchase_cost REAL NOT NULL DEFAULT 0,
      warranty_expiry TEXT,
      assigned_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
      location_id INTEGER REFERENCES locations(id),
      condition_status TEXT NOT NULL DEFAULT 'Operational', -- Operational, Under Repair, Decommissioned, Spare
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 10. Tickets
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT NOT NULL UNIQUE,
      employee_id INTEGER REFERENCES employees(id),
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      reporter_name TEXT NOT NULL,
      reporter_employee_code TEXT NOT NULL,
      reporter_department TEXT NOT NULL,
      reporter_designation TEXT NOT NULL,
      reporter_mobile TEXT NOT NULL,
      reporter_email TEXT NOT NULL,
      reporter_branch_name TEXT NOT NULL,
      reporter_city TEXT NOT NULL,
      reporter_full_location TEXT NOT NULL,
      reporter_manager TEXT NOT NULL,
      location_id INTEGER REFERENCES locations(id),
      department_id INTEGER REFERENCES departments(id),
      category TEXT NOT NULL,
      device_type TEXT NOT NULL,
      device_name TEXT NOT NULL,
      asset_id INTEGER REFERENCES it_assets(id) ON DELETE SET NULL,
      asset_serial_input TEXT,
      description TEXT NOT NULL,
      issue_occurred_at TEXT NOT NULL,
      business_impact TEXT NOT NULL, -- Low, Moderate, High, Operations Halted
      priority TEXT NOT NULL DEFAULT 'Medium', -- Critical, High, Medium, Low
      status TEXT NOT NULL DEFAULT 'New',
      assigned_moderator_id INTEGER REFERENCES moderators(id) ON DELETE SET NULL,
      deadline_at TEXT,
      sla_first_response_due TEXT,
      sla_resolution_due TEXT,
      sla_breached INTEGER NOT NULL DEFAULT 0,
      first_response_at TEXT,
      assigned_at TEXT,
      accepted_at TEXT,
      work_started_at TEXT,
      work_completed_at TEXT,
      resolved_at TEXT,
      closed_at TEXT,
      total_working_minutes INTEGER NOT NULL DEFAULT 0,
      visit_count INTEGER NOT NULL DEFAULT 0,
      parts_replaced TEXT,
      expenses_incurred REAL NOT NULL DEFAULT 0,
      resolution_description TEXT,
      employee_feedback TEXT,
      employee_confirmed INTEGER NOT NULL DEFAULT 0,
      admin_verified INTEGER NOT NULL DEFAULT 0,
      admin_verified_by INTEGER REFERENCES users(id),
      rejection_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 11. Ticket Assignments
    CREATE TABLE IF NOT EXISTS ticket_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      moderator_id INTEGER NOT NULL REFERENCES moderators(id),
      assigned_by_user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL, -- Assigned, Reassigned, Accepted, Rejected
      reason TEXT,
      deadline_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 12. Ticket Activities (Append-only Audit Trail)
    CREATE TABLE IF NOT EXISTS ticket_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      actor_user_id INTEGER REFERENCES users(id),
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action_type TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 13. Ticket Attachments
    CREATE TABLE IF NOT EXISTS ticket_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_category TEXT NOT NULL, -- Photo, Video, Document
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 14. Ticket Comments
    CREATE TABLE IF NOT EXISTS ticket_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      sender_user_id INTEGER REFERENCES users(id),
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'Portal', -- Portal, Outlook, WhatsApp
      is_internal INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 15. Ticket Time Logs
    CREATE TABLE IF NOT EXISTS ticket_time_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      moderator_id INTEGER NOT NULL REFERENCES moderators(id),
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      work_type TEXT NOT NULL DEFAULT 'Troubleshooting',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 16. Asset Maintenance
    CREATE TABLE IF NOT EXISTS asset_maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL REFERENCES it_assets(id) ON DELETE CASCADE,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      maintenance_type TEXT NOT NULL, -- Preventive, Repair, Parts Replacement
      description TEXT NOT NULL,
      vendor_id INTEGER REFERENCES vendors(id),
      cost REAL NOT NULL DEFAULT 0,
      performed_at TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 17. IT Budgets
    CREATE TABLE IF NOT EXISTS it_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fiscal_year INTEGER NOT NULL,
      month INTEGER NOT NULL DEFAULT 0, -- 0 = Annual, 1..12 = Monthly
      location_id INTEGER REFERENCES locations(id),
      allocated_amount REAL NOT NULL,
      notes TEXT,
      created_by_user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 18. Expenses
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL, -- Hardware Purchase, Repair & Maintenance, Software Subscription, Networking, Vendor Payment, Spare Parts, Emergency IT
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      vendor_id INTEGER REFERENCES vendors(id),
      vendor_name TEXT NOT NULL,
      location_id INTEGER REFERENCES locations(id),
      amount REAL NOT NULL,
      invoice_number TEXT NOT NULL,
      invoice_attachment_path TEXT,
      payment_date TEXT NOT NULL,
      approval_status TEXT NOT NULL DEFAULT 'Pending', -- Pending, Approved, Rejected
      approved_by_user_id INTEGER REFERENCES users(id),
      description TEXT,
      created_by_user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 19. Expense Approvals
    CREATE TABLE IF NOT EXISTS expense_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      approver_user_id INTEGER NOT NULL REFERENCES users(id),
      approver_name TEXT NOT NULL,
      decision TEXT NOT NULL, -- Approved, Rejected
      remarks TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 20. Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info', -- info, warning, critical, success
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 21. Email Communications (Microsoft Outlook)
    CREATE TABLE IF NOT EXISTS email_communications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      direction TEXT NOT NULL, -- Outbound, Inbound
      sender_email TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      message_id TEXT,
      status TEXT NOT NULL DEFAULT 'Sent', -- Sent, Received, Failed, Queued
      attachments_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 22. WhatsApp Communications (Meta Cloud API)
    CREATE TABLE IF NOT EXISTS whatsapp_communications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      direction TEXT NOT NULL, -- Outbound, Inbound
      phone_number TEXT NOT NULL,
      template_name TEXT,
      message_body TEXT NOT NULL,
      wa_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'Sent', -- Sent, Delivered, Read, Received, Failed
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 23. Login Sessions
    CREATE TABLE IF NOT EXISTS login_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_name TEXT NOT NULL,
      login_at TEXT NOT NULL DEFAULT (datetime('now')),
      logout_at TEXT,
      last_activity_at TEXT,
      duration_minutes INTEGER DEFAULT 0,
      ip_address TEXT,
      user_agent TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    -- 24. Audit Logs
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_email TEXT,
      role_name TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details_json TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Integration Settings (Server-side config & encrypted/protected tokens)
    CREATE TABLE IF NOT EXISTS integration_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 25. Mobile OTP Verification Codes (Employee Self-Service Login)
    CREATE TABLE IF NOT EXISTS mobile_otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mobile TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      verified_at TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 26. Direct Messages (Super Admin <-> Moderator Real-Time Chat)
    CREATE TABLE IF NOT EXISTS direct_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 27. Dynamic Dropdown Options (Managed by Super Admin)
    CREATE TABLE IF NOT EXISTS dropdown_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_key TEXT NOT NULL,
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(group_key, value)
    );

    -- Indexes for fast queries
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
    CREATE INDEX IF NOT EXISTS idx_tickets_location ON tickets(location_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_moderator ON tickets(assigned_moderator_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON tickets(created_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
    CREATE INDEX IF NOT EXISTS idx_ticket_activities_ticket ON ticket_activities(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_expenses_location ON expenses(location_id);
    CREATE INDEX IF NOT EXISTS idx_assets_location ON it_assets(location_id);
    CREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_users_invite_token ON users(invite_token);
    CREATE INDEX IF NOT EXISTS idx_mobile_otps_mobile ON mobile_otps(mobile);
    CREATE INDEX IF NOT EXISTS idx_dm_pair ON direct_messages(sender_user_id, recipient_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_dm_recipient_unread ON direct_messages(recipient_user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_dropdown_group_order ON dropdown_options(group_key, sort_order, id);
  `);

  // Idempotent column migrations for pre-existing databases
  const userCols = (db.prepare("PRAGMA table_info('users')").all() as { name: string }[]).map((c) => c.name);
  if (!userCols.includes('invite_token')) {
    db.exec('ALTER TABLE users ADD COLUMN invite_token TEXT');
  }
  if (!userCols.includes('invite_expires_at')) {
    db.exec('ALTER TABLE users ADD COLUMN invite_expires_at TEXT');
  }
  if (!userCols.includes('invited_link_base')) {
    db.exec('ALTER TABLE users ADD COLUMN invited_link_base TEXT');
  }
  if (!userCols.includes('mobile')) {
    db.exec('ALTER TABLE users ADD COLUMN mobile TEXT');
  }
  if (!userCols.includes('last_login_ip')) {
    db.exec('ALTER TABLE users ADD COLUMN last_login_ip TEXT');
  }

  const empCols = (db.prepare("PRAGMA table_info('employees')").all() as { name: string }[]).map((c) => c.name);
  if (!empCols.includes('login_count')) {
    db.exec('ALTER TABLE employees ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!empCols.includes('last_login_at')) {
    db.exec('ALTER TABLE employees ADD COLUMN last_login_at TEXT');
  }
  if (!empCols.includes('last_login_ip')) {
    db.exec('ALTER TABLE employees ADD COLUMN last_login_ip TEXT');
  }

  const sessCols = (db.prepare("PRAGMA table_info('login_sessions')").all() as { name: string }[]).map((c) => c.name);
  if (!sessCols.includes('last_activity_at')) {
    db.exec('ALTER TABLE login_sessions ADD COLUMN last_activity_at TEXT');
  }

  const notifCols = (db.prepare("PRAGMA table_info('notifications')").all() as { name: string }[]).map((c) => c.name);
  if (!notifCols.includes('event_key')) {
    db.exec('ALTER TABLE notifications ADD COLUMN event_key TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_event ON notifications(user_id, event_key) WHERE event_key IS NOT NULL');

  // Idempotent Super Admin profile update: Arjun Mehta / ithead@logicore.demo -> Gaurav / techsupport@sdgloballogistics.com
  const existingAdmin = db
    .prepare(
      `SELECT u.id, u.email, u.full_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'super_admin'
       ORDER BY u.id ASC LIMIT 1`
    )
    .get() as { id: number; email: string; full_name: string } | undefined;

  if (existingAdmin && (existingAdmin.email === 'ithead@logicore.demo' || existingAdmin.full_name === 'Arjun Mehta')) {
    const targetEmail = 'techsupport@sdgloballogistics.com';
    const emailConflict = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?').get(targetEmail, existingAdmin.id);
    if (!emailConflict) {
      db.prepare('UPDATE users SET full_name = ?, email = ? WHERE id = ?').run('Gaurav', targetEmail, existingAdmin.id);
      db.prepare('UPDATE moderators SET full_name = ?, email = ? WHERE user_id = ?').run('Gaurav', targetEmail, existingAdmin.id);
      db.prepare("UPDATE sla_configurations SET escalate_to_email = ? WHERE escalate_to_email = 'ithead@logicore.demo'").run(targetEmail);
    }
  }

  // One-time Super Admin password setup to Sdgl@!1234# (does not overwrite future user-initiated changes)
  const adminPwMigrated = db
    .prepare("SELECT value_json FROM integration_settings WHERE key = 'super_admin_pw_sdgl_v1'")
    .get() as { value_json: string } | undefined;
  if (!adminPwMigrated && existingAdmin) {
    const newHash = bcrypt.hashSync('Sdgl@!1234#', 10);
    db.prepare(
      `UPDATE users
       SET password_hash = ?
       WHERE role_id IN (SELECT id FROM roles WHERE name = 'super_admin')`
    ).run(newHash);
    db.prepare(
      `INSERT INTO integration_settings (key, value_json, updated_at)
       VALUES ('super_admin_pw_sdgl_v1', '{"applied":true}', datetime('now'))
       ON CONFLICT(key) DO NOTHING`
    ).run();
  }

  // Normalize legacy statuses to the new 9-step work roadmap
  db.exec(`
    UPDATE tickets SET status = 'Accepted' WHERE status = 'Accepted by Moderator';
    UPDATE tickets SET status = 'Ready for Review' WHERE status = 'Pending Admin Review';
    UPDATE tickets SET status = 'Pending Information' WHERE status IN ('Waiting for Employee', 'Waiting for Parts / Vendor');
    UPDATE tickets SET status = 'Completed' WHERE status IN ('Resolved', 'Closed');
  `);

  // Seed default configurable dropdowns if empty
  const ddCount = (db.prepare('SELECT COUNT(*) as c FROM dropdown_options').get() as { c: number }).c;
  if (ddCount === 0) {
    const insDd = db.prepare(
      `INSERT INTO dropdown_options (group_key, label, value, sort_order, is_active, is_system, meta_json)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    );

    const statusOptions: Array<{ label: string; tone: string; requiresNote?: boolean; adminOnly?: boolean; system?: boolean }> = [
      { label: 'New', tone: 'slate', system: true },
      { label: 'Assigned', tone: 'blue', adminOnly: true, system: true },
      { label: 'Accepted', tone: 'indigo', system: true },
      { label: 'Under Review', tone: 'violet', system: true },
      { label: 'In Progress', tone: 'blue', system: true },
      { label: 'On Hold', tone: 'amber', requiresNote: true, system: true },
      { label: 'Pending Information', tone: 'amber', requiresNote: true, system: true },
      { label: 'Ready for Review', tone: 'cyan', system: true },
      { label: 'Revision Required', tone: 'red', requiresNote: true, adminOnly: true, system: true },
      { label: 'Completed', tone: 'emerald', adminOnly: true, system: true },
      { label: 'Escalated', tone: 'red', requiresNote: true },
      { label: 'Reopened', tone: 'red', requiresNote: true },
    ];
    statusOptions.forEach((opt, idx) => {
      insDd.run(
        'task_status',
        opt.label,
        opt.label,
        idx + 1,
        opt.system ? 1 : 0,
        JSON.stringify({ tone: opt.tone, requiresNote: Boolean(opt.requiresNote), adminOnly: Boolean(opt.adminOnly) })
      );
    });

    const categories = [
      'Laptop / Desktop Issues',
      'Printer and Scanner Issues',
      'CCTV Camera Issues',
      'Network / Internet Issues',
      'Wi-Fi Issues',
      'Warehouse Technical Equipment',
      'Barcode Scanner Issues',
      'Server and Software Issues',
      'ERP / WMS Application Issues',
      'Email / Outlook Issues',
      'Mobile Device Issues',
      'Biometric Attendance Systems',
      'UPS / Power Backup Issues',
      'Access Control Systems',
      'Other Technical Issues',
    ];
    categories.forEach((c, idx) => insDd.run('work_category', c, c, idx + 1, 0, null));

    const priorities = [
      { label: 'Critical', tone: 'red' },
      { label: 'High', tone: 'amber' },
      { label: 'Medium', tone: 'blue' },
      { label: 'Low', tone: 'slate' },
    ];
    priorities.forEach((p, idx) => insDd.run('priority', p.label, p.label, idx + 1, 1, JSON.stringify({ tone: p.tone })));

    const deviceTypes = [
      'Laptop',
      'Desktop',
      'Printer / Scanner',
      'CCTV Camera',
      'Network Router / Switch',
      'Wi-Fi Access Point',
      'Barcode Scanner',
      'Server',
      'Biometric Terminal',
      'UPS / Power Backup',
      'Mobile Device',
      'Other IT Equipment',
    ];
    deviceTypes.forEach((d, idx) => insDd.run('device_type', d, d, idx + 1, 0, null));

    const impacts = ['Low', 'Moderate', 'High', 'Operations Halted'];
    impacts.forEach((b, idx) => insDd.run('business_impact', b, b, idx + 1, 0, null));

    const assetCats = [
      'Laptop',
      'Desktop',
      'Printers',
      'CCTV Cameras',
      'Network Devices',
      'Barcode Scanners',
      'Servers',
      'UPS',
      'Routers',
      'Switches',
      'Other IT Equipment',
    ];
    assetCats.forEach((a, idx) => insDd.run('asset_category', a, a, idx + 1, 0, null));

    const expenseCats = [
      'Hardware Purchase',
      'Repair & Maintenance',
      'Software Subscription',
      'Networking',
      'Vendor Payment',
      'Spare Parts',
      'Emergency IT',
    ];
    expenseCats.forEach((e, idx) => insDd.run('expense_category', e, e, idx + 1, 0, null));
  }

  syncDepartmentDropdownOptions();
}

export function syncDepartmentDropdownOptions() {
  const deptOptCount = (db.prepare("SELECT COUNT(*) as c FROM dropdown_options WHERE group_key = 'department'").get() as { c: number }).c;
  if (deptOptCount === 0) {
    const depts = db.prepare('SELECT id, name, code, cost_center FROM departments ORDER BY id ASC').all() as Array<{
      id: number;
      name: string;
      code: string;
      cost_center: string | null;
    }>;
    const insDeptDd = db.prepare(
      `INSERT OR IGNORE INTO dropdown_options (group_key, label, value, sort_order, is_active, is_system, meta_json)
       VALUES ('department', ?, ?, ?, 1, 0, ?)`
    );
    depts.forEach((d, idx) => {
      insDeptDd.run(d.name, d.name, idx + 1, JSON.stringify({ department_id: d.id, code: d.code, cost_center: d.cost_center || '' }));
    });
  }
}

