import React, { useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  ClipboardList,
  DollarSign,
  FileBarChart,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Plus,
  Settings,
  Shield,
  Sun,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useTheme } from '../context/ThemeContext.tsx';
import { apiFetch, formatDateTime } from '../utils/api.ts';
import SdGlobalLogo from './SdGlobalLogo.tsx';

export type NavSection =
  | 'dashboard'
  | 'tickets'
  | 'chat'
  | 'moderators'
  | 'employees'
  | 'assets'
  | 'budgets'
  | 'reports'
  | 'dropdowns'
  | 'integrations'
  | 'audit';

interface LayoutProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  onOpenNewTicket: () => void;
  onSelectNotificationTicket?: (ticketId: number) => void;
  children: React.ReactNode;
}

export default function Layout({
  activeSection,
  onSelectSection,
  onOpenNewTicket,
  onSelectNotificationTicket,
  children,
}: LayoutProps) {
  const {
    user,
    logout,
    refreshUser,
    notifications,
    unreadCount,
    chatUnreadCount,
    notificationPrefs,
    updateNotificationPrefs,
    popupToasts,
    dismissPopupToast,
    markNotificationRead,
    markAllNotificationsRead,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountTab, setAccountTab] = useState<'profile' | 'password'>('profile');

  // Profile form state
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (user && accountModalOpen) {
      setProfileName(user.full_name || '');
      setProfileEmail(user.email || '');
      setProfileMsg('');
      setProfileErr('');
      setPwMsg('');
      setPwErr('');
    }
  }, [user, accountModalOpen]);

  if (!user) return null;

  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    roles: string[];
    badge?: number;
  }> = [
    {
      id: 'dashboard',
      label:
        user.role === 'employee'
          ? 'Employee & HR Panel'
          : user.role === 'moderator'
          ? 'Moderator Dashboard'
          : user.role === 'management'
          ? 'Executive Overview'
          : 'Super Admin Dashboard',
      icon: LayoutDashboard,
      roles: ['super_admin', 'moderator', 'employee', 'management'],
    },
    {
      id: 'tickets',
      label: user.role === 'employee' ? 'My Tickets' : user.role === 'moderator' ? 'Assigned Tasks' : 'Work & Task Queue',
      icon: ClipboardList,
      roles: ['super_admin', 'moderator', 'employee', 'management'],
    },
    {
      id: 'chat',
      label: user.role === 'moderator' ? 'Chat with Super Admin' : 'Moderator Direct Chat',
      icon: MessageSquare,
      roles: ['super_admin', 'moderator'],
      badge: chatUnreadCount,
    },
    {
      id: 'moderators',
      label: 'Moderators & Access',
      icon: UserCog,
      roles: ['super_admin', 'management'],
    },
    {
      id: 'employees',
      label: 'Employee & HR Panel',
      icon: Users,
      roles: ['super_admin', 'management'],
    },
    {
      id: 'assets',
      label: 'IT Assets & Inventory',
      icon: HardDrive,
      roles: ['super_admin', 'management'],
    },
    {
      id: 'budgets',
      label: 'IT Budget & Expenses',
      icon: DollarSign,
      roles: ['super_admin', 'management'],
    },
    {
      id: 'reports',
      label: 'Reports & Exports',
      icon: FileBarChart,
      roles: ['super_admin', 'management'],
    },
    {
      id: 'dropdowns',
      label: 'Dropdown Manager',
      icon: ListChecks,
      roles: ['super_admin'],
    },
    {
      id: 'integrations',
      label: 'Notifications, Outlook & SLA',
      icon: Settings,
      roles: ['super_admin'],
    },
    {
      id: 'audit',
      label: 'Sessions & Audit Logs',
      icon: Shield,
      roles: ['super_admin'],
    },
  ];

  const visibleNav = navItems.filter((item) => item.roles.includes(user.role));
  const currentTitle = visibleNav.find((n) => n.id === activeSection)?.label || 'Dashboard';

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileErr('');
    setProfileMsg('');
    setSavingProfile(true);
    try {
      const res = await apiFetch<{ token?: string; message?: string }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: profileName.trim(),
          email: profileEmail.trim(),
        }),
      });
      if (res.token) {
        sessionStorage.setItem('logicore_jwt', res.token);
      }
      await refreshUser();
      setProfileMsg(res.message || 'Account profile updated successfully.');
    } catch (err: any) {
      setProfileErr(err.message || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwErr('');
    setPwMsg('');
    setSavingPw(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      setPwMsg('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      setPwErr(err.message);
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-100 flex flex-col border-r border-slate-800 transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <SdGlobalLogo size={32} withWhiteSurface />
            <div className="min-w-0">
              <div className="font-display font-bold text-sm tracking-tight text-white whitespace-nowrap truncate leading-tight">
                SD Global
              </div>
              <div className="text-[10px] font-medium text-slate-400 whitespace-nowrap truncate">
                IT Service CRM
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1 text-slate-400 hover:text-white"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectSection(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer text-left ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded bg-red-600 text-white text-[11px] font-mono font-bold tabular-nums shrink-0">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{user.full_name}</div>
            <div className="text-xs text-slate-400 truncate">
              {user.role_label} · {user.email}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAccountModalOpen(true)}
              className="flex-1 py-1.5 px-2.5 text-xs font-medium rounded border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              Account
            </button>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-xs font-medium rounded border border-slate-700 text-slate-300 hover:bg-red-950/50 hover:text-red-300 hover:border-red-900 transition-colors cursor-pointer whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-16 px-4 sm:px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 dark:text-slate-400 hidden sm:inline whitespace-nowrap">
                Service Desk
              </span>
              <span className="text-slate-400 hidden sm:inline">/</span>
              <h1 className="font-display font-semibold text-slate-900 dark:text-white truncate">
                {currentTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Moderators cannot create tasks */}
            {user.role !== 'management' && user.role !== 'moderator' && (
              <button
                type="button"
                onClick={onOpenNewTicket}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Ticket</span>
              </button>
            )}

            {(user.role === 'super_admin' || user.role === 'moderator') && (
              <button
                type="button"
                onClick={() => onSelectSection('chat')}
                aria-label="Direct Chat"
                className="relative p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Direct Chat"
              >
                <MessageSquare className="w-4 h-4" />
                {chatUnreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-mono font-bold rounded bg-blue-600 text-white tabular-nums">
                    {chatUnreadCount}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle color theme"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            {/* Notifications Drawer Trigger */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen(!notifOpen)}
                aria-label="Notifications"
                className="relative p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {user.role === 'super_admin' && !notificationPrefs.enabled ? (
                  <BellOff className="w-4 h-4 text-slate-400" />
                ) : (
                  <Bell className="w-4 h-4" />
                )}
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-mono font-bold rounded bg-red-600 text-white tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Notifications</span>
                      <div className="flex items-center gap-3">
                        {unreadCount > 0 && (
                          <button
                            type="button"
                            onClick={markAllNotificationsRead}
                            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                          >
                            Mark all read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setNotifOpen(false)}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {user.role === 'super_admin' && (
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                        <span className="text-slate-600 dark:text-slate-400">
                          Super Admin Alerts:{' '}
                          <strong className={notificationPrefs.enabled ? 'text-emerald-600' : 'text-slate-500'}>
                            {notificationPrefs.enabled ? 'ON' : 'OFF'}
                          </strong>
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateNotificationPrefs({ enabled: !notificationPrefs.enabled }).catch(() => {})
                            }
                            className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium cursor-pointer"
                          >
                            Turn {notificationPrefs.enabled ? 'OFF' : 'ON'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              onSelectSection('integrations');
                            }}
                            className="text-blue-600 dark:text-blue-400 font-medium hover:underline cursor-pointer"
                          >
                            Settings
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">No notifications yet.</div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={async () => {
                            if (!n.is_read) await markNotificationRead(n.id);
                            if (n.ticket_id && onSelectNotificationTicket) {
                              onSelectNotificationTicket(n.ticket_id);
                            } else if (n.title.toLowerCase().includes('direct message')) {
                              onSelectSection('chat');
                            }
                            setNotifOpen(false);
                          }}
                          className={`w-full text-left p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer ${
                            !n.is_read ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-xs font-semibold ${
                                n.type === 'critical'
                                  ? 'text-red-600 dark:text-red-400'
                                  : n.type === 'warning'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : n.type === 'success'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-slate-900 dark:text-white'
                              }`}
                            >
                              {n.title}
                            </span>
                            {!n.is_read && <span className="text-[10px] font-semibold text-blue-600">Unread</span>}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{n.message}</p>
                          <div className="text-[11px] font-mono text-slate-400 mt-1.5">
                            {formatDateTime(n.created_at)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>

      {/* Live Popup Notification Toast Stack (Super Admin, when enabled && popups_enabled) */}
      {user.role === 'super_admin' && popupToasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 w-80 sm:w-96 space-y-2.5 pointer-events-none">
          {popupToasts.map((toast) => (
            <div
              key={toast.id}
              className="pointer-events-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-3.5 text-left"
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!toast.is_read) await markNotificationRead(toast.id).catch(() => {});
                    if (toast.ticket_id && onSelectNotificationTicket) {
                      onSelectNotificationTicket(toast.ticket_id);
                    } else if (toast.title.toLowerCase().includes('direct message')) {
                      onSelectSection('chat');
                    }
                    dismissPopupToast(toast.id);
                  }}
                  className="flex-1 text-left cursor-pointer"
                >
                  <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                    Live Alert · {toast.type.toUpperCase()}
                  </div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white mt-0.5">{toast.title}</div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">{toast.message}</p>
                </button>
                <button
                  type="button"
                  onClick={() => dismissPopupToast(toast.id)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  aria-label="Dismiss alert"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Account Profile & Password Modal */}
      {accountModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-display font-semibold">Account Profile & Security</h3>
              <button
                type="button"
                onClick={() => setAccountModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg mb-4">
              <button
                type="button"
                onClick={() => setAccountTab('profile')}
                className={`py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  accountTab === 'profile'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Profile & Email
              </button>
              <button
                type="button"
                onClick={() => setAccountTab('password')}
                className={`py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  accountTab === 'password'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Change Password
              </button>
            </div>

            {accountTab === 'profile' ? (
              <form onSubmit={handleProfileUpdate} className="space-y-3">
                {profileErr && (
                  <div className="p-2.5 text-xs rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
                    {profileErr}
                  </div>
                )}
                {profileMsg && (
                  <div className="p-2.5 text-xs rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                    {profileMsg}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Login Email Address</label>
                  <input
                    type="email"
                    required
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    disabled={user.role !== 'super_admin'}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
                  />
                  {user.role !== 'super_admin' && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      Only the Super Admin can modify staff login email addresses.
                    </p>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setAccountModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60"
                  >
                    {savingProfile ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handlePasswordChange} className="space-y-3">
                {pwErr && (
                  <div className="p-2.5 text-xs rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
                    {pwErr}
                  </div>
                )}
                {pwMsg && (
                  <div className="p-2.5 text-xs rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                    {pwMsg}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium mb-1">Current Password</label>
                  <input
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">New Password (min 8 chars)</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setAccountModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={savingPw}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60"
                  >
                    {savingPw ? 'Updating...' : 'Save Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
