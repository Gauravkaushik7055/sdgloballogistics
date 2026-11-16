import React, { useCallback, useEffect, useState } from 'react';
import { Filter, Plus, Search, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useDropdowns } from '../../context/DropdownContext.tsx';
import { LocationItem, ModeratorItem, TicketItem } from '../../types/index.ts';
import { apiFetch, formatDateTime, getPriorityColorClass, getStatusColorClass } from '../../utils/api.ts';

interface TicketsViewProps {
  onSelectTicket: (ticketId: number) => void;
  onOpenNewTicket: () => void;
  refreshTrigger: number;
}

export default function TicketsView({ onSelectTicket, onOpenNewTicket, refreshTrigger }: TicketsViewProps) {
  const { user, subscribeRealtime } = useAuth();
  const { getOptions } = useDropdowns();
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [moderators, setModerators] = useState<ModeratorItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [priority, setPriority] = useState('All');
  const [category, setCategory] = useState('All');
  const [locationId, setLocationId] = useState('All');
  const [moderatorId, setModeratorId] = useState('All');

  // Quick Assign modal state for Super Admin
  const [assigningTicket, setAssigningTicket] = useState<TicketItem | null>(null);
  const [assignModId, setAssignModId] = useState('');
  const [assignDeadline, setAssignDeadline] = useState('');
  const [assignReason, setAssignReason] = useState('');

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (status !== 'All') qs.set('status', status);
      if (priority !== 'All') qs.set('priority', priority);
      if (category !== 'All') qs.set('category', category);
      if (locationId !== 'All') qs.set('location_id', locationId);
      if (moderatorId !== 'All') qs.set('moderator_id', moderatorId);

      const res = await apiFetch<{ tickets: TicketItem[] }>(`/api/tickets?${qs.toString()}`);
      setTickets(res.tickets);
    } finally {
      setLoading(false);
    }
  }, [search, status, priority, category, locationId, moderatorId]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets, refreshTrigger]);

  useEffect(() => {
    return subscribeRealtime((evt) => {
      if (evt.event === 'ticket:updated') {
        loadTickets();
      }
    });
  }, [subscribeRealtime, loadTickets]);

  useEffect(() => {
    apiFetch<{ locations: LocationItem[] }>('/api/locations')
      .then((r) => setLocations(r.locations))
      .catch(() => {});
    if (user?.role === 'super_admin' || user?.role === 'management') {
      apiFetch<{ moderators: ModeratorItem[] }>('/api/moderators?include_super_admin=1')
        .then((r) => setModerators(r.moderators))
        .catch(() => {});
    }
  }, [user]);

  const handleQuickAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningTicket || !assignModId) return;
    await apiFetch(`/api/tickets/${assigningTicket.id}/assign`, {
      method: 'POST',
      body: JSON.stringify({
        moderator_id: Number(assignModId),
        deadline_at: assignDeadline ? new Date(assignDeadline).toISOString() : undefined,
        reason: assignReason || 'Assigned from Ticket Operations table',
      }),
    });
    setAssigningTicket(null);
    setAssignModId('');
    setAssignDeadline('');
    setAssignReason('');
    loadTickets();
  };

  return (
    <div className="space-y-5">
      {/* Toolbar & Filters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticket #, employee, device, branch, or description..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          {user?.role !== 'management' && user?.role !== 'moderator' && (
            <button
              type="button"
              onClick={onOpenNewTicket}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Submit New Ticket</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-1">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            <option value="All">All Statuses</option>
            {getOptions('task_status').map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            <option value="All">All Priorities</option>
            {getOptions('priority').map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            <option value="All">All Categories</option>
            {getOptions('work_category').map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            <option value="All">All Locations</option>
            {locations.map((l) => (
              <option key={l.id} value={String(l.id)}>
                {l.name}
              </option>
            ))}
          </select>

          {(user?.role === 'super_admin' || user?.role === 'management') && (
            <select
              value={moderatorId}
              onChange={(e) => setModeratorId(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value="All">All Assignees</option>
              <option value="unassigned">Unassigned Only</option>
              {moderators.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.full_name}
                  {m.assignee_role === 'super_admin' ? ' (Super Admin)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* High-Density Ticket Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <span className="font-mono tabular-nums">{tickets.length} ticket(s)</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setStatus('All');
              setPriority('All');
              setCategory('All');
              setLocationId('All');
              setModeratorId('All');
            }}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
          >
            Reset Filters
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 whitespace-nowrap">Ticket #</th>
                <th className="py-2.5 px-4">Issue & Device</th>
                <th className="py-2.5 px-4">Location</th>
                <th className="py-2.5 px-4">Reporter</th>
                <th className="py-2.5 px-4">Priority</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Moderator</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Submitted</th>
                {user?.role === 'super_admin' && <th className="py-2.5 px-4 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    Loading tickets...
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    No tickets match the current filters.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => onSelectTicket(t.id)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-4 font-mono font-semibold text-blue-700 dark:text-blue-400 whitespace-nowrap">
                      {t.ticket_number}
                      {t.sla_breached === 1 && !['Completed', 'Resolved', 'Closed'].includes(t.status) && (
                        <div className="text-[10px] font-sans font-semibold text-red-600 dark:text-red-400 mt-0.5">
                          SLA Breached
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 max-w-[260px]">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{t.category}</div>
                      <div className="text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {t.device_name} · {t.description}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-800 dark:text-slate-200">{t.location_name || t.reporter_branch_name}</div>
                      <div className="text-slate-500 dark:text-slate-400">{t.reporter_city}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-800 dark:text-slate-200">{t.reporter_name}</div>
                      <div className="font-mono text-slate-500 dark:text-slate-400">{t.reporter_employee_code}</div>
                    </td>
                    <td className={`py-3 px-4 whitespace-nowrap ${getPriorityColorClass(t.priority)}`}>{t.priority}</td>
                    <td className={`py-3 px-4 font-semibold whitespace-nowrap ${getStatusColorClass(t.status)}`}>
                      {t.status}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-slate-700 dark:text-slate-300">
                      {t.moderator_name ? (
                        <span>
                          {t.moderator_name}
                          {t.moderator_role === 'super_admin' && (
                            <span className="ml-1 text-[10px] font-semibold text-blue-700 dark:text-blue-400">
                              (Super Admin)
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatDateTime(t.created_at)}
                    </td>
                    {user?.role === 'super_admin' && (
                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => {
                            setAssigningTicket(t);
                            setAssignModId(t.assigned_moderator_id ? String(t.assigned_moderator_id) : '');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                        >
                          <UserPlus className="w-3 h-3" />
                          <span>{t.assigned_moderator_id ? 'Reassign' : 'Assign'}</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Assign Modal */}
      {assigningTicket && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleQuickAssign}
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-display font-bold">
                Assign Work · {assigningTicket.ticket_number}
              </h3>
              {moderators.find((m) => m.assignee_role === 'super_admin') && (
                <button
                  type="button"
                  onClick={() => {
                    const selfMod = moderators.find((m) => m.assignee_role === 'super_admin');
                    if (selfMod) setAssignModId(String(selfMod.id));
                  }}
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 cursor-pointer"
                >
                  Select Myself
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {assigningTicket.category} at {assigningTicket.reporter_branch_name}
            </p>
            <div>
              <label className="block text-xs font-medium mb-1">Select Assignee (Super Admin or Moderator) *</label>
              <select
                required
                value={assignModId}
                onChange={(e) => setAssignModId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="">Choose assignee...</option>
                {moderators
                  .filter((m) => m.status === 'Active')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}
                      {m.assignee_role === 'super_admin' ? ' (Super Admin · Self)' : ''} (Workload: {m.current_workload}/
                      {m.max_capacity}) · {m.specialization}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Target Deadline (Optional)</label>
              <input
                type="datetime-local"
                value={assignDeadline}
                onChange={(e) => setAssignDeadline(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Assignment Note</label>
              <input
                value={assignReason}
                onChange={(e) => setAssignReason(e.target.value)}
                placeholder="Location match / specialization"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAssigningTicket(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800"
              >
                Confirm Assignment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
