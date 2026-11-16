import { Router } from 'express';
import { db } from '../db.ts';
import {
  type AuthRequest,
  getSuperAdminNotificationPrefs,
  notifyAdmins,
  requireAuth,
  requireRole,
  setSuperAdminNotificationPrefs,
  writeAuditLog,
} from '../auth.ts';
import { broadcastAll, getOnlineUserIds, sendToSuperAdmins, sendToUser } from '../realtime.ts';

const router = Router();

const DROPDOWN_GROUP_LABELS: Record<string, string> = {
  task_status: 'Task Statuses',
  work_category: 'Work / Issue Categories',
  priority: 'Priority Levels',
  department: 'Departments',
  device_type: 'Device Types',
  business_impact: 'Business Impact Levels',
  asset_category: 'IT Asset Categories',
  expense_category: 'Expense Categories',
};

function getUsageStats(groupKey: string, value: string, metaJson?: string | null): { total: number; details: string[] } {
  const details: string[] = [];
  let total = 0;

  if (groupKey === 'task_status') {
    const c = (db.prepare('SELECT COUNT(*) as c FROM tickets WHERE status = ?').get(value) as { c: number }).c;
    if (c > 0) {
      total += c;
      details.push(`${c} task(s)`);
    }
  } else if (groupKey === 'work_category') {
    const c = (db.prepare('SELECT COUNT(*) as c FROM tickets WHERE category = ?').get(value) as { c: number }).c;
    if (c > 0) {
      total += c;
      details.push(`${c} task(s)`);
    }
  } else if (groupKey === 'priority') {
    const tc = (db.prepare('SELECT COUNT(*) as c FROM tickets WHERE priority = ?').get(value) as { c: number }).c;
    const sc = (db.prepare('SELECT COUNT(*) as c FROM sla_configurations WHERE priority = ?').get(value) as { c: number }).c;
    if (tc > 0) {
      total += tc;
      details.push(`${tc} task(s)`);
    }
    if (sc > 0) {
      total += sc;
      details.push(`${sc} SLA policy`);
    }
  } else if (groupKey === 'department') {
    let deptId: number | null = null;
    if (metaJson) {
      try {
        deptId = JSON.parse(metaJson).department_id ?? null;
      } catch {
        deptId = null;
      }
    }
    const ec = deptId
      ? (db.prepare('SELECT COUNT(*) as c FROM employees WHERE department_id = ?').get(deptId) as { c: number }).c
      : 0;
    const tc = (
      db
        .prepare('SELECT COUNT(*) as c FROM tickets WHERE reporter_department = ? OR (? IS NOT NULL AND department_id = ?)')
        .get(value, deptId, deptId) as { c: number }
    ).c;
    if (ec > 0) {
      total += ec;
      details.push(`${ec} employee(s)`);
    }
    if (tc > 0) {
      total += tc;
      details.push(`${tc} task(s)`);
    }
  } else if (groupKey === 'device_type') {
    const c = (db.prepare('SELECT COUNT(*) as c FROM tickets WHERE device_type = ?').get(value) as { c: number }).c;
    if (c > 0) {
      total += c;
      details.push(`${c} task(s)`);
    }
  } else if (groupKey === 'business_impact') {
    const c = (db.prepare('SELECT COUNT(*) as c FROM tickets WHERE business_impact = ?').get(value) as { c: number }).c;
    if (c > 0) {
      total += c;
      details.push(`${c} task(s)`);
    }
  } else if (groupKey === 'asset_category') {
    const c = (db.prepare('SELECT COUNT(*) as c FROM it_assets WHERE category = ?').get(value) as { c: number }).c;
    if (c > 0) {
      total += c;
      details.push(`${c} asset(s)`);
    }
  } else if (groupKey === 'expense_category') {
    const c = (db.prepare('SELECT COUNT(*) as c FROM expenses WHERE category = ?').get(value) as { c: number }).c;
    if (c > 0) {
      total += c;
      details.push(`${c} expense(s)`);
    }
  }

  return { total, details };
}

// ==========================================
// 1. DIRECT CHAT (SUPER ADMIN <-> MODERATOR)
// ==========================================

