// Team Chat — premium messaging interface (WhatsApp/Telegram-grade).
// Channels, DMs, announcements, file attachments auto-saved to Document Management.
// Real-time via Socket.io.
import { useEffect, useRef, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import {
  Search, Send, Paperclip, Hash, Megaphone, Plus, X, FileText,
  Image as ImageIcon, Download, ChevronLeft, Phone, Video, MoreVertical,
  Check, CheckCheck, Smile, Mic,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { Spinner, EmptyState } from '../../components/ui';

interface Channel {
  id: string;
  name: string;
  type: string;
  description?: string;
  departmentName?: string;
  role: string;
  unread: number;
  lastMessage?: { body: string; senderName: string; createdAt: string } | null;
}

interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  document?: { id: string; docNo: string };
}

interface Message {
  id: string;
  body: string;
  createdAt: string;
  sender: { id: string; name: string };
  attachments: Attachment[];
}

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/api\/v1\/?$/, '');
const DOC_API = (import.meta.env.VITE_API_URL || '').replace(/\/?$/, '');

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtListTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function dateDivider(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

function avatarColor(name: string): string {
  const colors = [
    'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
    'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-orange-500',
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length;
  return colors[h];
}

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export function TeamChat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [pendingFiles, setPendingFiles] = useState<Array<{ fileName: string; mimeType: string; contentBase64: string }>>([]);
  const [showNewDM, setShowNewDM] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: channels, isLoading: channelsLoading } = useQuery<Channel[]>({
    queryKey: ['teamchat-channels'],
    queryFn: async () => (await api.get('/teamchat/channels')).data,
    refetchInterval: 30000,
  });

  const { data: messages, isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: ['teamchat-messages', activeChannelId],
    queryFn: async () => (await api.get(`/teamchat/channels/${activeChannelId}/messages?limit=100`)).data,
    enabled: !!activeChannelId,
  });

  const { data: searchResults } = useQuery({
    queryKey: ['teamchat-user-search', dmSearch],
    queryFn: async () => (await api.get(`/teamchat/users/search?q=${encodeURIComponent(dmSearch)}`)).data,
    enabled: dmSearch.length >= 2,
  });

  // Socket.io
  useEffect(() => {
    const socket = io(API_BASE, { path: '/socket.io' });
    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !activeChannelId) return;
    const handler = (payload: any) => {
      if (payload.type === 'new_message' || payload.type === 'delete_message') {
        qc.invalidateQueries({ queryKey: ['teamchat-messages', activeChannelId] });
        qc.invalidateQueries({ queryKey: ['teamchat-channels'] });
      }
    };
    socket.on(`chat:${activeChannelId}`, handler);
    return () => {
      socket.off(`chat:${activeChannelId}`, handler);
    };
  }, [activeChannelId, qc]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!activeChannelId && channels && channels.length > 0) {
      setActiveChannelId(channels[0].id);
    }
  }, [channels, activeChannelId]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  }, [messageBody]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/teamchat/channels/${activeChannelId}/messages`, {
        body: messageBody.trim() || '(attachment)',
        attachments: pendingFiles.length > 0 ? pendingFiles : undefined,
      });
      return res.data;
    },
    onSuccess: () => {
      setMessageBody('');
      setPendingFiles([]);
      qc.invalidateQueries({ queryKey: ['teamchat-messages', activeChannelId] });
      qc.invalidateQueries({ queryKey: ['teamchat-channels'] });
    },
  });

  const dmMutation = useMutation({
    mutationFn: async (otherUserId: string) => (await api.post(`/teamchat/dm/${otherUserId}`)).data,
    onSuccess: (channel) => {
      setShowNewDM(false);
      setDmSearch('');
      qc.invalidateQueries({ queryKey: ['teamchat-channels'] });
      setActiveChannelId(channel.id);
      setMobileView('chat');
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).slice(0, 5 - pendingFiles.length).forEach((file) => {
      if (file.size > 25 * 1024 * 1024) {
        alert(`${file.name} exceeds 25MB.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setPendingFiles((prev) => [...prev, { fileName: file.name, mimeType: file.type, contentBase64: base64 }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleSend = () => {
    if ((!messageBody.trim() && pendingFiles.length === 0) || sendMutation.isPending) return;
    sendMutation.mutate();
  };

  const activeChannel = channels?.find((c) => c.id === activeChannelId);
  const totalUnread = channels?.reduce((s, c) => s + c.unread, 0) ?? 0;

  const filteredChannels = useMemo(() => {
    if (!channelSearch.trim()) return channels;
    const q = channelSearch.toLowerCase();
    return channels?.filter((c) => c.name.toLowerCase().includes(q));
  }, [channels, channelSearch]);

  // Group messages by date
  const groupedMessages = useMemo(() => {
    if (!messages) return [];
    const groups: Array<{ date: string; msgs: Message[] }> = [];
    messages.forEach((msg) => {
      const d = dateDivider(msg.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.date === d) last.msgs.push(msg);
      else groups.push({ date: d, msgs: [msg] });
    });
    return groups;
  }, [messages]);

  if (channelsLoading) {
    return (
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {/* ═══ LEFT: Channel list ═══ */}
      <aside className={`${mobileView === 'chat' ? 'hidden' : 'flex'} w-full flex-col md:flex md:w-[340px] md:shrink-0 border-r border-slate-200 dark:border-slate-700`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Chats
            {totalUnread > 0 && (
              <span className="ml-2 rounded-full bg-violet-600 px-2 py-0.5 align-middle text-xs font-semibold text-white">
                {totalUnread}
              </span>
            )}
          </h1>
          <button
            onClick={() => setShowNewDM(true)}
            className="rounded-full p-2 text-violet-600 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-slate-800"
            title="New direct message"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={channelSearch}
              onChange={(e) => setChannelSearch(e.target.value)}
              placeholder="Search chats"
              className="w-full rounded-full bg-slate-100 py-2.5 pl-10 pr-4 text-sm outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-violet-500/30 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>
        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {filteredChannels?.length === 0 && (
            <div className="px-2 py-8">
              <EmptyState title="No chats found" sub={channelSearch ? 'Try a different search.' : 'Channels appear here.'} />
            </div>
          )}
          {filteredChannels?.map((ch) => (
            <button
              key={ch.id}
              onClick={() => {
                setActiveChannelId(ch.id);
                setMobileView('chat');
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                activeChannelId === ch.id
                  ? 'bg-violet-50 dark:bg-violet-500/10'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
              }`}
            >
              {/* Avatar */}
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColor(ch.name)}`}>
                {ch.type === 'announcements' ? (
                  <Megaphone className="h-5 w-5" />
                ) : ch.type === 'dm' ? (
                  initials(ch.name.replace(/^DM:\s*/, '').split('&')[0]?.trim() || ch.name)
                ) : (
                  <Hash className="h-5 w-5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">
                    {ch.type === 'dm' ? ch.name.replace(/^DM:\s*[^&]*&\s*/, '') : ch.name}
                  </span>
                  {ch.lastMessage && (
                    <span className={`shrink-0 text-xs ${ch.unread > 0 ? 'font-semibold text-violet-600 dark:text-violet-400' : 'text-slate-400'}`}>
                      {fmtListTime(ch.lastMessage.createdAt)}
                    </span>
                  )}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${ch.unread > 0 ? 'font-medium text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'}`}>
                    {ch.lastMessage ? `${ch.lastMessage.senderName}: ${ch.lastMessage.body}` : (
                      <span className="italic">{ch.type === 'announcements' ? 'Company announcements' : ch.description || 'No messages yet'}</span>
                    )}
                  </span>
                  {ch.unread > 0 && (
                    <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-violet-600 px-1.5 text-[11px] font-bold text-white">
                      {ch.unread > 99 ? '99+' : ch.unread}
                    </span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* ═══ RIGHT: Chat thread ═══ */}
      <main className={`${mobileView === 'list' ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col md:flex`}>
        {!activeChannel ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center dark:bg-slate-900/50">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-500/15">
              <Send className="h-8 w-8 text-violet-600 dark:text-violet-400" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Oyaya Team Chat</h2>
              <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                Select a conversation to start messaging. Files you share are automatically saved to Document Management.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900">
              <button
                onClick={() => setMobileView('list')}
                className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 md:hidden dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(activeChannel.name)}`}>
                {activeChannel.type === 'announcements' ? (
                  <Megaphone className="h-4 w-4" />
                ) : (
                  initials(activeChannel.type === 'dm' ? activeChannel.name.replace(/^DM:\s*[^&]*&\s*/, '') : activeChannel.name)
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-bold text-slate-900 dark:text-white">
                  {activeChannel.type === 'dm' ? activeChannel.name.replace(/^DM:\s*[^&]*&\s*/, '') : activeChannel.name}
                </h2>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {activeChannel.type === 'announcements'
                    ? 'Company-wide · management only'
                    : activeChannel.type === 'dm'
                      ? 'Direct message'
                      : activeChannel.departmentName || activeChannel.description || 'Department channel'}
                </p>
              </div>
              <button className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Voice call (coming soon)">
                <Phone className="h-5 w-5" />
              </button>
              <button className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Video call (coming soon)">
                <Video className="h-5 w-5" />
              </button>
            </header>

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 dark:bg-slate-900"
              style={{
                backgroundColor: undefined,
                backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(139,92,246,0.06) 1px, transparent 0)',
                backgroundSize: '24px 24px',
              }}
            >
              {messagesLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Spinner />
                </div>
              ) : groupedMessages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <span className={`flex h-16 w-16 items-center justify-center rounded-full text-white ${avatarColor(activeChannel.name)}`}>
                    {activeChannel.type === 'announcements' ? <Megaphone className="h-7 w-7" /> : <Hash className="h-7 w-7" />}
                  </span>
                  <p className="max-w-xs rounded-2xl bg-white px-4 py-3 text-sm text-slate-500 shadow-sm dark:bg-slate-800 dark:text-slate-400">
                    {activeChannel.type === 'announcements'
                      ? 'Important company announcements will appear here.'
                      : `Welcome to #${activeChannel.name}! Say hello to your team.`}
                  </p>
                </div>
              ) : (
                groupedMessages.map((group) => (
                  <div key={group.date}>
                    <div className="my-4 flex justify-center">
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm dark:bg-slate-800 dark:text-slate-400">
                        {group.date}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {group.msgs.map((msg, i) => {
                        const isMine = msg.sender.id === user?.id;
                        const prev = group.msgs[i - 1];
                        const showSender = !isMine && (!prev || prev.sender.id !== msg.sender.id);
                        return (
                          <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[78%] ${isMine ? '' : 'max-w-[82%]'}`}>
                              {showSender && (
                                <p className="mb-0.5 ml-1 text-xs font-semibold text-violet-600 dark:text-violet-400">
                                  {msg.sender.name}
                                </p>
                              )}
                              <div
                                className={`rounded-2xl px-3.5 py-2 shadow-sm ${
                                  isMine
                                    ? 'rounded-br-md bg-violet-600 text-white'
                                    : 'rounded-bl-md bg-white text-slate-900 dark:bg-slate-800 dark:text-white'
                                }`}
                              >
                                {msg.body !== '(attachment)' && (
                                  <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{msg.body}</p>
                                )}
                                {msg.attachments.length > 0 && (
                                  <div className={`space-y-2 ${msg.body !== '(attachment)' ? 'mt-2' : ''}`}>
                                    {msg.attachments.map((att) => (
                                      <a
                                        key={att.id}
                                        href={`${DOC_API}/documents/${att.document?.id}/download`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`flex items-center gap-2.5 rounded-xl p-2.5 transition-colors ${
                                          isMine
                                            ? 'bg-violet-500/25 hover:bg-violet-500/35'
                                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/60 dark:hover:bg-slate-700'
                                        }`}
                                      >
                                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                                          isMine ? 'bg-white/20' : 'bg-white dark:bg-slate-600'
                                        }`}>
                                          {att.mimeType.startsWith('image/') ? (
                                            <ImageIcon className="h-4 w-4" />
                                          ) : (
                                            <FileText className={`h-4 w-4 ${isMine ? 'text-white' : 'text-violet-600 dark:text-violet-400'}`} />
                                          )}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-[13px] font-medium">{att.fileName}</span>
                                          <span className={`block text-[11px] ${isMine ? 'text-violet-200' : 'text-slate-500 dark:text-slate-400'}`}>
                                            {fmtSize(att.fileSize)} · Saved to Documents
                                          </span>
                                        </span>
                                        <Download className="h-4 w-4 shrink-0 opacity-70" />
                                      </a>
                                    ))}
                                  </div>
                                )}
                                <p className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${isMine ? 'text-violet-200' : 'text-slate-400'}`}>
                                  {fmtTime(msg.createdAt)}
                                  {isMine && <CheckCheck className="h-3.5 w-3.5" />}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Pending attachments */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-slate-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900">
                {pendingFiles.map((f, i) => (
                  <span key={i} className="flex items-center gap-1.5 rounded-full bg-violet-50 py-1.5 pl-3 pr-2 text-xs font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                    <FileText className="h-3.5 w-3.5" />
                    <span className="max-w-[140px] truncate">{f.fileName}</span>
                    <button onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))} className="rounded-full p-0.5 hover:bg-violet-100 dark:hover:bg-violet-500/25">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Input bar */}
            <div className="border-t border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-end gap-1.5">
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-full p-2.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-violet-600 dark:text-slate-400 dark:hover:bg-slate-800"
                  title="Attach file — auto-saves to Document Management"
                >
                  <Paperclip className="h-5 w-5" />
                </button>
                <div className="min-w-0 flex-1 rounded-3xl bg-slate-100 px-4 py-1 dark:bg-slate-800">
                  <textarea
                    ref={textareaRef}
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={activeChannel.type === 'announcements' ? 'Broadcast an announcement…' : 'Message'}
                    rows={1}
                    className="max-h-[120px] w-full resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-slate-400 dark:text-white"
                  />
                </div>
                <button
                  className="rounded-full p-2.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-violet-600 dark:text-slate-400 dark:hover:bg-slate-800"
                  title="Emoji (coming soon)"
                >
                  <Smile className="h-5 w-5" />
                </button>
                {messageBody.trim() || pendingFiles.length > 0 ? (
                  <button
                    onClick={handleSend}
                    disabled={sendMutation.isPending}
                    className="rounded-full bg-violet-600 p-2.5 text-white shadow-md shadow-violet-600/30 transition-all hover:bg-violet-700 active:scale-95 disabled:opacity-50"
                  >
                    <Send className="h-5 w-5" />
                  </button>
                ) : (
                  <button
                    className="rounded-full p-2.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-violet-600 dark:text-slate-400 dark:hover:bg-slate-800"
                    title="Voice message (coming soon)"
                  >
                    <Mic className="h-5 w-5" />
                  </button>
                )}
              </div>
              {sendMutation.isError && (
                <p className="mt-1 px-2 text-xs text-red-600">
                  {(sendMutation.error as any)?.response?.data?.error || 'Failed to send.'}
                </p>
              )}
            </div>
          </>
        )}
      </main>

      {/* New DM modal */}
      {showNewDM && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20" onClick={() => { setShowNewDM(false); setDmSearch(''); }}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <h3 className="font-bold text-slate-900 dark:text-white">New message</h3>
              <button onClick={() => { setShowNewDM(false); setDmSearch(''); }} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={dmSearch}
                  onChange={(e) => setDmSearch(e.target.value)}
                  placeholder="Search name or email…"
                  className="w-full rounded-full bg-slate-100 py-2.5 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-violet-500/30 dark:bg-slate-800 dark:text-white"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto px-2 pb-3">
              {searchResults?.map((u: any) => (
                <button
                  key={u.id}
                  onClick={() => dmMutation.mutate(u.id)}
                  disabled={dmMutation.isPending}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColor(u.name)}`}>
                    {initials(u.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold text-slate-900 dark:text-white">{u.name}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{u.email}</span>
                  </span>
                </button>
              ))}
              {dmSearch.length >= 2 && searchResults?.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-500">No people found.</p>
              )}
              {dmSearch.length < 2 && (
                <p className="py-6 text-center text-sm text-slate-400">Type at least 2 characters to search.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
