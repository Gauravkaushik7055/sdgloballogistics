import React, { useCallback, useEffect, useState } from 'react';
import { Check, Download, FileText, Plus, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useDropdowns } from '../../context/DropdownContext.tsx';
import { LocationItem } from '../../types/index.ts';
import { apiFetch, formatCurrency, getAuthToken } from '../../utils/api.ts';
import { exportToCsv, exportToExcel, exportToPdf } from '../../utils/exportUtils.ts';

export default function BudgetExpensesView() {
  const { user } = useAuth();
  const { getOptions } = useDropdowns();
  const expenseCategories = getOptions('expense_category');
  const [data, setData] = useState<any>(null);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);

  const [budgetModal, setBudgetModal] = useState(false);
  const [expenseModal, setExpenseModal] = useState(false);

  // Budget form
  const [bYear, setBYear] = useState('2026');
  const [bMonth, setBMonth] = useState('0');
  const [bLocId, setBLocId] = useState('');
  const [bAmount, setBAmount] = useState('');
  const [bNotes, setBNotes] = useState('');

  // Expense form
  const [eCategory, setECategory] = useState<string>(() => expenseCategories[0] || 'Hardware Purchase');
  const [eTicketId, setETicketId] = useState('');
  const [eVendorName, setEVendorName] = useState('');
  const [eLocId, setELocId] = useState('');
  const [eAmount, setEAmount] = useState('');
  const [eInvoiceNum, setEInvoiceNum] = useState('');
  const [ePayDate, setEPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [eDesc, setEDesc] = useState('');
  const [eFile, setEFile] = useState<File | null>(null);

  const loadBudget = useCallback(async () => {
    const res = await apiFetch<any>('/api/budgets?year=2026');
    setData(res);
  }, []);

  useEffect(() => {
    loadBudget();
    apiFetch<{ locations: LocationItem[] }>('/api/locations')
      .then((r) => setLocations(r.locations))
      .catch(() => {});
    apiFetch<{ tickets: any[] }>('/api/tickets')
      .then((r) => setTickets(r.tickets))
      .catch(() => {});
    apiFetch<{ vendors: any[] }>('/api/vendors')
      .then((r) => setVendors(r.vendors))
      .catch(() => {});
  }, [loadBudget]);

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/budgets', {
      method: 'POST',
      body: JSON.stringify({
        fiscal_year: Number(bYear),
        month: Number(bMonth),
        location_id: bLocId ? Number(bLocId) : null,
        allocated_amount: Number(bAmount),
        notes: bNotes,
      }),
    });
    setBudgetModal(false);
    setBAmount('');
    setBNotes('');
    loadBudget();
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('category', eCategory);
    if (eTicketId) fd.append('ticket_id', eTicketId);
    fd.append('vendor_name', eVendorName);
    if (eLocId) fd.append('location_id', eLocId);
    fd.append('amount', eAmount);
    fd.append('invoice_number', eInvoiceNum);
    fd.append('payment_date', ePayDate);
    fd.append('description', eDesc);
    if (eFile) fd.append('invoice', eFile);

    await apiFetch('/api/expenses', { method: 'POST', body: fd });
    setExpenseModal(false);
    setEVendorName('');
    setEAmount('');
    setEInvoiceNum('');
    setEDesc('');
    setEFile(null);
    loadBudget();
  };

  const handleApprove = async (expenseId: number, decision: 'Approved' | 'Rejected') => {
    await apiFetch(`/api/expenses/${expenseId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ decision, remarks: `${decision} by IT Head` }),
    });
    loadBudget();
  };

  const summary = data?.summary || {};
  const expenses = data?.expenses || [];
  const locationSummary = data?.locationSummary || [];
  const tokenQuery = getAuthToken() ? `?token=${encodeURIComponent(getAuthToken()!)}` : '';

  const exportExpenseRows = expenses.map((e: any) => ({
    Date: e.payment_date,
    Invoice: e.invoice_number,
    Category: e.category,
    Vendor: e.vendor_name,
    Location: e.location_name || 'Global',
    Ticket: e.ticket_number || '-',
    Amount_USD: e.amount,
    Status: e.approval_status,
    Approved_By: e.approved_by_name || '-',
  }));

  return (
    <div className="space-y-6">
      {/* Header & Exports */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-display font-bold">IT Budget & Expense Management (FY 2026)</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Track annual, monthly, and location-wise budgets, vendor invoices, and ticket spare part expenses.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => exportToExcel('SD_Global_IT_Expenses_2026', 'Expenses', exportExpenseRows)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
          <button
            type="button"
            onClick={() => exportToPdf('SD_Global_IT_Expenses_2026', 'IT Budget & Expense Report', exportExpenseRows)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            PDF
          </button>
          <button
            type="button"
            onClick={() => exportToCsv('SD_Global_IT_Expenses_2026', exportExpenseRows)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            CSV
          </button>

          {user?.role === 'super_admin' && (
            <>
              <button
                type="button"
                onClick={() => setBudgetModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Allocate Budget
              </button>
              <button
                type="button"
                onClick={() => setExpenseModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Record Expense
              </button>
            </>
          )}
        </div>
      </div>

      {/* Budget Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Allocated Annual Budget</div>
          <div className="mt-1 text-2xl font-mono font-semibold tabular-nums">
            {formatCurrency(summary.totalAnnualBudget)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Total Approved Spent</div>
          <div className="mt-1 text-2xl font-mono font-semibold tabular-nums text-blue-700 dark:text-blue-400">
            {formatCurrency(summary.totalApprovedSpent)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Pending Approvals</div>
          <div className="mt-1 text-2xl font-mono font-semibold tabular-nums text-amber-700 dark:text-amber-400">
            {formatCurrency(summary.totalPendingSpent)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Remaining Budget</div>
          <div className="mt-1 text-2xl font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatCurrency(summary.remainingBudget)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">Budget Utilization</div>
          <div className="mt-1 text-2xl font-mono font-semibold tabular-nums">{summary.utilizationPct ?? 0}%</div>
        </div>
      </div>

      {/* Location-wise Budget vs Expenditure Chart */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
        <h3 className="text-sm font-display font-semibold mb-1">Location-Wise Budget Allocation vs Expenditure</h3>
        <p className="text-xs text-slate-500 mb-4">Annual allocation compared against approved branch spending</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={locationSummary}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.4} />
              <XAxis dataKey="location_code" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} />
              <Tooltip formatter={(val: any) => formatCurrency(Number(val))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="allocated" name="Allocated Budget" fill="#94a3b8" />
              <Bar dataKey="spent" name="Approved Spent" fill="#1d4ed8" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Expenses Ledger Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-display font-semibold">IT Expense & Invoice Register ({expenses.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-500">
                <th className="py-2.5 px-4">Date & Invoice</th>
                <th className="py-2.5 px-4">Category & Description</th>
                <th className="py-2.5 px-4">Vendor</th>
                <th className="py-2.5 px-4">Hub / Ticket</th>
                <th className="py-2.5 px-4 text-right">Amount</th>
                <th className="py-2.5 px-4">Approval Status</th>
                {user?.role === 'super_admin' && <th className="py-2.5 px-4 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {expenses.map((e: any) => (
                <tr key={e.id}>
                  <td className="py-3 px-4 font-mono">
                    <div>{e.payment_date}</div>
                    <div className="text-slate-500">{e.invoice_number}</div>
                    {e.invoice_attachment_path && (
                      <a
                        href={`/api/expenses/${e.id}/invoice${tokenQuery}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline font-sans"
                      >
                        View Invoice
                      </a>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold">{e.category}</div>
                    <div className="text-slate-500 max-w-[260px] truncate">{e.description}</div>
                  </td>
                  <td className="py-3 px-4">{e.vendor_name}</td>
                  <td className="py-3 px-4">
                    <div>{e.location_name || 'Global'}</div>
                    <div className="font-mono text-slate-500">{e.ticket_number || '—'}</div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums">
                    {formatCurrency(e.amount)}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`font-semibold ${
                        e.approval_status === 'Approved'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : e.approval_status === 'Rejected'
                          ? 'text-red-600'
                          : 'text-amber-600'
                      }`}
                    >
                      {e.approval_status}
                    </span>
                    {e.approved_by_name && <div className="text-[11px] text-slate-400">By {e.approved_by_name}</div>}
                  </td>
                  {user?.role === 'super_admin' && (
                    <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                      {e.approval_status === 'Pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleApprove(e.id, 'Approved')}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-emerald-600 text-white cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApprove(e.id, 'Rejected')}
                            className="px-2 py-1 text-[11px] font-semibold rounded border border-red-300 text-red-600 cursor-pointer"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Allocate Budget Modal */}
      {budgetModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveBudget}
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-display font-bold">Allocate IT Budget</h3>
              <button type="button" onClick={() => setBudgetModal(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                required
                value={bYear}
                onChange={(e) => setBYear(e.target.value)}
                placeholder="Fiscal Year"
                className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <select
                value={bMonth}
                onChange={(e) => setBMonth(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="0">Annual Budget</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={String(m)}>
                    Month {String(m).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </div>
            <select
              value={bLocId}
              onChange={(e) => setBLocId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value="">Company-Wide (Global)</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              required
              placeholder="Allocated Amount ($)"
              value={bAmount}
              onChange={(e) => setBAmount(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <input
              placeholder="Budget Notes"
              value={bNotes}
              onChange={(e) => setBNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBudgetModal(false)}
                className="px-4 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white">
                Save Allocation
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Record Expense Modal */}
      {expenseModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveExpense}
            className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-display font-bold">Record IT Expense</h3>
              <button type="button" onClick={() => setExpenseModal(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                value={eCategory}
                onChange={(e) => setECategory(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                {expenseCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                required
                list="vendor-suggestions"
                placeholder="Vendor Name *"
                value={eVendorName}
                onChange={(e) => setEVendorName(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <datalist id="vendor-suggestions">
                {vendors.map((v) => (
                  <option key={v.id} value={v.name} />
                ))}
              </datalist>
              <input
                type="number"
                required
                min="1"
                placeholder="Amount ($) *"
                value={eAmount}
                onChange={(e) => setEAmount(e.target.value)}
                className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <input
                required
                placeholder="Invoice Number *"
                value={eInvoiceNum}
                onChange={(e) => setEInvoiceNum(e.target.value)}
                className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <input
                type="date"
                required
                value={ePayDate}
                onChange={(e) => setEPayDate(e.target.value)}
                className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <select
                value={eLocId}
                onChange={(e) => setELocId(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="">Location / Hub...</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <select
                value={eTicketId}
                onChange={(e) => setETicketId(e.target.value)}
                className="sm:col-span-2 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="">Link to Ticket Reference (Optional)</option>
                {tickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.ticket_number} · {t.category}
                  </option>
                ))}
              </select>
            </div>
            <input
              placeholder="Description / Spare parts breakdown"
              value={eDesc}
              onChange={(e) => setEDesc(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Invoice Attachment (PDF / Image)</label>
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => setEFile(e.target.files?.[0] || null)}
                className="text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setExpenseModal(false)}
                className="px-4 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white">
                Save Expense
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