router.get('/chat/conversations', requireAuth, requireRole('super_admin', 'moderator'), (req: AuthRequest, res) => {
  const user = req.user!;
  const onlineSet = new Set(getOnlineUserIds());

  if (user.role === 'super_admin') {
    const mods = db
      .prepare(
        `SELECT u.id as user_id, u.full_name, u.email, m.id as moderator_id, m.employee_code, m.specialization,
                (SELECT COUNT(*) FROM direct_messages dm WHERE dm.sender_user_id = u.id AND dm.recipient_user_id = ? AND dm.is_read = 0) as unread_count,
                (SELECT dm.message FROM direct_messages dm
                 WHERE (dm.sender_user_id = u.id AND dm.recipient_user_id = ?) OR (dm.sender_user_id = ? AND dm.recipient_user_id = u.id)
                 ORDER BY dm.id DESC LIMIT 1) as last_message,
                (SELECT dm.created_at FROM direct_messages dm
                 WHERE (dm.sender_user_id = u.id AND dm.recipient_user_id = ?) OR (dm.sender_user_id = ? AND dm.recipient_user_id = u.id)
                 ORDER BY dm.id DESC LIMIT 1) as last_message_at
         FROM users u
         JOIN roles r ON u.role_id = r.id
         JOIN moderators m ON m.user_id = u.id
         WHERE r.name = 'moderator' AND u.status = 'Active' AND m.status = 'Active'
         ORDER BY COALESCE(last_message_at, u.created_at) DESC, u.full_name ASC`
      )
      .all(user.id, user.id, user.id, user.id, user.id) as any[];

    const conversations = mods.map((m) => ({
      ...m,
      role: 'moderator',
      is_online: onlineSet.has(m.user_id),
    }));
    return res.json({ conversations });
  }

  // Moderator sees ONLY Super Admin conversation(s)
  const admins = db
    .prepare(
      `SELECT u.id as user_id, u.full_name, u.email,
              (SELECT COUNT(*) FROM direct_messages dm WHERE dm.sender_user_id = u.id AND dm.recipient_user_id = ? AND dm.is_read = 0) as unread_count,
              (SELECT dm.message FROM direct_messages dm
               WHERE (dm.sender_user_id = u.id AND dm.recipient_user_id = ?) OR (dm.sender_user_id = ? AND dm.recipient_user_id = u.id)
               ORDER BY dm.id DESC LIMIT 1) as last_message,
              (SELECT dm.created_at FROM direct_messages dm
               WHERE (dm.sender_user_id = u.id AND dm.recipient_user_id = ?) OR (dm.sender_user_id = ? AND dm.recipient_user_id = u.id)
               ORDER BY dm.id DESC LIMIT 1) as last_message_at
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'super_admin' AND u.status = 'Active'
       ORDER BY u.id ASC`
    )
    .all(user.id, user.id, user.id, user.id, user.id) as any[];

  const conversations = admins.map((a) => ({
    ...a,
    role: 'super_admin',
    specialization: 'Super Admin / IT Head',
    is_online: onlineSet.has(a.user_id),
  }));
  res.json({ conversations });
});

router.get('/chat/unread-summary', requireAuth, requireRole('super_admin', 'moderator'), (req: AuthRequest, res) => {
  const user = req.user!;
  const totalUnread = (
    db
      .prepare('SELECT COUNT(*) as c FROM direct_messages WHERE recipient_user_id = ? AND is_read = 0')
      .get(user.id) as { c: number }
  ).c;

  const recentMessages = db
    .prepare(
      `SELECT dm.*, su.full_name as sender_name, sr.name as sender_role, t.ticket_number
       FROM direct_messages dm
       JOIN users su ON dm.sender_user_id = su.id
       JOIN roles sr ON su.role_id = sr.id
       LEFT JOIN tickets t ON dm.ticket_id = t.id
       WHERE dm.recipient_user_id = ? OR dm.sender_user_id = ?
       ORDER BY dm.id DESC
       LIMIT 15`
    )
    .all(user.id, user.id);

  res.json({ totalUnread, recentMessages });
});

