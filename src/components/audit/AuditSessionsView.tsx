import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search, Shield } from 'lucide-react';
import { apiFetch, formatDateTime } from '../../utils/api.ts';

export default function AuditSessionsView() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [roleFilter, setRoleFilter] = useState<string>('moderator');
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    const sessParams = new URLSearchParams();
    if (roleFilter !== 'All') sessParams.set('role_name', roleFilter);

    const logParams = new URLSearchParams({ limit: '250' });
    if (roleFilter !== 'All') logParams.set('role_name', roleFilter);
    if (search.trim()) logParams.set('search', search.trim());

    try {
      const [sRes, aRes] = await Promise.all([
        apiFetch<{ sessions: any[] }>(`/api/auth/sessions?${sessParams.toString()}`),
        apiFetch<{ logs: any[] }>(`/api/auth/audit-logs?${logParams.toString()}`),
      ]);
      setSessions(sRes.sessions);
      setLogs(aRes.logs);
    } catch {
      // handled by auth layer
    }
  }, [roleFilter, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="space-y-6">
      {/* Filter Bar (Super Admin Exclusive) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-blue-600" />
          <div>
            <h2 className="text-sm font-display font-bold">Super Admin Activity & Session Monitor</h2>
            <p className="text-xs text-slate-500">
              Complete tracking of moderator logins, invite-link activations, ticket actions, and system events. Visible strictly to Super Admin.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            <option value="moderator">Moderators Only</option>
            <option value="All">All Roles</option>
            <option value="super_admin">Super Admin</option>
            <option value="employee">Employees</option>
            <option value="management">Management</option>
          </select>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter email, action, ticket..."
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>

          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Sessions Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-display font-semibold">Login Sessions ({sessions.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-500">
                <th className="py-2.5 px-4">User</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4">Login Time</th>
                <th className="py-2.5 px-4">Last Activity</th>
                <th className="py-2.5 px-4">Logout Time</th>
                <th className="py-2.5 px-4 text-right">Duration</th>
                <th className="py-2.5 px-4">IP Address</th>
                <th className="py-2.5 px-4">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500">
                    No matching login sessions recorded.
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 px-4 font-medium">
                      {s.full_name} · <span className="text-slate-500">{s.email}</span>
                    </td>
                    <td className="py-2.5 px-4 capitalize">{s.role_name?.replace('_', ' ')}</td>
                    <td className="py-2.5 px-4 font-mono">{formatDateTime(s.login_at)}</td>
                    <td className="py-2.5 px-4 font-mono">{formatDateTime(s.last_activity_at || s.login_at)}</td>
                    <td className="py-2.5 px-4 font-mono">{formatDateTime(s.logout_at)}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{s.duration_minutes ?? 0} mins</td>
                    <td className="py-2.5 px-4 font-mono text-slate-500">{s.ip_address}</td>
                    <td className="py-2.5 px-4">
                      <span className={s.is_active ? 'text-emerald-600 font-semibold' : 'text-slate-500'}>
                        {s.is_active ? 'Active' : 'Ended'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Trail Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-display font-semibold">Security & Activity Audit Trail ({logs.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-500">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Actor</th>
                <th className="py-2.5 px-4">Action</th>
                <th className="py-2.5 px-4">Entity</th>
                <th className="py-2.5 px-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500">
                    No activity logs match the current filter.
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                      {formatDateTime(l.created_at)}
                    </td>
                    <td className="py-2.5 px-4">
                      <span>{l.user_full_name ? `${l.user_full_name} (${l.user_email})` : l.user_email || 'System'}</span>
                      {l.role_name && <span className="text-slate-400"> · {l.role_name}</span>}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-blue-700 dark:text-blue-400">{l.action}</td>
                    <td className="py-2.5 px-4 font-mono">
                      {l.entity_type} {l.entity_id ? `#${l.entity_id}` : ''}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 max-w-md break-all">
                      {l.details_json || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
