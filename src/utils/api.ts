let authToken: string | null = sessionStorage.getItem('logicore_jwt');

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    sessionStorage.setItem('logicore_jwt', token);
  } else {
    sessionStorage.removeItem('logicore_jwt');
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateOnly(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatCurrency(amount?: number | null): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount ?? 0);
}

export function getStatusColorClass(status: string): string {
  switch (status) {
    case 'Completed':
    case 'Resolved':
    case 'Closed':
      return 'text-emerald-700 dark:text-emerald-400 font-semibold';
    case 'Ready for Review':
    case 'Pending Admin Review':
      return 'text-cyan-700 dark:text-cyan-400 font-semibold';
    case 'Revision Required':
    case 'Escalated':
    case 'Reopened':
      return 'text-red-700 dark:text-red-400 font-semibold';
    case 'On Hold':
    case 'Pending Information':
    case 'Waiting for Employee':
    case 'Waiting for Parts / Vendor':
      return 'text-amber-700 dark:text-amber-400 font-semibold';
    case 'Under Review':
      return 'text-indigo-700 dark:text-indigo-400 font-medium';
    case 'In Progress':
    case 'Accepted':
    case 'Accepted by Moderator':
    case 'Assigned':
      return 'text-blue-700 dark:text-blue-400 font-medium';
    default:
      return 'text-slate-700 dark:text-slate-300';
  }
}

export function getPriorityColorClass(priority: string): string {
  switch (priority) {
    case 'Critical':
      return 'text-red-700 dark:text-red-400 font-semibold';
    case 'High':
      return 'text-amber-700 dark:text-amber-400 font-semibold';
    case 'Medium':
      return 'text-blue-700 dark:text-blue-400 font-medium';
    default:
      return 'text-slate-600 dark:text-slate-400';
  }
}