router.get('/chat/messages', requireAuth, requireRole('super_admin', 'moderator'), (req: AuthRequest, res) => {
  const user = req.user!;
  const peerUserId = Number(req.query.peer_user_id);
  const ticketFilterId = req.query.ticket_id ? Number(req.query.ticket_id) : null;

  if (!peerUserId) {
    return res.status(400).json({ error: 'peer_user_id is required' });
  }

  const peer = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.status, r.name as role_name
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`
    )
    .get(peerUserId) as { id: number; full_name: string; email: string; status: string; role_name: string } | undefined;

  if (!peer) {
    return res.status(404).json({ error: 'Conversation participant not found' });
  }

  if (user.role === 'moderator' && peer.role_name !== 'super_admin') {
    return res.status(403).json({ error: 'Moderators can only chat directly with the Super Admin' });
  }
  if (user.role === 'super_admin' && peer.role_name !== 'moderator') {
    return res.status(403).json({ error: 'Super Admin direct chat is between Super Admin and Moderators' });
  }

  const params: any[] = [user.id, peerUserId, peerUserId, user.id];
  let ticketClause = '';
  if (ticketFilterId) {
    ticketClause = 'AND dm.ticket_id = ?';
    params.push(ticketFilterId);
  }

  const messages = db
    .prepare(
      `SELECT dm.*,
              su.full_name as sender_name,
              sr.name as sender_role,
              t.ticket_number,
              t.status as ticket_status
       FROM direct_messages dm
       JOIN users su ON dm.sender_user_id = su.id
       JOIN roles sr ON su.role_id = sr.id
       LEFT JOIN tickets t ON dm.ticket_id = t.id
       WHERE ((dm.sender_user_id = ? AND dm.recipient_user_id = ?) OR (dm.sender_user_id = ? AND dm.recipient_user_id = ?))
         ${ticketClause}
       ORDER BY dm.id ASC
       LIMIT 300`
    )
    .all(...params);

  // Mark incoming messages as read
  const nowIso = new Date().toISOString();
  const markRes = db
    .prepare(
      `UPDATE direct_messages SET is_read = 1, read_at = ?
       WHERE sender_user_id = ? AND recipient_user_id = ? AND is_read = 0`
    )
    .run(nowIso, peerUserId, user.id);

  if (markRes.changes > 0) {
    sendToUser(peerUserId, 'chat:read', { by_user_id: user.id, read_at: nowIso });
  }

  res.json({ messages, peer });
});

router.post('/chat/mark-read', requireAuth, requireRole('super_admin', 'moderator'), (req: AuthRequest, res) => {
  const user = req.user!;
  const peerUserId = Number(req.body?.peer_user_id);
  if (!peerUserId) {
    return res.status(400).json({ error: 'peer_user_id is required' });
  }
  const nowIso = new Date().toISOString();
  const markRes = db
    .prepare(
      `UPDATE direct_messages SET is_read = 1, read_at = ?
       WHERE sender_user_id = ? AND recipient_user_id = ? AND is_read = 0`
    )
    .run(nowIso, peerUserId, user.id);
  if (markRes.changes > 0) {
    sendToUser(peerUserId, 'chat:read', { by_user_id: user.id, read_at: nowIso });
  }
  res.json({ ok: true, marked: markRes.changes });
});

router.post('/chat/messages', requireAuth, requireRole('super_admin', 'moderator'), (req: AuthRequest, res) => {
  const user = req.user!;
  const { recipient_user_id, message, ticket_id } = req.body as {
    recipient_user_id?: number;
    message?: string;
    ticket_id?: number | null;
  };

  if (!recipient_user_id || !message || !message.trim()) {
    return res.status(400).json({ error: 'Recipient and message text are required' });
  }

  const recipient = db
    .prepare(
      `SELECT u.id, u.full_name, u.status, r.name as role_name
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`
    )
    .get(Number(recipient_user_id)) as { id: number; full_name: string; status: string; role_name: string } | undefined;

  if (!recipient || recipient.status !== 'Active') {
    return res.status(404).json({ error: 'Active recipient not found' });
  }

  if (user.role === 'moderator' && recipient.role_name !== 'super_admin') {
    return res.status(403).json({ error: 'Moderators can only send direct messages to the Super Admin' });
  }
  if (user.role === 'super_admin' && recipient.role_name !== 'moderator') {
    return res.status(403).json({ error: 'Super Admin direct chat targets active moderators' });
  }

  let linkedTicket: { id: number; ticket_number: string; assigned_moderator_id: number | null } | undefined;
  if (ticket_id) {
    linkedTicket = db
      .prepare('SELECT id, ticket_number, assigned_moderator_id FROM tickets WHERE id = ?')
      .get(Number(ticket_id)) as any;
    if (!linkedTicket) {
      return res.status(404).json({ error: 'Linked task not found' });
    }
    if (user.role === 'moderator' && linkedTicket.assigned_moderator_id !== user.moderator_id) {
      return res.status(403).json({ error: 'You can only link tasks assigned to you' });
    }
  }

  const nowIso = new Date().toISOString();
  const cleanMsg = message.trim();
  const ins = db
    .prepare(
      `INSERT INTO direct_messages (sender_user_id, recipient_user_id, ticket_id, message, is_read, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    )
    .run(user.id, recipient.id, linkedTicket ? linkedTicket.id : null, cleanMsg, nowIso);

  const created = db
    .prepare(
      `SELECT dm.*, su.full_name as sender_name, sr.name as sender_role, t.ticket_number, t.status as ticket_status
       FROM direct_messages dm
       JOIN users su ON dm.sender_user_id = su.id
       JOIN roles sr ON su.role_id = sr.id
       LEFT JOIN tickets t ON dm.ticket_id = t.id
       WHERE dm.id = ?`
    )
    .get(ins.lastInsertRowid) as any;

  // Broadcast live to both sender and recipient via WebSocket
  sendToUser(recipient.id, 'chat:message', created);
  sendToUser(user.id, 'chat:message', created);

  if (user.role === 'moderator') {
    notifyAdmins({
      ticketId: linkedTicket ? linkedTicket.id : null,
      title: `Direct Message from ${user.full_name}`,
      message: `${linkedTicket ? `[${linkedTicket.ticket_number}] ` : ''}${cleanMsg.slice(0, 140)}`,
      type: 'info',
      eventKey: `chat_msg:${created.id}`,
    });
  }

  writeAuditLog({
    userId: user.id,
    userEmail: user.email,
    roleName: user.role,
    action: 'SEND_DIRECT_CHAT',
    entityType: 'direct_message',
    entityId: String(created.id),
    details: { recipient_id: recipient.id, ticket_id: linkedTicket?.id || null },
    ipAddress: req.ip,
  });

  res.status(201).json({ message: created });
});

