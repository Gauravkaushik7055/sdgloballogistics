import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Wrench, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useDropdowns } from '../../context/DropdownContext.tsx';
import { LocationItem } from '../../types/index.ts';
import { apiFetch, formatCurrency, formatDateOnly } from '../../utils/api.ts';

export default function AssetsView({ onSelectTicket }: { onSelectTicket: (id: number) => void }) {
  const { user } = useAuth();
  const { getOptions } = useDropdowns();
  const assetCategories = getOptions('asset_category');
  const [assets, setAssets] = useState<any[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [catFilter, setCatFilter] = useState('All');

  const [createOpen, setCreateOpen] = useState(false);
  const [assetTag, setAssetTag] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [category, setCategory] = useState<string>(() => assetCategories[0] || 'Laptop');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [purchaseCost, setPurchaseCost] = useState('');
  const [warrantyExpiry, setWarrantyExpiry] = useState('');
  const [locationId, setLocationId] = useState('');
  const [conditionStatus, setConditionStatus] = useState('Operational');
  const [notes, setNotes] = useState('');

  // Maintenance drawer
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const [maintHistory, setMaintHistory] = useState<any[]>([]);
  const [linkedTickets, setLinkedTickets] = useState<any[]>([]);
  const [maintType, setMaintType] = useState('Repair');
  const [maintDesc, setMaintDesc] = useState('');
  const [maintCost, setMaintCost] = useState('0');
  const [maintVendorId, setMaintVendorId] = useState('');

  const loadAssets = useCallback(async () => {
    const res = await apiFetch<{ assets: any[] }>('/api/assets');
    setAssets(res.assets);
  }, []);

  useEffect(() => {
    loadAssets();
    apiFetch<{ locations: LocationItem[] }>('/api/locations')
      .then((r) => setLocations(r.locations))
      .catch(() => {});
    apiFetch<{ vendors: any[] }>('/api/vendors')
      .then((r) => setVendors(r.vendors))
      .catch(() => {});
  }, [loadAssets]);

  const openMaint = async (asset: any) => {
    setSelectedAsset(asset);
    const data = await apiFetch<{ maintenance: any[]; linkedTickets: any[] }>(`/api/assets/${asset.id}/maintenance`);
    setMaintHistory(data.maintenance);
    setLinkedTickets(data.linkedTickets);
  };

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/assets', {
      method: 'POST',
      body: JSON.stringify({
        asset_tag: assetTag,
        serial_number: serialNumber,
        category,
        brand,
        model,
        purchase_date: purchaseDate,
        purchase_cost: Number(purchaseCost) || 0,
        warranty_expiry: warrantyExpiry || null,
        location_id: locationId ? Number(locationId) : null,
        condition_status: conditionStatus,
        notes,
      }),
    });
    setCreateOpen(false);
    setAssetTag('');
    setSerialNumber('');
    setBrand('');
    setModel('');
    setPurchaseCost('');
    setNotes('');
    loadAssets();
  };

  const handleAddMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    await apiFetch(`/api/assets/${selectedAsset.id}/maintenance`, {
      method: 'POST',
      body: JSON.stringify({
        maintenance_type: maintType,
        description: maintDesc,
        cost: Number(maintCost) || 0,
        vendor_id: maintVendorId ? Number(maintVendorId) : null,
      }),
    });
    setMaintDesc('');
    setMaintCost('0');
    openMaint(selectedAsset);
    loadAssets();
  };

  const updateCondition = async (assetId: number, status: string) => {
    await apiFetch(`/api/assets/${assetId}`, {
      method: 'PATCH',
      body: JSON.stringify({ condition_status: status }),
    });
    loadAssets();
  };

  const filtered = catFilter === 'All' ? assets : assets.filter((a) => a.category === catFilter);

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-display font-bold">IT Asset & Equipment Inventory ({filtered.length})</h2>
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            <option value="All">All Equipment Types</option>
            {assetCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {user?.role === 'super_admin' && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Register IT Asset
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-slate-500">
                <th className="py-2.5 px-4">Asset ID / Serial</th>
                <th className="py-2.5 px-4">Equipment</th>
                <th className="py-2.5 px-4">Hub / Employee</th>
                <th className="py-2.5 px-4">Warranty</th>
                <th className="py-2.5 px-4 text-right">Purchase / Maint Cost</th>
                <th className="py-2.5 px-4">Condition</th>
                <th className="py-2.5 px-4 text-right">Tickets & Log</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4">
                    <div className="font-mono font-semibold text-blue-700 dark:text-blue-400">{a.asset_tag}</div>
                    <div className="font-mono text-slate-500">{a.serial_number}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold">
                      {a.brand} {a.model}
                    </div>
                    <div className="text-slate-500">{a.category}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div>{a.location_name || 'Unassigned Hub'}</div>
                    <div className="text-slate-500">{a.assigned_employee_name || 'Shared Facility Asset'}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-500">
                    <div>Bought: {formatDateOnly(a.purchase_date)}</div>
                    <div>Exp: {formatDateOnly(a.warranty_expiry)}</div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    <div>{formatCurrency(a.purchase_cost)}</div>
                    <div className="text-slate-500">Maint: {formatCurrency(a.total_maintenance_cost)}</div>
                  </td>
                  <td className="py-3 px-4">
                    {user?.role === 'super_admin' ? (
                      <select
                        value={a.condition_status}
                        onChange={(e) => updateCondition(a.id, e.target.value)}
                        className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        <option value="Operational">Operational</option>
                        <option value="Under Repair">Under Repair</option>
                        <option value="Spare">Spare</option>
                        <option value="Decommissioned">Decommissioned</option>
                      </select>
                    ) : (
                      <span>{a.condition_status}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => openMaint(a)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Wrench className="w-3 h-3" />
                      <span>History ({a.linked_tickets})</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Register Asset Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateAsset}
            className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-display font-bold">Register IT Asset</h3>
              <button type="button" onClick={() => setCreateOpen(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                required
                placeholder="Asset ID (e.g. AST-SCN-1099)"
                value={assetTag}
                onChange={(e) => setAssetTag(e.target.value)}
                className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <input
                required
                placeholder="Serial Number"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                {assetCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="">Assigned Hub / Warehouse...</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <input
                required
                placeholder="Brand (Zebra, Cisco, Dell...)"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <input
                required
                placeholder="Model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Purchase Date *</label>
                <input
                  type="date"
                  required
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Warranty Expiry</label>
                <input
                  type="date"
                  value={warrantyExpiry}
                  onChange={(e) => setWarrantyExpiry(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <input
                type="number"
                placeholder="Purchase Cost ($)"
                value={purchaseCost}
                onChange={(e) => setPurchaseCost(e.target.value)}
                className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <select
                value={conditionStatus}
                onChange={(e) => setConditionStatus(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="Operational">Operational</option>
                <option value="Spare">Spare</option>
                <option value="Under Repair">Under Repair</option>
              </select>
            </div>
            <input
              placeholder="Location / Rack / Allocation notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white">
                Register Asset
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Asset Maintenance & Linked Tickets Modal */}
      {selectedAsset && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-display font-bold">
                  {selectedAsset.asset_tag} · {selectedAsset.brand} {selectedAsset.model}
                </h3>
                <p className="text-xs font-mono text-slate-500">Serial: {selectedAsset.serial_number}</p>
              </div>
              <button type="button" onClick={() => setSelectedAsset(null)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {user?.role === 'super_admin' && (
              <form
                onSubmit={handleAddMaintenance}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3"
              >
                <div className="text-xs font-semibold">Log Maintenance / Repair Event</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <select
                    value={maintType}
                    onChange={(e) => setMaintType(e.target.value)}
                    className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="Repair">Repair</option>
                    <option value="Parts Replacement">Parts Replacement</option>
                    <option value="Preventive">Preventive Maintenance</option>
                  </select>
                  <select
                    value={maintVendorId}
                    onChange={(e) => setMaintVendorId(e.target.value)}
                    className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="">In-House IT</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    placeholder="Cost ($)"
                    value={maintCost}
                    onChange={(e) => setMaintCost(e.target.value)}
                    className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    required
                    placeholder="Describe repair, replacement part, or preventive service..."
                    value={maintDesc}
                    onChange={(e) => setMaintDesc(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white cursor-pointer"
                  >
                    Add Record
                  </button>
                </div>
              </form>
            )}

            <div>
              <h4 className="text-xs font-semibold text-slate-500 mb-2">Maintenance & Repair History</h4>
              {maintHistory.length === 0 ? (
                <div className="text-xs text-slate-500">No maintenance records logged yet.</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {maintHistory.map((m) => (
                    <div key={m.id} className="py-2 flex justify-between gap-4">
                      <div>
                        <div className="font-semibold">
                          {m.maintenance_type} · {m.vendor_name || 'In-House IT'}
                        </div>
                        <div className="text-slate-600 dark:text-slate-300">{m.description}</div>
                      </div>
                      <div className="text-right font-mono shrink-0">
                        <div>{formatCurrency(m.cost)}</div>
                        <div className="text-slate-400">{m.performed_at}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-500 mb-2">Associated Support Tickets</h4>
              {linkedTickets.length === 0 ? (
                <div className="text-xs text-slate-500">No tickets linked to this asset.</div>
              ) : (
                <div className="space-y-1.5 text-xs">
                  {linkedTickets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setSelectedAsset(null);
                        onSelectTicket(t.id);
                      }}
                      className="w-full text-left p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 flex justify-between cursor-pointer"
                    >
                      <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">
                        {t.ticket_number} · {t.category}
                      </span>
                      <span>
                        {t.priority} · {t.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
