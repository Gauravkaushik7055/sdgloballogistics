import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../db.ts';
import {
  type AuthRequest,
  getSuperAdminNotificationPrefs,
  notifyAdmins,
  requireAuth,
  requireRole,
  signToken,
  writeAuditLog,
} from '../auth.ts';
import { dispatchWhatsAppMessage, getEffectiveWhatsAppConfig } from '../integrations.ts';

const router = Router();

function normalizeMobileDigits(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

function canonicalMobileKey(raw: string): string {
  const digits = normalizeMobileDigits(raw);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password, portal_mode, mod_access } = req.body as {
    email?: string;
    password?: string;
    portal_mode?: string;
    mod_access?: string;
  };
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (portal_mode === 'moderator_common' && mod_access) {
    const portalRow = db
      .prepare("SELECT value_json FROM integration_settings WHERE key = 'moderator_common_portal'")
      .get() as { value_json: string } | undefined;
    if (portalRow) {
      let activeKey = '';
      try {
        activeKey = JSON.parse(portalRow.value_json)?.access_key || '';
      } catch {
        activeKey = '';
      }
      if (activeKey && mod_access.trim() !== activeKey) {
        return res.status(403).json({
          error: 'This common moderator access link is outdated or invalid. Request the latest link from the Super Admin.',
        });
      }
    }
  }

  const user = db
    .prepare(
      `SELECT u.*, r.name as role_name, r.label as role_label
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE lower(u.email) = lower(?)`
    )
    .get(email.trim()) as any;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    writeAuditLog({
      userEmail: email.trim(),
      action: 'LOGIN_FAILED',
      entityType: 'auth',
      details: { reason: 'Invalid credentials', portal_mode: portal_mode || 'standard' },
      ipAddress: req.ip,
    });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (user.status !== 'Active') {
    return res.status(403).json({ error: 'Your account has been deactivated. Contact the IT Head.' });
  }

  if (portal_mode === 'moderator_common' && !['moderator', 'super_admin'].includes(user.role_name)) {
    return res.status(403).json({
      error: 'Only authorized IT Moderator or Super Admin accounts can sign in via the Moderator Portal link.',
    });
  }

  const employee = db.prepare('SELECT id FROM employees WHERE user_id = ?').get(user.id) as { id: number } | undefined;
  const moderator = db.prepare('SELECT id FROM moderators WHERE user_id = ?').get(user.id) as { id: number } | undefined;

  const nowIso = new Date().toISOString();
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso, user.id);

  const sessionRes = db
    .prepare(
      `INSERT INTO login_sessions (user_id, role_name, login_at, last_activity_at, ip_address, user_agent, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    )
    .run(user.id, user.role_name, nowIso, nowIso, req.ip || 'unknown', req.headers['user-agent'] || 'unknown');

  const authPayload = {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role_name,
    role_label: user.role_label,
    session_id: Number(sessionRes.lastInsertRowid),
    employee_id: employee?.id ?? null,
    moderator_id: moderator?.id ?? null,
  };

  const token = signToken(authPayload);

  writeAuditLog({
    userId: user.id,
    userEmail: user.email,
    roleName: user.role_name,
    action: portal_mode === 'moderator_common' ? 'MODERATOR_COMMON_LINK_LOGIN' : 'LOGIN_SUCCESS',
    entityType: 'session',
    entityId: authPayload.session_id,
    details: portal_mode === 'moderator_common' ? { via: 'common_moderator_link' } : undefined,
    ipAddress: req.ip,
  });

  res.cookie('logicore_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 12 * 60 * 60 * 1000,
  });

  res.json({
    token,
    user: {
      ...authPayload,
      must_reset_password: Boolean(user.must_reset_password),
      employee_profile: employee
        ? db
            .prepare(
              `SELECT e.*, d.name as department_name, l.name as location_name, l.city as location_city
               FROM employees e
               LEFT JOIN departments d ON e.department_id = d.id
               LEFT JOIN locations l ON e.location_id = l.id
               WHERE e.id = ?`
            )
            .get(employee.id)
        : null,
      moderator_profile: moderator
        ? db.prepare('SELECT * FROM moderators WHERE id = ?').get(moderator.id)
        : null,
      notification_prefs: user.role_name === 'super_admin' ? getSuperAdminNotificationPrefs() : null,
    },
  });
});

// GET /api/auth/moderator-portal-check (Public check for common moderator portal access link)
router.get('/moderator-portal-check', (req, res) => {
  const modAccess = typeof req.query.mod_access === 'string' ? req.query.mod_access.trim() : '';
  const row = db
    .prepare("SELECT value_json FROM integration_settings WHERE key = 'moderator_common_portal'")
    .get() as { value_json: string } | undefined;

  if (modAccess && row) {
    let activeKey = '';
    try {
      activeKey = JSON.parse(row.value_json)?.access_key || '';
    } catch {
      activeKey = '';
    }
    if (activeKey && modAccess !== activeKey) {
      return res.status(403).json({
        valid: false,
        error: 'This common moderator login link has expired or been regenerated. Ask the Super Admin for the updated link.',
      });
    }
  }

  res.json({ valid: true });
});

// GET /api/auth/invite/:token (Verify a Super-Admin-issued login link)
router.get('/invite/:token', (req, res) => {
  const token = (req.params.token || '').trim();
  if (!token) {
    return res.status(400).json({ error: 'Invite token is required' });
  }

  const user = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.status, u.must_reset_password, u.invite_expires_at,
              r.name as role_name, r.label as role_label
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.invite_token = ?`
    )
    .get(token) as any;

  if (!user) {
    return res.status(404).json({ error: 'This login link is invalid or has been superseded by a newer link.' });
  }
  if (user.status !== 'Active') {
    return res.status(403).json({ error: 'This account has been deactivated by the Super Admin.' });
  }
  if (user.invite_expires_at && new Date(user.invite_expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'This login link has expired. Ask the Super Admin to generate a new link.' });
  }

  res.json({
    valid: true,
    invite: {
      email: user.email,
      full_name: user.full_name,
      role_name: user.role_name,
      role_label: user.role_label,
      requires_password_setup: Boolean(user.must_reset_password),
    },
  });
});

