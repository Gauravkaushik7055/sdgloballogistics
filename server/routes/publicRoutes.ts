import { Router } from 'express';
import { db } from '../db.ts';

const router = Router();

// GET /api/public/live-overview — safe, non-PII live operational metrics for the public webpage
router.get('/live-overview', (_req, res) => {
  try {
    const locations = db
      .prepare('SELECT id, code, name, type, city, state FROM locations ORDER BY id ASC')
      .all() as Array<{ id: number; code: string; name: string; type: string; city: string; state: string }>;

    const slaTiers = db
      .prepare(
        `SELECT priority, first_response_minutes, resolution_hours, working_hours_start, working_hours_end
         FROM sla_configurations
         ORDER BY CASE priority
           WHEN 'Critical' THEN 1
           WHEN 'High' THEN 2
           WHEN 'Medium' THEN 3
           ELSE 4
         END`
      )
      .all() as Array<{
      priority: string;
      first_response_minutes: number;
      resolution_hours: number;
      working_hours_start: string;
      working_hours_end: string;
    }>;

    const counts = db
      .prepare(
        `SELECT
           COUNT(*) as total_tickets,
           SUM(CASE WHEN status IN ('Completed', 'Resolved', 'Closed') THEN 1 ELSE 0 END) as completed_tickets,
           SUM(CASE WHEN status NOT IN ('Completed', 'Resolved', 'Closed') THEN 1 ELSE 0 END) as active_tickets
         FROM tickets`
      )
      .get() as { total_tickets: number; completed_tickets: number; active_tickets: number } | undefined;

    const activeModerators = (
      db
        .prepare(
          `SELECT COUNT(*) as c
           FROM moderators m
           JOIN users u ON m.user_id = u.id
           WHERE u.status = 'Active'`
        )
        .get() as { c: number }
    ).c;

    res.json({
      company: {
        name: 'SD Global',
        portal_title: 'SD Global IT Operations & Support Desk',
        support_email: 'techsupport@sdgloballogistics.com',
      },
      metrics: {
        active_locations: locations.length,
        active_moderators: activeModerators,
        total_tickets: counts?.total_tickets || 0,
        active_tickets: counts?.active_tickets || 0,
        completed_tickets: counts?.completed_tickets || 0,
      },
      locations,
      sla_tiers: slaTiers,
      server_time: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load live operational overview' });
  }
});

// POST /api/public/track-ticket — safe ticket roadmap lookup verified by last 4 digits of reporter mobile
router.post('/track-ticket', (req, res) => {
  const { ticket_number, mobile_last4 } = req.body as {
    ticket_number?: string;
    mobile_last4?: string;
  };

  const cleanNumber = (ticket_number || '').trim().toUpperCase();
  const cleanDigits = (mobile_last4 || '').replace(/\D/g, '');

  if (!cleanNumber || cleanDigits.length !== 4) {
    return res.status(400).json({
      error: 'Enter a valid ticket number and the last 4 digits of your registered mobile number.',
    });
  }

  const ticket = db
    .prepare(
      `SELECT
         t.id,
         t.ticket_number,
         t.status,
         t.priority,
         t.category,
         t.device_name,
         t.reporter_mobile,
         t.created_at,
         t.updated_at,
         t.sla_resolution_due,
         t.assigned_moderator_id,
         l.name as location_name,
         e.mobile as employee_mobile
       FROM tickets t
       LEFT JOIN locations l ON t.location_id = l.id
       LEFT JOIN employees e ON t.employee_id = e.id
       WHERE upper(t.ticket_number) = ?`
    )
    .get(cleanNumber) as
    | {
        id: number;
        ticket_number: string;
        status: string;
        priority: string;
        category: string;
        device_name: string;
        reporter_mobile: string | null;
        created_at: string;
        updated_at: string;
        sla_resolution_due: string | null;
        assigned_moderator_id: number | null;
        location_name: string | null;
        employee_mobile: string | null;
      }
    | undefined;

  if (!ticket) {
    return res.status(404).json({
      error: 'No matching ticket found for that ticket number and mobile verification digits.',
    });
  }

  const candidatePhones = [ticket.reporter_mobile || '', ticket.employee_mobile || '']
    .map((p) => p.replace(/\D/g, ''))
    .filter((p) => p.length >= 4);

  const matched = candidatePhones.some((digits) => digits.slice(-4) === cleanDigits);
  if (!matched) {
    return res.status(404).json({
      error: 'No matching ticket found for that ticket number and mobile verification digits.',
    });
  }

  const timeline = db
    .prepare(
      `SELECT action_type as action, previous_status, new_status, created_at
       FROM ticket_activities
       WHERE ticket_id = ?
         AND (
           new_status IS NOT NULL
           OR action_type IN ('CREATED', 'ASSIGNED', 'STATUS_CHANGED', 'WORK_APPROVED_COMPLETED', 'REVISION_REQUESTED', 'REOPENED', 'EMPLOYEE_CONFIRMED')
         )
       ORDER BY created_at ASC, id ASC`
    )
    .all(ticket.id) as Array<{
    action: string;
    previous_status: string | null;
    new_status: string | null;
    created_at: string;
  }>;

  res.json({
    ticket: {
      ticket_number: ticket.ticket_number,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
      device_name: ticket.device_name,
      location_name: ticket.location_name || 'SD Global Hub',
      assignment_state: ticket.assigned_moderator_id ? 'Assigned to IT Engineer' : 'Pending Assignment',
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
      sla_resolution_due_at: ticket.sla_resolution_due,
    },
    timeline,
  });
});

export default router;
