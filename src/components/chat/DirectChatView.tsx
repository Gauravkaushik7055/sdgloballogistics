import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, Link2, MessageSquare, Send } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { ChatConversationItem, DirectMessageItem, TicketItem } from '../../types/index.ts';
import { apiFetch, formatDateTime, getStatusColorClass } from '../../utils/api.ts';

interface DirectChatViewProps {
  initialPeerUserId?: number | null;
  initialTaskId?: number | null;
  onOpenTask?: (ticketId: number) => void;
}

export default function DirectChatView({ initialPeerUserId, initialTaskId, onOpenTask }: DirectChatViewProps) {
  const { user, onlineUserIds, refreshChatUnread, subscribeRealtime } = useAuth();

  const [conversations, setConversations] = useState<ChatConversationItem[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<number | null>(initialPeerUserId ?? null);
  const [messages, setMessages] = useState<DirectMessageItem[]>([]);
  const [tasks, setTasks] = useState<TicketItem[]>([]);
  const [linkedTaskId, setLinkedTaskId] = useState<string>(initialTaskId ? String(initialTaskId) : '');
  const [filterByTaskOnly, setFilterByTaskOnly] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await apiFetch<{ conversations: ChatConversationItem[] }>('/api/chat/conversations');
      setConversations(res.conversations || []);
      setSelectedPeerId((prev) => {
        if (prev && res.conversations.some((c) => c.user_id === prev)) return prev;
        if (initialPeerUserId && res.conversations.some((c) => c.user_id === initialPeerUserId)) {
          return initialPeerUserId;
        }
        return res.conversations[0]?.user_id ?? null;
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load chat contacts');
    } finally {
      setLoadingConvos(false);
    }
  }, [initialPeerUserId]);

  const loadTasks = useCallback(async () => {
    try {
      const res = await apiFetch<{ tickets: TicketItem[] }>('/api/tickets');
      setTasks(res.tickets || []);
    } catch {
      // non-fatal
    }
  }, []);

  const loadMessages = useCallback(
    async (peerId: number, ticketFilter?: number | null) => {
      setLoadingMsgs(true);
      try {
        const qs = new URLSearchParams({ peer_user_id: String(peerId) });
        if (ticketFilter) qs.set('ticket_id', String(ticketFilter));
        const res = await apiFetch<{ messages: DirectMessageItem[] }>(`/api/chat/messages?${qs.toString()}`);
        setMessages(res.messages || []);
        setConversations((prev) =>
          prev.map((c) => (c.user_id === peerId ? { ...c, unread_count: 0 } : c))
        );
        refreshChatUnread();
      } catch (err: any) {
        setError(err.message || 'Failed to load messages');
      } finally {
        setLoadingMsgs(false);
      }
    },
    [refreshChatUnread]
  );

  useEffect(() => {
    loadConversations();
    loadTasks();
  }, [loadConversations, loadTasks]);

  useEffect(() => {
    if (initialPeerUserId) setSelectedPeerId(initialPeerUserId);
  }, [initialPeerUserId]);

  useEffect(() => {
    if (initialTaskId) setLinkedTaskId(String(initialTaskId));
  }, [initialTaskId]);

  useEffect(() => {
    if (!selectedPeerId) return;
    loadMessages(selectedPeerId, filterByTaskOnly && linkedTaskId ? Number(linkedTaskId) : null);
  }, [selectedPeerId, filterByTaskOnly, linkedTaskId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    if (!user) return;
    return subscribeRealtime((evt) => {
      if (evt.event === 'chat:message' && evt.data) {
        const incoming = evt.data as DirectMessageItem;
        const involvesSelected =
          selectedPeerId &&
          ((incoming.sender_user_id === selectedPeerId && incoming.recipient_user_id === user.id) ||
            (incoming.sender_user_id === user.id && incoming.recipient_user_id === selectedPeerId));

        if (involvesSelected) {
          if (!filterByTaskOnly || !linkedTaskId || incoming.ticket_id === Number(linkedTaskId)) {
            setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
          }
          if (incoming.sender_user_id === selectedPeerId) {
            apiFetch('/api/chat/mark-read', {
              method: 'POST',
              body: JSON.stringify({ peer_user_id: selectedPeerId }),
            })
              .then(() => refreshChatUnread())
              .catch(() => {});
          }
        }
        loadConversations();
      } else if (evt.event === 'chat:read' && evt.data) {
        if (evt.data.by_user_id === selectedPeerId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.sender_user_id === user.id ? { ...m, is_read: 1, read_at: evt.data.read_at } : m
            )
          );
        }
      }
    });
  }, [user, selectedPeerId, filterByTaskOnly, linkedTaskId, subscribeRealtime, loadConversations, refreshChatUnread]);

  const selectedPeer = useMemo(
    () => conversations.find((c) => c.user_id === selectedPeerId) || null,
    [conversations, selectedPeerId]
  );

  const linkableTasks = useMemo(() => {
    if (!selectedPeer) return tasks;
    if (user?.role === 'super_admin' && selectedPeer.moderator_id) {
      return tasks.filter((t) => t.assigned_moderator_id === selectedPeer.moderator_id);
    }
    return tasks;
  }, [tasks, selectedPeer, user?.role]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPeerId || !messageText.trim()) return;
    setError('');
    setSending(true);
    try {
      const res = await apiFetch<{ message: DirectMessageItem }>('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          recipient_user_id: selectedPeerId,
          message: messageText.trim(),
          ticket_id: linkedTaskId ? Number(linkedTaskId) : null,
        }),
      });
      setMessageText('');
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      loadConversations();
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  if (!user) return null;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden grid lg:grid-cols-12 min-h-[620px]">
      {/* Conversation List */}
      <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 flex flex-col">
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
            {user.role === 'super_admin' ? 'Registered Moderators' : 'Super Admin Channel'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {user.role === 'super_admin'
              ? 'Select a moderator for direct 1-on-1 task communication.'
              : 'Direct encrypted line with the Super Admin / IT Head.'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {loadingConvos ? (
            <div className="p-6 text-xs text-slate-500">Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-xs text-slate-500">
              {user.role === 'super_admin'
                ? 'No active moderators registered yet. Add a moderator in Moderators & Access to begin chatting.'
                : 'No active Super Admin account found.'}
            </div>
          ) : (
            conversations.map((c) => {
              const isOnline = onlineUserIds.includes(c.user_id) || Boolean(c.is_online);
              const isSelected = c.user_id === selectedPeerId;
              return (
                <button
                  key={c.user_id}
                  type="button"
                  onClick={() => setSelectedPeerId(c.user_id)}
                  className={`w-full text-left px-4 py-3.5 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50/70 dark:bg-blue-950/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        title={isOnline ? 'Live WebSocket Online' : 'Offline'}
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isOnline ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                        }`}
                      />
                      <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {c.full_name}
                      </span>
                    </div>
                    {c.unread_count > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded bg-blue-700 text-white text-[11px] font-mono font-bold tabular-nums">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {c.specialization || c.role} · {isOnline ? 'Online' : 'Offline'}
                  </div>
                  {c.last_message && (
                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 truncate">
                      {c.last_message}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Message Thread */}
      <div className="lg:col-span-8 flex flex-col bg-slate-50/50 dark:bg-slate-950/40">
        {selectedPeer ? (
          <>
            {/* Thread Header */}
            <div className="px-5 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
                    {selectedPeer.full_name}
                  </h3>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {onlineUserIds.includes(selectedPeer.user_id) || selectedPeer.is_online ? 'Online' : 'Offline'}
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {selectedPeer.email}
                </div>
              </div>

              {linkedTaskId && (
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterByTaskOnly}
                    onChange={(e) => setFilterByTaskOnly(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Show messages for selected task only</span>
                </label>
              )}
            </div>

            {error && (
              <div className="m-3 p-3 text-xs rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/60">
                {error}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3 max-h-[450px]">
              {loadingMsgs ? (
                <div className="text-xs text-slate-500 text-center py-10">Loading conversation history...</div>
              ) : messages.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto" />
                  <p className="text-xs text-slate-500">
                    No messages yet with {selectedPeer.full_name}. Start a conversation below.
                  </p>
                </div>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_user_id === user.id;
                  return (
                    <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`max-w-[82%] rounded-xl px-4 py-2.5 text-sm border ${
                          mine
                            ? 'bg-blue-700 text-white border-blue-700'
                            : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <div className={`text-[11px] font-medium mb-1 flex items-center gap-2 ${mine ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'}`}>
                          <span>{m.sender_name}</span>
                          <span>·</span>
                          <span>{m.sender_role === 'super_admin' ? 'Super Admin' : 'Moderator'}</span>
                        </div>

                        {m.ticket_id && m.ticket_number && (
                          <button
                            type="button"
                            onClick={() => onOpenTask && onOpenTask(m.ticket_id!)}
                            className={`mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded border cursor-pointer ${
                              mine
                                ? 'bg-blue-800/80 border-blue-500 text-white hover:bg-blue-800'
                                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-blue-700 dark:text-blue-300 hover:underline'
                            }`}
                          >
                            <Link2 className="w-3 h-3" />
                            <span>{m.ticket_number}</span>
                            {m.ticket_status && (
                              <span className={mine ? 'text-blue-100' : getStatusColorClass(m.ticket_status)}>
                                · {m.ticket_status}
                              </span>
                            )}
                          </button>
                        )}

                        <div className="whitespace-pre-wrap break-words leading-relaxed">{m.message}</div>
                      </div>

                      <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-slate-400 tabular-nums px-1">
                        <span>{formatDateTime(m.created_at)}</span>
                        {mine && (
                          <span className="inline-flex items-center gap-0.5 text-slate-500">
                            <CheckCheck className={`w-3 h-3 ${m.is_read ? 'text-blue-600' : 'text-slate-400'}`} />
                            {m.is_read ? 'Read' : 'Sent'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <form
              onSubmit={handleSend}
              className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 space-y-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <select
                  value={linkedTaskId}
                  onChange={(e) => setLinkedTaskId(e.target.value)}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 max-w-xs"
                >
                  <option value="">General message (no task linked)</option>
                  {linkableTasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.ticket_number} — {t.category} ({t.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end gap-2">
                <textarea
                  rows={2}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend(e);
                    }
                  }}
                  placeholder={`Message ${selectedPeer.full_name}... (Enter to send, Shift+Enter for newline)`}
                  className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="submit"
                  disabled={sending || !messageText.trim()}
                  className="px-4 py-2.5 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{sending ? 'Sending...' : 'Send'}</span>
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-10 text-xs text-slate-500">
            Select a conversation to start messaging.
          </div>
        )}
      </div>
    </div>
  );
}