// POST /api/auth/invite-login (Authenticate using Super-Admin-issued invite link)
router.post('/invite-login', (req, res) => {
  const { token, password, new_password } = req.body as {
    token?: string;
    password?: string;
    new_password?: string;
  };

  if (!token || !token.trim()) {
    return res.status(400).json({ error: 'Invite token is required' });
  }

  const user = db
    .prepare(
      `SELECT u.*, r.name as role_name, r.label as role_label
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.invite_token = ?`
    )
    .get(token.trim()) as any;

  if (!user) {
    return res.status(404).json({ error: 'Invalid or superseded login link' });
  }
  if (user.status !== 'Active') {
    return res.status(403).json({ error: 'Your account is deactivated. Contact the Super Admin.' });
  }
  if (user.invite_expires_at && new Date(user.invite_expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'This login link has expired. Request a fresh link from Super Admin.' });
  }

  let passwordAction: string | null = null;
  if (user.must_reset_password) {
    const chosenPassword = (new_password || password || '').trim();
    if (chosenPassword.length < 8) {
      return res.status(400).json({ error: 'Please set a password of at least 8 characters to activate your link.' });
    }
    const hash = bcrypt.hashSync(chosenPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, must_reset_password = 0 WHERE id = ?').run(hash, user.id);
    passwordAction = 'INVITE_PASSWORD_ACTIVATED';
  } else {
    if (!password || !bcrypt.compareSync(password, user.password_hash)) {
      writeAuditLog({
        userId: user.id,
        userEmail: user.email,
        roleName: user.role_name,
        action: 'INVITE_LOGIN_FAILED',
        entityType: 'auth',
        entityId: user.id,
        details: { reason: 'Incorrect password on invite link' },
        ipAddress: req.ip,
      });
      return res.status(401).json({ error: 'Incorrect password for this invited account' });
    }
  }

  const employee = db.prepare('SELECT id FROM employees WHERE user_id = ?').get(user.id) as { id: number } | undefined;
  const moderator = db.prepare('SELECT id FROM moderators WHERE user_id = ?').get(user.id) as { id: number } | undefined;

  const nowIso = new Date().toISOString();
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso, user.id);

  const sessionRes = db
    .prepare(
      `INSERT INTO login_sessions (user_id, role_name, login_at, last_activity_at, ip_address, user_agent, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    )
    .run(user.id, user.role_name, nowIso, nowIso, req.ip || 'unknown', req.headers['user-agent'] || 'unknown');

  const authPayload = {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role_name,
    role_label: user.role_label,
    session_id: Number(sessionRes.lastInsertRowid),
    employee_id: employee?.id ?? null,
    moderator_id: moderator?.id ?? null,
  };

  const jwtToken = signToken(authPayload);

  if (passwordAction) {
    writeAuditLog({
      userId: user.id,
      userEmail: user.email,
      roleName: user.role_name,
      action: passwordAction,
      entityType: 'user',
      entityId: user.id,
      details: { via: 'invite_link' },
      ipAddress: req.ip,
    });
  }

  writeAuditLog({
    userId: user.id,
    userEmail: user.email,
    roleName: user.role_name,
    action: 'INVITE_LINK_LOGIN',
    entityType: 'session',
    entityId: authPayload.session_id,
    details: { via: 'invite_link', invited_link_base: user.invited_link_base || null },
    ipAddress: req.ip,
  });

  res.cookie('logicore_token', jwtToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 12 * 60 * 60 * 1000,
  });

  res.json({
    token: jwtToken,
    user: {
      ...authPayload,
      must_reset_password: false,
      employee_profile: employee
        ? db
            .prepare(
              `SELECT e.*, d.name as department_name, l.name as location_name, l.city as location_city
               FROM employees e
               LEFT JOIN departments d ON e.department_id = d.id
               LEFT JOIN locations l ON e.location_id = l.id
               WHERE e.id = ?`
            )
            .get(employee.id)
        : null,
      moderator_profile: moderator
        ? db.prepare('SELECT * FROM moderators WHERE id = ?').get(moderator.id)
        : null,
    },
  });
});

// GET /api/auth/employee-portal-meta (Public lookup of hubs & departments for Employee OTP self-login)
router.get('/employee-portal-meta', (_req, res) => {
  const locations = db.prepare('SELECT id, code, name, type, city FROM locations ORDER BY name ASC').all();
  const departments = db.prepare('SELECT id, name, code FROM departments ORDER BY name ASC').all();
  res.json({ locations, departments });
});

// POST /api/auth/employee-otp/request (Any employee requests an OTP using their mobile number — no manual registration needed)
router.post('/employee-otp/request', async (req, res) => {
  const { mobile } = req.body as { mobile?: string };
  const digits = normalizeMobileDigits(mobile || '');
  if (digits.length < 7 || digits.length > 15) {
    return res.status(400).json({ error: 'Please enter a valid mobile number (7 to 15 digits).' });
  }

  const mobileKey = canonicalMobileKey(mobile || '');
  const displayMobile = mobile!.trim();
  const otpCode = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO mobile_otps (mobile, otp_code, expires_at, ip_address) VALUES (?, ?, ?, ?)').run(
    mobileKey,
    otpCode,
    expiresAt,
    req.ip || 'unknown'
  );

  // Check if returning employee
  const existingEmp = db
    .prepare(
      `SELECT e.id, e.full_name, u.status
       FROM employees e
       LEFT JOIN users u ON e.user_id = u.id
       WHERE (
         CASE
           WHEN length(replace(replace(replace(replace(replace(e.mobile, '+', ''), '-', ''), ' ', ''), '(', ''), ')', '')) > 10
           THEN substr(replace(replace(replace(replace(replace(e.mobile, '+', ''), '-', ''), ' ', ''), '(', ''), ')', ''), -10)
           ELSE replace(replace(replace(replace(replace(e.mobile, '+', ''), '-', ''), ' ', ''), '(', ''), ')', '')
         END
       ) = ?
       LIMIT 1`
    )
    .get(mobileKey) as { id: number; full_name: string; status: string } | undefined;

  if (existingEmp && existingEmp.status === 'Inactive') {
    return res.status(403).json({ error: 'This employee account has been deactivated. Contact HR / IT Head.' });
  }

  // Send via WhatsApp Cloud API if configured & enabled
  let smsOrWaDelivered = false;
  const waCfg = getEffectiveWhatsAppConfig();
  if (waCfg.enabled && waCfg.accessToken && waCfg.phoneNumberId) {
    const waRes = await dispatchWhatsAppMessage({
      toPhone: displayMobile,
      messageBody: `SD Global Employee Portal OTP: ${otpCode}. Valid for 10 minutes. Do not share this code.`,
    }).catch(() => ({ delivered: false }));
    smsOrWaDelivered = Boolean(waRes.delivered);
  }

  writeAuditLog({
    userEmail: displayMobile,
    roleName: 'employee',
    action: 'EMPLOYEE_OTP_REQUESTED',
    entityType: 'auth',
    entityId: digits,
    details: { existing_employee: Boolean(existingEmp), whatsapp_delivered: smsOrWaDelivered },
    ipAddress: req.ip,
  });

  res.json({
    message: smsOrWaDelivered
      ? 'OTP sent to your mobile via WhatsApp.'
      : 'OTP generated. Enter the 6-digit verification code below to sign in.',
    mobile: displayMobile,
    expires_in_minutes: 10,
    existing_employee: Boolean(existingEmp),
    full_name: existingEmp?.full_name || null,
    otp_preview: smsOrWaDelivered ? undefined : otpCode,
  });
});

// POST /api/auth/employee-otp/verify (Verify OTP, auto-capture/create employee record on first login, and issue session)
router.post('/employee-otp/verify', (req, res) => {
  const { mobile, otp, full_name, email, department_id, location_id, designation } = req.body as {
    mobile?: string;
    otp?: string;
    full_name?: string;
    email?: string;
    department_id?: number | string;
    location_id?: number | string;
    designation?: string;
  };

  const digits = normalizeMobileDigits(mobile || '');
  const mobileKey = canonicalMobileKey(mobile || '');
  if (digits.length < 7 || !otp || !otp.trim()) {
    return res.status(400).json({ error: 'Mobile number and 6-digit OTP are required' });
  }

  const otpRow = db
    .prepare(
      `SELECT * FROM mobile_otps
       WHERE mobile = ? AND otp_code = ? AND verified_at IS NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(mobileKey, otp.trim()) as any;

  if (!otpRow) {
    writeAuditLog({
      userEmail: mobile?.trim() || mobileKey,
      roleName: 'employee',
      action: 'EMPLOYEE_OTP_FAILED',
      entityType: 'auth',
      entityId: mobileKey,
      details: { reason: 'Invalid OTP code' },
      ipAddress: req.ip,
    });
    return res.status(401).json({ error: 'Invalid OTP code. Please check and try again.' });
  }

  if (new Date(otpRow.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'OTP has expired. Please request a new OTP.' });
  }

  const nowIso = new Date().toISOString();
  const displayMobile = mobile!.trim();
  const clientIp = req.ip || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  const existingEmp = db
    .prepare(
      `SELECT e.*, u.id as u_id, u.email as u_email, u.full_name as u_full_name, u.status as u_status
       FROM employees e
       LEFT JOIN users u ON e.user_id = u.id
       WHERE (
         CASE
           WHEN length(replace(replace(replace(replace(replace(e.mobile, '+', ''), '-', ''), ' ', ''), '(', ''), ')', '')) > 10
           THEN substr(replace(replace(replace(replace(replace(e.mobile, '+', ''), '-', ''), ' ', ''), '(', ''), ')', ''), -10)
           ELSE replace(replace(replace(replace(replace(e.mobile, '+', ''), '-', ''), ' ', ''), '(', ''), ')', '')
         END
       ) = ?
       LIMIT 1`
    )
    .get(mobileKey) as any;

  if (existingEmp && existingEmp.u_status === 'Inactive') {
    return res.status(403).json({ error: 'Your account has been deactivated. Contact HR / IT Head.' });
  }

  let userId: number;
  let employeeId: number;
  let userEmail: string;
  let userFullName: string;
  let isNewEmployee = false;

  const roleRow = db.prepare("SELECT id, label FROM roles WHERE name = 'employee'").get() as { id: number; label: string };

  const tx = db.transaction(() => {
    db.prepare('UPDATE mobile_otps SET verified_at = ? WHERE id = ?').run(nowIso, otpRow.id);

    if (!existingEmp || !existingEmp.u_id) {
      isNewEmployee = true;
      const cleanName = (full_name || '').trim() || `Employee ${digits.slice(-4)}`;
      const candidateEmail = (email || '').trim().toLowerCase();
      const emailTaken = candidateEmail
        ? db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(candidateEmail)
        : true;
      const resolvedEmail = candidateEmail && !emailTaken ? candidateEmail : `emp.${digits}@mobile.logicore.local`;

      const randomHash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
      const uRes = db
        .prepare(
          `INSERT INTO users (role_id, email, password_hash, full_name, status, mobile, last_login_at, last_login_ip)
           VALUES (?, ?, ?, ?, 'Active', ?, ?, ?)`
        )
        .run(roleRow.id, resolvedEmail, randomHash, cleanName, displayMobile, nowIso, clientIp);

      userId = Number(uRes.lastInsertRowid);
      userEmail = resolvedEmail;
      userFullName = cleanName;

      if (existingEmp) {
        // Employee row existed without a user_id; link it
        db.prepare(
          `UPDATE employees
           SET user_id = ?, login_count = COALESCE(login_count, 0) + 1, last_login_at = ?, last_login_ip = ?
           WHERE id = ?`
        ).run(userId, nowIso, clientIp, existingEmp.id);
        employeeId = existingEmp.id;
      } else {
        const autoCode = `EMP-M-${digits.slice(-4)}-${String(userId).padStart(3, '0')}`;
        const eRes = db
          .prepare(
            `INSERT INTO employees (
              user_id, employee_code, full_name, department_id, designation, mobile, email, location_id, reporting_manager,
              login_count, last_login_at, last_login_ip
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
          )
          .run(
            userId,
            autoCode,
            cleanName,
            department_id ? Number(department_id) : null,
            (designation || '').trim() || 'Self-Service Staff',
            displayMobile,
            resolvedEmail,
            location_id ? Number(location_id) : null,
            '',
            nowIso,
            clientIp
          );
        employeeId = Number(eRes.lastInsertRowid);
      }
    } else {
      userId = existingEmp.u_id;
      employeeId = existingEmp.id;
      userEmail = existingEmp.u_email;
      const updatedName =
        full_name && full_name.trim() && existingEmp.full_name.startsWith('Employee ')
          ? full_name.trim()
          : existingEmp.u_full_name;
      userFullName = updatedName;

      db.prepare('UPDATE users SET full_name = ?, mobile = ?, last_login_at = ?, last_login_ip = ? WHERE id = ?').run(
        updatedName,
        displayMobile,
        nowIso,
        clientIp,
        userId
      );
      db.prepare(
        `UPDATE employees
         SET full_name = ?,
             department_id = COALESCE(?, department_id),
             location_id = COALESCE(?, location_id),
             login_count = COALESCE(login_count, 0) + 1,
             last_login_at = ?,
             last_login_ip = ?
         WHERE id = ?`
      ).run(
        updatedName,
        department_id ? Number(department_id) : null,
        location_id ? Number(location_id) : null,
        nowIso,
        clientIp,
        employeeId
      );
    }

    const sessRes = db
      .prepare(
        `INSERT INTO login_sessions (user_id, role_name, login_at, last_activity_at, ip_address, user_agent, is_active)
         VALUES (?, 'employee', ?, ?, ?, ?, 1)`
      )
      .run(userId, nowIso, nowIso, clientIp, userAgent);

    return Number(sessRes.lastInsertRowid);
  });

  const sessionId = tx();

  const authPayload = {
    id: userId!,
    email: userEmail!,
    full_name: userFullName!,
    role: 'employee' as const,
    role_label: roleRow.label,
    session_id: sessionId,
    employee_id: employeeId!,
    moderator_id: null,
  };

  const token = signToken(authPayload);

  writeAuditLog({
    userId: userId!,
    userEmail: userEmail!,
    roleName: 'employee',
    action: isNewEmployee ? 'EMPLOYEE_OTP_AUTO_ONBOARD_LOGIN' : 'EMPLOYEE_OTP_LOGIN',
    entityType: 'employee',
    entityId: String(employeeId!),
    details: { mobile: displayMobile, session_id: sessionId, is_new_employee: isNewEmployee },
    ipAddress: clientIp,
  });

  if (isNewEmployee) {
    notifyAdmins({
      title: `New Employee Self-Onboarded: ${userFullName!}`,
      message: `${userFullName!} (${displayMobile}) signed in via Mobile + OTP and was automatically captured in the Employee & HR Panel.`,
      type: 'info',
    });
  }

  res.cookie('logicore_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 12 * 60 * 60 * 1000,
  });

  const employeeProfile = db
    .prepare(
      `SELECT e.*, d.name as department_name, l.name as location_name, l.city as location_city
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN locations l ON e.location_id = l.id
       WHERE e.id = ?`
    )
    .get(employeeId!);

  res.json({
    token,
    is_new_employee: isNewEmployee,
    user: {
      ...authPayload,
      must_reset_password: false,
      employee_profile: employeeProfile,
      moderator_profile: null,
    },
  });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req: AuthRequest, res) => {
  const user = req.user!;
  const nowIso = new Date().toISOString();
  const sess = db.prepare('SELECT * FROM login_sessions WHERE id = ?').get(user.session_id) as any;
  if (sess && sess.is_active) {
    const startMs = new Date(sess.login_at).getTime();
    const durationMins = Math.max(1, Math.round((Date.now() - startMs) / 60000));
    db.prepare('UPDATE login_sessions SET logout_at = ?, duration_minutes = ?, is_active = 0 WHERE id = ?').run(
      nowIso,
      durationMins,
      user.session_id
    );
  }
  writeAuditLog({
    userId: user.id,
    userEmail: user.email,
    roleName: user.role,
    action: 'LOGOUT',
    entityType: 'session',
    entityId: user.session_id,
    ipAddress: req.ip,
  });
  res.clearCookie('logicore_token', { httpOnly: true, secure: true, sameSite: 'none' });
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req: AuthRequest, res) => {
  const user = req.user!;
  const dbUser = db
    .prepare('SELECT id, email, full_name, status, must_reset_password, last_login_at FROM users WHERE id = ?')
    .get(user.id) as any;

  const employee = user.employee_id
    ? db
        .prepare(
          `SELECT e.*, d.name as department_name, l.name as location_name, l.city as location_city
           FROM employees e
           LEFT JOIN departments d ON e.department_id = d.id
           LEFT JOIN locations l ON e.location_id = l.id
           WHERE e.id = ?`
        )
        .get(user.employee_id)
    : null;

  const moderator = user.moderator_id
    ? db.prepare('SELECT * FROM moderators WHERE id = ?').get(user.moderator_id)
    : null;

  res.json({
    user: {
      ...user,
      full_name: dbUser?.full_name || user.full_name,
      email: dbUser?.email || user.email,
      must_reset_password: Boolean(dbUser?.must_reset_password),
      last_login_at: dbUser?.last_login_at,
      employee_profile: employee,
      moderator_profile: moderator,
      notification_prefs: user.role === 'super_admin' ? getSuperAdminNotificationPrefs() : null,
    },
  });
});

// PATCH /api/auth/profile (Authenticated user updates their own name/email cleanly)
router.patch('/profile', requireAuth, (req: AuthRequest, res) => {
  const user = req.user!;
  const { full_name, email } = req.body as { full_name?: string; email?: string };
  const cleanName = typeof full_name === 'string' ? full_name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!cleanName) {
    return res.status(400).json({ error: 'Full name is required' });
  }
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  if (cleanEmail) {
    const dup = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?').get(cleanEmail, user.id);
    if (dup) {
      return res.status(400).json({ error: 'Another user account already uses this email address' });
    }
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET full_name = ?, email = COALESCE(NULLIF(?, \'\'), email) WHERE id = ?').run(
      cleanName,
      cleanEmail,
      user.id
    );
    db.prepare('UPDATE moderators SET full_name = ?, email = COALESCE(NULLIF(?, \'\'), email) WHERE user_id = ?').run(
      cleanName,
      cleanEmail,
      user.id
    );
    db.prepare('UPDATE employees SET full_name = ?, email = COALESCE(NULLIF(?, \'\'), email) WHERE user_id = ?').run(
      cleanName,
      cleanEmail,
      user.id
    );
  })();

  const updated = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, r.name as role, r.label as role_label
       FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`
    )
    .get(user.id) as any;

  const refreshedToken = signToken({
    id: updated.id,
    email: updated.email,
    full_name: updated.full_name,
    role: updated.role,
    role_label: updated.role_label,
    session_id: user.session_id,
    employee_id: user.employee_id ?? null,
    moderator_id: user.moderator_id ?? null,
  });

  res.cookie('logicore_token', refreshedToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 12 * 60 * 60 * 1000,
  });

  writeAuditLog({
    userId: user.id,
    userEmail: updated.email,
    roleName: user.role,
    action: 'UPDATE_PROFILE',
    entityType: 'user',
    entityId: String(user.id),
    details: { full_name: cleanName, email: updated.email },
    ipAddress: req.ip,
  });

  res.json({
    ok: true,
    token: refreshedToken,
    user: {
      ...user,
      full_name: updated.full_name,
      email: updated.email,
    },
  });
});

// POST /api/auth/request-reset
router.post('/request-reset', (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  const user = db.prepare('SELECT id, email, full_name FROM users WHERE lower(email) = lower(?)').get(email.trim()) as any;
  if (!user) {
    return res.json({
      message: 'If an authorized company account matches this email, a password reset code has been generated.',
    });
  }
  const resetCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(resetCode, expiresAt, user.id);

  writeAuditLog({
    userId: user.id,
    userEmail: user.email,
    action: 'PASSWORD_RESET_REQUESTED',
    entityType: 'user',
    entityId: user.id,
    ipAddress: req.ip,
  });

  // In production this is emailed via Outlook; return token preview only for non-production / admin verification if needed
  res.json({
    message: 'Password reset token generated. Enter the verification code and new password below.',
    dev_reset_code_hint: process.env.NODE_ENV !== 'production' ? resetCode : undefined,
  });
});

// POST /api/auth/reset-password
router.post('/reset-password', (req, res) => {
  const { email, reset_code, new_password } = req.body as {
    email?: string;
    reset_code?: string;
    new_password?: string;
  };
  if (!email || !reset_code || !new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'Email, reset code, and a new password (min 8 chars) are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email.trim()) as any;
  if (!user || !user.reset_token || user.reset_token !== reset_code.trim().toUpperCase()) {
    return res.status(400).json({ error: 'Invalid reset verification code' });
  }
  if (user.reset_token_expires && new Date(user.reset_token_expires).getTime() < Date.now()) {
    return res.status(400).json({ error: 'Reset verification code has expired' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, must_reset_password = 0 WHERE id = ?').run(
    hash,
    user.id
  );

  writeAuditLog({
    userId: user.id,
    userEmail: user.email,
    action: 'PASSWORD_RESET_COMPLETED',
    entityType: 'user',
    entityId: user.id,
    ipAddress: req.ip,
  });

  res.json({ message: 'Password updated successfully. You may now sign in.' });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, (req: AuthRequest, res) => {
  const { current_password, new_password } = req.body as { current_password?: string; new_password?: string };
  if (!current_password || !new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'Current password and new password (min 8 chars) are required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_reset_password = 0 WHERE id = ?').run(hash, user.id);
  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'PASSWORD_CHANGED',
    entityType: 'user',
    entityId: req.user!.id,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

// GET /api/auth/sessions (Strictly Super Admin ONLY)
router.get('/sessions', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const { role_name, user_id } = req.query as { role_name?: string; user_id?: string };
  const where: string[] = [];
  const params: any[] = [];
  if (role_name && role_name !== 'All') {
    where.push('ls.role_name = ?');
    params.push(role_name);
  }
  if (user_id) {
    where.push('ls.user_id = ?');
    params.push(Number(user_id));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT ls.*, u.full_name, u.email
       FROM login_sessions ls
       JOIN users u ON ls.user_id = u.id
       ${whereSql}
       ORDER BY ls.login_at DESC LIMIT 250`
    )
    .all(...params);
  res.json({ sessions: rows });
});

// GET /api/auth/audit-logs (Strictly Super Admin ONLY)
router.get('/audit-logs', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 200);
  const { role_name, user_id, action, search } = req.query as Record<string, string | undefined>;
  const where: string[] = [];
  const params: any[] = [];

  if (role_name && role_name !== 'All') {
    where.push('a.role_name = ?');
    params.push(role_name);
  }
  if (user_id && user_id !== 'All') {
    where.push('a.user_id = ?');
    params.push(Number(user_id));
  }
  if (action && action !== 'All') {
    where.push('a.action = ?');
    params.push(action);
  }
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    where.push('(a.user_email LIKE ? OR a.action LIKE ? OR a.entity_id LIKE ? OR a.details_json LIKE ? OR u.full_name LIKE ?)');
    params.push(q, q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const logs = db
    .prepare(
      `SELECT a.*, u.full_name as user_full_name
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       ${whereSql}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`
    )
    .all(...params, limit);
  res.json({ logs });
});

export default router;