// ==========================================
// 2. SUPER ADMIN NOTIFICATION PREFERENCES
// ==========================================

router.get('/notifications/preferences', requireAuth, requireRole('super_admin'), (_req, res) => {
  res.json(getSuperAdminNotificationPrefs());
});

router.put('/notifications/preferences', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const current = getSuperAdminNotificationPrefs();
  const next = setSuperAdminNotificationPrefs(
    {
      enabled: req.body?.enabled !== undefined ? Boolean(req.body.enabled) : current.enabled,
      popups_enabled: req.body?.popups_enabled !== undefined ? Boolean(req.body.popups_enabled) : current.popups_enabled,
    },
    req.user!.id
  );

  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'UPDATE_NOTIFICATION_PREFS',
    entityType: 'settings',
    entityId: 'super_admin_notifications',
    details: next as unknown as Record<string, unknown>,
    ipAddress: req.ip,
  });

  sendToSuperAdmins('notifications:prefs', next);
  res.json(next);
});

// ==========================================
// 3. COMPLETE DROPDOWN MANAGEMENT (SUPER ADMIN ONLY)
// ==========================================

router.get('/dropdowns', requireAuth, (req: AuthRequest, res) => {
  const includeInactive = req.query.include_inactive === '1' && req.user!.role === 'super_admin';
  const rows = db
    .prepare(
      `SELECT * FROM dropdown_options
       ${includeInactive ? '' : 'WHERE is_active = 1'}
       ORDER BY group_key ASC, sort_order ASC, id ASC`
    )
    .all() as any[];

  const optionsByGroup: Record<string, any[]> = {};
  for (const key of Object.keys(DROPDOWN_GROUP_LABELS)) {
    optionsByGroup[key] = [];
  }

  for (const row of rows) {
    let meta: any = {};
    if (row.meta_json) {
      try {
        meta = JSON.parse(row.meta_json);
      } catch {
        meta = {};
      }
    }
    const enriched: any = {
      id: row.id,
      group_key: row.group_key,
      label: row.label,
      value: row.value,
      sort_order: row.sort_order,
      is_active: Boolean(row.is_active),
      is_system: Boolean(row.is_system),
      meta,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    if (includeInactive) {
      enriched.usage = getUsageStats(row.group_key, row.value, row.meta_json);
    }
    if (!optionsByGroup[row.group_key]) {
      optionsByGroup[row.group_key] = [];
    }
    optionsByGroup[row.group_key].push(enriched);
  }

  res.json({
    groups: Object.entries(DROPDOWN_GROUP_LABELS).map(([key, label]) => ({ key, label })),
    optionsByGroup,
  });
});

router.post('/dropdowns', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const { group_key, label, sort_order, is_active, meta } = req.body as {
    group_key?: string;
    label?: string;
    sort_order?: number;
    is_active?: boolean;
    meta?: Record<string, any>;
  };

  if (!group_key || !DROPDOWN_GROUP_LABELS[group_key]) {
    return res.status(400).json({ error: 'Valid dropdown group_key is required' });
  }
  const cleanLabel = (label || '').trim();
  if (!cleanLabel) {
    return res.status(400).json({ error: 'Option name / label is required' });
  }

  const dup = db
    .prepare('SELECT id FROM dropdown_options WHERE group_key = ? AND lower(value) = lower(?)')
    .get(group_key, cleanLabel);
  if (dup) {
    return res.status(400).json({ error: `Option "${cleanLabel}" already exists in ${DROPDOWN_GROUP_LABELS[group_key]}.` });
  }

  const maxOrderRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM dropdown_options WHERE group_key = ?')
    .get(group_key) as { m: number };
  const nextOrder = sort_order !== undefined ? Number(sort_order) : maxOrderRow.m + 1;

  const tx = db.transaction(() => {
    let nextMeta = meta ? { ...meta } : {};
    if (group_key === 'department') {
      const code = (meta?.code || cleanLabel.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'DEPT') +
        '-' +
        Math.floor(100 + Math.random() * 900);
      const existingDept = db.prepare('SELECT id, code FROM departments WHERE lower(name) = lower(?)').get(cleanLabel) as
        | { id: number; code: string }
        | undefined;
      if (existingDept) {
        nextMeta.department_id = existingDept.id;
        nextMeta.code = existingDept.code;
      } else {
        const dRes = db
          .prepare('INSERT INTO departments (name, code, cost_center) VALUES (?, ?, ?)')
          .run(cleanLabel, code, meta?.cost_center || '');
        nextMeta.department_id = Number(dRes.lastInsertRowid);
        nextMeta.code = code;
      }
    }

    const r = db
      .prepare(
        `INSERT INTO dropdown_options (group_key, label, value, sort_order, is_active, is_system, meta_json, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, datetime('now'))`
      )
      .run(group_key, cleanLabel, cleanLabel, nextOrder, is_active === false ? 0 : 1, Object.keys(nextMeta).length ? JSON.stringify(nextMeta) : null);

    return Number(r.lastInsertRowid);
  });

  const newId = tx();

  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'CREATE_DROPDOWN_OPTION',
    entityType: 'dropdown_option',
    entityId: String(newId),
    details: { group_key, label: cleanLabel },
    ipAddress: req.ip,
  });

  broadcastAll('dropdowns:updated', { group_key });
  res.status(201).json({ id: newId });
});

