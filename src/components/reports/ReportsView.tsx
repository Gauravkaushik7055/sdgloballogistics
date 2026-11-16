import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { ISSUE_CATEGORIES, LocationItem, ModeratorItem } from '../../types/index.ts';
import { apiFetch } from '../../utils/api.ts';
import { exportToCsv, exportToExcel, exportToPdf } from '../../utils/exportUtils.ts';

const REPORT_TYPES = [
  { id: 'daily', label: 'Daily Ticket Report' },
  { id: 'weekly', label: 'Weekly Ticket Report' },
  { id: 'monthly', label: 'Monthly Ticket Report' },
  { id: 'location', label: 'Location-Wise Issue Report' },
  { id: 'moderator', label: 'Moderator Performance Report' },
  { id: 'pending', label: 'Pending Ticket Report' },
  { id: 'resolution-time', label: 'Resolution Time Report' },
  { id: 'asset-maintenance', label: 'Asset Maintenance Report' },
  { id: 'budget', label: 'IT Budget Report' },
  { id: 'expense', label: 'Expense Report' },
  { id: 'employee', label: 'Employee-Wise Issue Report' },
  { id: 'sla-breach', label: 'SLA Breach Report' },
];

export default function ReportsView() {
  const { user } = useAuth();
  const [selectedReport, setSelectedReport] = useState('monthly');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [locationId, setLocationId] = useState('All');
  const [category, setCategory] = useState('All');
  const [moderatorId, setModeratorId] = useState('All');

  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [moderators, setModerators] = useState<ModeratorItem[]>([]);
  const [reportData, setReportData] = useState<{ title: string; rows: any[]; generatedAt: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (dateFrom) qs.set('date_from', dateFrom);
      if (dateTo) qs.set('date_to', dateTo);
      if (locationId !== 'All') qs.set('location_id', locationId);
      if (category !== 'All') qs.set('category', category);
      if (moderatorId !== 'All') qs.set('moderator_id', moderatorId);

      const res = await apiFetch<any>(`/api/reports/${selectedReport}?${qs.toString()}`);
      setReportData(res);
    } finally {
      setLoading(false);
    }
  }, [selectedReport, dateFrom, dateTo, locationId, category, moderatorId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    apiFetch<{ locations: LocationItem[] }>('/api/locations')
      .then((r) => setLocations(r.locations))
      .catch(() => {});
    if (user?.role !== 'moderator') {
      apiFetch<{ moderators: ModeratorItem[] }>('/api/moderators')
        .then((r) => setModerators(r.moderators))
        .catch(() => {});
    }
  }, [user]);

  const rows = reportData?.rows || [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const visibleReports =
    user?.role === 'moderator'
      ? REPORT_TYPES.filter((r) => !['budget', 'expense'].includes(r.id))
      : REPORT_TYPES;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Report Selector List */}
        <div className="lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-1 h-fit">
          <div className="px-2 py-1.5 text-xs font-semibold text-slate-500">Available Reports</div>
          {visibleReports.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedReport(r.id)}
              className={`w-full text-left px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                selectedReport === r.id
                  ? 'bg-blue-700 text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Report Workspace */}
        <div className="lg:col-span-9 space-y-4">
          {/* Filters & Export Bar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-display font-bold">{reportData?.title || 'Enterprise Report'}</h2>
                <p className="text-xs font-mono text-slate-500 mt-0.5">
                  {rows.length} record(s) matched
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={rows.length === 0}
                  onClick={() => exportToExcel(`SD_Global_${selectedReport}_report`, selectedReport, rows)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-40 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Excel (.xlsx)
                </button>
                <button
                  type="button"
                  disabled={rows.length === 0}
                  onClick={() => exportToPdf(`SD_Global_${selectedReport}_report`, reportData?.title || selectedReport, rows)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-blue-700 hover:opacity-90 text-white disabled:opacity-40 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  PDF
                </button>
                <button
                  type="button"
                  disabled={rows.length === 0}
                  onClick={() => exportToCsv(`SD_Global_${selectedReport}_report`, rows)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  CSV
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="All">All Locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.name}
                  </option>
                ))}
              </select>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="All">All Categories</option>
                {ISSUE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {user?.role !== 'moderator' && (
                <select
                  value={moderatorId}
                  onChange={(e) => setModeratorId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="All">All Moderators</option>
                  {moderators.map((m) => (
                    <option key={m.id} value={String(m.id)}>
                      {m.full_name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Report Table Preview */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-500">
                    {columns.map((col) => (
                      <th key={col} className="py-2.5 px-4 whitespace-nowrap capitalize">
                        {col.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loading ? (
                    <tr>
                      <td colSpan={Math.max(1, columns.length)} className="py-10 text-center text-slate-500">
                        Generating report...
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={Math.max(1, columns.length)} className="py-10 text-center text-slate-500">
                        No records match this report filter.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r, idx) => (
                      <tr key={idx}>
                        {columns.map((col) => (
                          <td key={col} className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap">
                            {r[col] === null || r[col] === undefined ? '—' : String(r[col])}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
