import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { NotificationItem, NotificationPrefs, UserSession } from '../types/index.ts';
import { apiFetch, getAuthToken, setAuthToken } from '../utils/api.ts';

export interface RealtimeEvent {
  event: string;
  data: any;
}

interface AuthContextValue {
  user: UserSession | null;
  loading: boolean;
  notifications: NotificationItem[];
  unreadCount: number;
  chatUnreadCount: number;
  onlineUserIds: number[];
  notificationPrefs: NotificationPrefs;
  popupToasts: NotificationItem[];
  login: (
    email: string,
    password: string,
    options?: { portal_mode?: 'moderator_common'; mod_access?: string }
  ) => Promise<void>;
  loginWithInvite: (payload: { token: string; password?: string; new_password?: string }) => Promise<void>;
  loginWithMobileOtp: (payload: {
    mobile: string;
    otp: string;
    full_name?: string;
    email?: string;
    department_id?: number;
    location_id?: number;
    designation?: string;
  }) => Promise<{ is_new_employee: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  refreshChatUnread: () => Promise<void>;
  markNotificationRead: (id: number) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  updateNotificationPrefs: (next: Partial<NotificationPrefs>) => Promise<NotificationPrefs>;
  dismissPopupToast: (id: number) => void;
  subscribeRealtime: (handler: (evt: RealtimeEvent) => void) => () => void;
}

const DEFAULT_PREFS: NotificationPrefs = { enabled: true, popups_enabled: true };

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  notifications: [],
  unreadCount: 0,
  chatUnreadCount: 0,
  onlineUserIds: [],
  notificationPrefs: DEFAULT_PREFS,
  popupToasts: [],
  login: async () => {},
  loginWithInvite: async () => {},
  loginWithMobileOtp: async () => ({ is_new_employee: false }),
  logout: async () => {},
  refreshUser: async () => {},
  refreshNotifications: async () => {},
  refreshChatUnread: async () => {},
  markNotificationRead: async () => {},
  markAllNotificationsRead: async () => {},
  updateNotificationPrefs: async () => DEFAULT_PREFS,
  dismissPopupToast: () => {},
  subscribeRealtime: () => () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [onlineUserIds, setOnlineUserIds] = useState<number[]>([]);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [popupToasts, setPopupToasts] = useState<NotificationItem[]>([]);

  const subscribersRef = useRef<Set<(evt: RealtimeEvent) => void>>(new Set());
  const prefsRef = useRef<NotificationPrefs>(DEFAULT_PREFS);
  prefsRef.current = notificationPrefs;

  const subscribeRealtime = useCallback((handler: (evt: RealtimeEvent) => void) => {
    subscribersRef.current.add(handler);
    return () => {
      subscribersRef.current.delete(handler);
    };
  }, []);