router.put('/dropdowns/:id', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM dropdown_options WHERE id = ?').get(id) as any;
  if (!existing) {
    return res.status(404).json({ error: 'Dropdown option not found' });
  }

  const { label, sort_order, is_active, meta } = req.body as {
    label?: string;
    sort_order?: number;
    is_active?: boolean;
    meta?: Record<string, any>;
  };

  const nextLabel = label !== undefined ? label.trim() : existing.label;
  if (!nextLabel) {
    return res.status(400).json({ error: 'Option name cannot be empty' });
  }

  if (nextLabel.toLowerCase() !== existing.value.toLowerCase()) {
    const dup = db
      .prepare('SELECT id FROM dropdown_options WHERE group_key = ? AND lower(value) = lower(?) AND id != ?')
      .get(existing.group_key, nextLabel, id);
    if (dup) {
      return res.status(400).json({ error: `Another option named "${nextLabel}" already exists in this dropdown.` });
    }
  }

  let parsedMeta: any = {};
  if (existing.meta_json) {
    try {
      parsedMeta = JSON.parse(existing.meta_json);
    } catch {
      parsedMeta = {};
    }
  }
  const mergedMeta = meta ? { ...parsedMeta, ...meta } : parsedMeta;

  db.transaction(() => {
    db.prepare(
      `UPDATE dropdown_options
       SET label = ?, value = ?, sort_order = ?, is_active = ?, meta_json = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      nextLabel,
      nextLabel,
      sort_order !== undefined ? Number(sort_order) : existing.sort_order,
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      Object.keys(mergedMeta).length ? JSON.stringify(mergedMeta) : null,
      id
    );

    // Cascade rename cleanly to existing records so data integrity is preserved
    if (nextLabel !== existing.value) {
      if (existing.group_key === 'task_status') {
        db.prepare('UPDATE tickets SET status = ? WHERE status = ?').run(nextLabel, existing.value);
        db.prepare('UPDATE ticket_activities SET previous_status = ? WHERE previous_status = ?').run(nextLabel, existing.value);
        db.prepare('UPDATE ticket_activities SET new_status = ? WHERE new_status = ?').run(nextLabel, existing.value);
      } else if (existing.group_key === 'work_category') {
        db.prepare('UPDATE tickets SET category = ? WHERE category = ?').run(nextLabel, existing.value);
      } else if (existing.group_key === 'priority') {
        db.prepare('UPDATE tickets SET priority = ? WHERE priority = ?').run(nextLabel, existing.value);
        db.prepare('UPDATE sla_configurations SET priority = ? WHERE priority = ?').run(nextLabel, existing.value);
      } else if (existing.group_key === 'department') {
        db.prepare('UPDATE tickets SET reporter_department = ? WHERE reporter_department = ?').run(nextLabel, existing.value);
        if (mergedMeta.department_id) {
          db.prepare('UPDATE departments SET name = ? WHERE id = ?').run(nextLabel, mergedMeta.department_id);
        } else {
          db.prepare('UPDATE departments SET name = ? WHERE name = ?').run(nextLabel, existing.value);
        }
      } else if (existing.group_key === 'device_type') {
        db.prepare('UPDATE tickets SET device_type = ? WHERE device_type = ?').run(nextLabel, existing.value);
      } else if (existing.group_key === 'business_impact') {
        db.prepare('UPDATE tickets SET business_impact = ? WHERE business_impact = ?').run(nextLabel, existing.value);
      } else if (existing.group_key === 'asset_category') {
        db.prepare('UPDATE it_assets SET category = ? WHERE category = ?').run(nextLabel, existing.value);
      } else if (existing.group_key === 'expense_category') {
        db.prepare('UPDATE expenses SET category = ? WHERE category = ?').run(nextLabel, existing.value);
      }
    }
  })();

  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'UPDATE_DROPDOWN_OPTION',
    entityType: 'dropdown_option',
    entityId: String(id),
    details: { group_key: existing.group_key, old_label: existing.label, new_label: nextLabel, is_active },
    ipAddress: req.ip,
  });

  broadcastAll('dropdowns:updated', { group_key: existing.group_key });
  res.json({ ok: true });
});

router.patch('/dropdowns/reorder', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const { group_key, ordered_ids } = req.body as { group_key?: string; ordered_ids?: number[] };
  if (!group_key || !Array.isArray(ordered_ids) || ordered_ids.length === 0) {
    return res.status(400).json({ error: 'group_key and ordered_ids are required' });
  }

  const stmt = db.prepare("UPDATE dropdown_options SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND group_key = ?");
  db.transaction(() => {
    ordered_ids.forEach((optId, index) => {
      stmt.run(index + 1, Number(optId), group_key);
    });
  })();

  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'REORDER_DROPDOWN_OPTIONS',
    entityType: 'dropdown_option',
    entityId: group_key,
    details: { ordered_ids },
    ipAddress: req.ip,
  });

  broadcastAll('dropdowns:updated', { group_key });
  res.json({ ok: true });
});

router.delete('/dropdowns/:id', requireAuth, requireRole('super_admin'), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM dropdown_options WHERE id = ?').get(id) as any;
  if (!existing) {
    return res.status(404).json({ error: 'Dropdown option not found' });
  }
  if (existing.is_system) {
    return res.status(400).json({ error: `"${existing.label}" is a core workflow option and cannot be deleted (you may rename or deactivate non-core options).` });
  }

  const migrateToId = req.query.migrate_to_id ? Number(req.query.migrate_to_id) : req.body?.migrate_to_id ? Number(req.body.migrate_to_id) : null;
  const usage = getUsageStats(existing.group_key, existing.value, existing.meta_json);

  if (usage.total > 0 && !migrateToId) {
    return res.status(409).json({
      error: `Cannot delete "${existing.label}" because it is currently used by ${usage.details.join(' and ')}. Select a replacement option to safely migrate existing records first, or deactivate it instead.`,
      usage,
    });
  }

  let targetOpt: any = null;
  if (migrateToId) {
    targetOpt = db
      .prepare('SELECT * FROM dropdown_options WHERE id = ? AND group_key = ? AND id != ?')
      .get(migrateToId, existing.group_key, id);
    if (!targetOpt) {
      return res.status(400).json({ error: 'Valid replacement dropdown option in the same group is required for migration.' });
    }
  }

  db.transaction(() => {
    if (targetOpt) {
      if (existing.group_key === 'task_status') {
        db.prepare('UPDATE tickets SET status = ? WHERE status = ?').run(targetOpt.value, existing.value);
      } else if (existing.group_key === 'work_category') {
        db.prepare('UPDATE tickets SET category = ? WHERE category = ?').run(targetOpt.value, existing.value);
      } else if (existing.group_key === 'priority') {
        db.prepare('UPDATE tickets SET priority = ? WHERE priority = ?').run(targetOpt.value, existing.value);
      } else if (existing.group_key === 'department') {
        let oldDeptId: number | null = null;
        let newDeptId: number | null = null;
        try {
          oldDeptId = existing.meta_json ? JSON.parse(existing.meta_json).department_id ?? null : null;
          newDeptId = targetOpt.meta_json ? JSON.parse(targetOpt.meta_json).department_id ?? null : null;
        } catch {}
        db.prepare('UPDATE tickets SET reporter_department = ?, department_id = COALESCE(?, department_id) WHERE reporter_department = ?').run(
          targetOpt.value,
          newDeptId,
          existing.value
        );
        if (oldDeptId && newDeptId) {
          db.prepare('UPDATE employees SET department_id = ? WHERE department_id = ?').run(newDeptId, oldDeptId);
          db.prepare('DELETE FROM departments WHERE id = ?').run(oldDeptId);
        }
      } else if (existing.group_key === 'device_type') {
        db.prepare('UPDATE tickets SET device_type = ? WHERE device_type = ?').run(targetOpt.value, existing.value);
      } else if (existing.group_key === 'business_impact') {
        db.prepare('UPDATE tickets SET business_impact = ? WHERE business_impact = ?').run(targetOpt.value, existing.value);
      } else if (existing.group_key === 'asset_category') {
        db.prepare('UPDATE it_assets SET category = ? WHERE category = ?').run(targetOpt.value, existing.value);
      } else if (existing.group_key === 'expense_category') {
        db.prepare('UPDATE expenses SET category = ? WHERE category = ?').run(targetOpt.value, existing.value);
      }
    } else if (existing.group_key === 'department') {
      try {
        const oldDeptId = existing.meta_json ? JSON.parse(existing.meta_json).department_id ?? null : null;
        if (oldDeptId) {
          db.prepare('DELETE FROM departments WHERE id = ?').run(oldDeptId);
        }
      } catch {}
    }

    db.prepare('DELETE FROM dropdown_options WHERE id = ?').run(id);
  })();

  writeAuditLog({
    userId: req.user!.id,
    userEmail: req.user!.email,
    roleName: req.user!.role,
    action: 'DELETE_DROPDOWN_OPTION',
    entityType: 'dropdown_option',
    entityId: String(id),
    details: { group_key: existing.group_key, label: existing.label, migrated_to: targetOpt?.value || null },
    ipAddress: req.ip,
  });

  broadcastAll('dropdowns:updated', { group_key: existing.group_key });
  res.json({ ok: true });
});

export default router;