  const dismissPopupToast = useCallback((id: number) => {
    setPopupToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const refreshNotifications = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      const data = await apiFetch<{ notifications: NotificationItem[]; unreadCount: number }>('/api/notifications');
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // ignore transient poll error
    }
  }, []);

  const refreshChatUnread = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      const data = await apiFetch<{ totalUnread: number }>('/api/chat/unread-summary');
      setChatUnreadCount(data.totalUnread ?? 0);
    } catch {
      // ignore if user role does not use direct chat
    }
  }, []);

  const syncUserSessionData = useCallback(
    async (sessionUser: UserSession) => {
      if (sessionUser.notification_prefs) {
        setNotificationPrefs(sessionUser.notification_prefs);
      } else if (sessionUser.role === 'super_admin') {
        apiFetch<NotificationPrefs>('/api/notifications/preferences')
          .then(setNotificationPrefs)
          .catch(() => {});
      }
      await refreshNotifications();
      if (sessionUser.role === 'super_admin' || sessionUser.role === 'moderator') {
        await refreshChatUnread();
      } else {
        setChatUnreadCount(0);
      }
    },
    [refreshChatUnread, refreshNotifications]
  );

  const refreshUser = useCallback(async () => {
    if (!getAuthToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<{ user: UserSession }>('/api/auth/me');
      setUser(data.user);
      await syncUserSessionData(data.user);
    } catch {
      setAuthToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [syncUserSessionData]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // WebSocket live connection for Direct Chat, Presence, Notifications, Roadmap updates, and Dropdown sync
  useEffect(() => {
    if (!user) {
      setOnlineUserIds([]);
      return;
    }

    const token = getAuthToken();
    if (!token) return;

    let ws: WebSocket | null = null;
    let closedByCleanup = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closedByCleanup) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(url);

      ws.onmessage = (msgEvent) => {
        try {
          const parsed = JSON.parse(msgEvent.data) as RealtimeEvent;
          if (!parsed?.event) return;

          if (parsed.event === 'presence:update' && Array.isArray(parsed.data?.onlineUserIds)) {
            setOnlineUserIds(parsed.data.onlineUserIds);
          } else if (parsed.event === 'notification:new' && parsed.data) {
            const notif = parsed.data as NotificationItem;
            setNotifications((prev) => [notif, ...prev.filter((n) => n.id !== notif.id)].slice(0, 60));
            setUnreadCount((c) => c + 1);
            if (prefsRef.current.enabled && prefsRef.current.popups_enabled) {
              setPopupToasts((prev) => [notif, ...prev.filter((p) => p.id !== notif.id)].slice(0, 4));
              setTimeout(() => {
                setPopupToasts((prev) => prev.filter((p) => p.id !== notif.id));
              }, 8500);
            }
          } else if (parsed.event === 'notifications:prefs' && parsed.data) {
            setNotificationPrefs(parsed.data as NotificationPrefs);
          } else if (parsed.event === 'chat:message' && parsed.data) {
            if (parsed.data.recipient_user_id === user.id) {
              refreshChatUnread();
            }
          } else if (parsed.event === 'chat:read') {
            refreshChatUnread();
          }

          subscribersRef.current.forEach((fn) => {
            try {
              fn(parsed);
            } catch {
              // protect loop
            }
          });
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (!closedByCleanup) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [user, refreshChatUnread]);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(refreshNotifications, 30000);
    return () => clearInterval(timer);
  }, [user, refreshNotifications]);

  const login = async (
    email: string,
    password: string,
    options?: { portal_mode?: 'moderator_common'; mod_access?: string }
  ) => {
    const data = await apiFetch<{ token: string; user: UserSession }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        ...(options?.portal_mode ? { portal_mode: options.portal_mode } : {}),
        ...(options?.mod_access ? { mod_access: options.mod_access } : {}),
      }),
    });
    setAuthToken(data.token);
    setUser(data.user);
    await syncUserSessionData(data.user);
  };

  const loginWithInvite = async (payload: { token: string; password?: string; new_password?: string }) => {
    const data = await apiFetch<{ token: string; user: UserSession }>('/api/auth/invite-login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setAuthToken(data.token);
    setUser(data.user);
    await syncUserSessionData(data.user);
  };

  const loginWithMobileOtp = async (payload: {
    mobile: string;
    otp: string;
    full_name?: string;
    email?: string;
    department_id?: number;
    location_id?: number;
    designation?: string;
  }) => {
    const data = await apiFetch<{ token: string; user: UserSession; is_new_employee: boolean }>(
      '/api/auth/employee-otp/verify',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    setAuthToken(data.token);
    setUser(data.user);
    await syncUserSessionData(data.user);
    return { is_new_employee: data.is_new_employee };
  };

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // continue local cleanup
    }
    setAuthToken(null);
    setUser(null);
    setNotifications([]);
    setUnreadCount(0);
    setChatUnreadCount(0);
    setOnlineUserIds([]);
    setPopupToasts([]);
  };

  const markNotificationRead = async (id: number) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    await refreshNotifications();
  };

  const markAllNotificationsRead = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    await refreshNotifications();
  };

  const updateNotificationPrefs = async (next: Partial<NotificationPrefs>) => {
    const res = await apiFetch<NotificationPrefs>('/api/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(next),
    });
    setNotificationPrefs(res);
    return res;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        notifications,
        unreadCount,
        chatUnreadCount,
        onlineUserIds,
        notificationPrefs,
        popupToasts,
        login,
        loginWithInvite,
        loginWithMobileOtp,
        logout,
        refreshUser,
        refreshNotifications,
        refreshChatUnread,
        markNotificationRead,
        markAllNotificationsRead,
        updateNotificationPrefs,
        dismissPopupToast,
        subscribeRealtime,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
