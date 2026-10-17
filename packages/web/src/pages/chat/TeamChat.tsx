// Native Team Chat — channel list, message thread, DMs, file attachments.
// Real-time via Socket.io; attachments auto-save to Document Management.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import {
  MessageSquare, Send, Paperclip, Hash, Megaphone, Users, Plus, X,
  FileText, Image as ImageIcon, Download, Search, ChevronLeft,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { Spinner, EmptyState, ErrorBox } from '../../components/ui';

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

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return isToday
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TeamChat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [pendingFiles, setPendingFiles] = useState<Array<{ fileName: string; mimeType: string; contentBase64: string }>>([]);
  const [showNewDM, setShowNewDM] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Channels
  const { data: channels, isLoading: channelsLoading, refetch: refetchChannels } = useQuery<Channel[]>({
    queryKey: ['teamchat-channels'],
    queryFn: async () => (await api.get('/teamchat/channels')).data,
    refetchInterval: 30000,
  });

  // Messages for active channel
  const { data: messages, isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: ['teamchat-messages', activeChannelId],
    queryFn: async () => (await api.get(`/teamchat/channels/${activeChannelId}/messages`)).data,
    enabled: !!activeChannelId,
  });

  // User search for DM
  const { data: searchResults } = useQuery({
    queryKey: ['teamchat-user-search', dmSearch],
    queryFn: async () => (await api.get(`/teamchat/users/search?q=${encodeURIComponent(dmSearch)}`)).data,
    enabled: dmSearch.length >= 2,
  });

  // Socket.io real-time
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

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-select first channel
  useEffect(() => {
    if (!activeChannelId && channels && channels.length > 0) {
      setActiveChannelId(channels[0].id);
    }
  }, [channels, activeChannelId]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/teamchat/channels/${activeChannelId}/messages`, {
        body: messageBody.trim(),
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
        alert(`${file.name} exceeds 25MB limit.`);
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

  const channelIcon = (type: string) => {
    if (type === 'announcements') return <Megaphone className="h-4 w-4" />;
    if (type === 'dm') return <MessageSquare className="h-4 w-4" />;
    if (type === 'management') return <Users className="h-4 w-4" />;
    return <Hash className="h-4 w-4" />;
  };

  if (channelsLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      {/* Channel list */}
      <div className={`${mobileView === 'chat' ? 'hidden' : 'flex'} w-full flex-col border-r border-gray-200 md:flex md:w-80 dark:border-slate-700`}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-slate-700">
          <h1 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <MessageSquare className="h-5 w-5 text-violet-600" />
            Team Chat
            {totalUnread > 0 && (
              <span className="rounded-full bg-violet-600 px-2 py-0.5 text-xs font-medium text-white">{totalUnread}</span>
            )}
          </h1>
          <button
            onClick={() => setShowNewDM(true)}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-800"
            title="New direct message"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {channels?.length === 0 && (
            <div className="p-4">
              <EmptyState title="No channels yet" sub="Channels are created automatically from departments." />
            </div>
          )}
          {channels?.map((ch) => (
            <button
              key={ch.id}
              onClick={() => {
                setActiveChannelId(ch.id);
                setMobileView('chat');
              }}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800 ${
                activeChannelId === ch.id ? 'bg-violet-50 dark:bg-violet-500/10' : ''
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                activeChannelId === ch.id
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400'
              }`}>
                {channelIcon(ch.type)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-gray-900 dark:text-white">{ch.name}</span>
                  {ch.unread > 0 && (
                    <span className="shrink-0 rounded-full bg-violet-600 px-1.5 py-0.5 text-xs font-medium text-white">
                      {ch.unread}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-gray-500 dark:text-slate-400">
                  {ch.lastMessage ? `${ch.lastMessage.senderName}: ${ch.lastMessage.body}` : ch.description || 'No messages yet'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Message thread */}
      <div className={`${mobileView === 'list' ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col md:flex`}>
        {!activeChannel ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState title="Select a channel" sub="Choose a channel from the list to start chatting." />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-slate-700">
              <button
                onClick={() => setMobileView('list')}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 md:hidden dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-500/20">
                {channelIcon(activeChannel.type)}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{activeChannel.name}</h2>
                <p className="truncate text-xs text-gray-500 dark:text-slate-400">
                  {activeChannel.type === 'announcements' ? 'Company-wide announcements' : activeChannel.description}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-50 p-4 dark:bg-slate-900/50">
              {messagesLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Spinner />
                </div>
              ) : messages?.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <EmptyState title="No messages yet" sub="Be the first to say hello!" />
                </div>
              ) : (
                <div className="space-y-3">
                  {messages?.map((msg) => {
                    const isMine = msg.sender.id === user?.id;
                    return (
                      <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                          isMine
                            ? 'rounded-br-md bg-violet-600 text-white'
                            : 'rounded-bl-md bg-white text-gray-900 shadow-sm dark:bg-slate-800 dark:text-white'
                        }`}>
                          {!isMine && (
                            <p className="mb-1 text-xs font-semibold text-violet-600 dark:text-violet-400">{msg.sender.name}</p>
                          )}
                          <p className="whitespace-pre-wrap break-words text-sm">{msg.body}</p>
                          {msg.attachments.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                              {msg.attachments.map((att) => (
                                <a
                                  key={att.id}
                                  href={`${API_BASE}/api/v1/documents/${att.document?.id}/download`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                                    isMine ? 'bg-violet-500/30 hover:bg-violet-500/40' : 'bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600'
                                  }`}
                                >
                                  {att.mimeType.startsWith('image/') ? (
                                    <ImageIcon className="h-4 w-4 shrink-0" />
                                  ) : (
                                    <FileText className="h-4 w-4 shrink-0" />
                                  )}
                                  <span className="min-w-0 flex-1 truncate">{att.fileName}</span>
                                  <span className="shrink-0 opacity-70">{fmtSize(att.fileSize)}</span>
                                  <Download className="h-3.5 w-3.5 shrink-0" />
                                </a>
                              ))}
                              <p className="text-[10px] opacity-60">Auto-saved to Document Management</p>
                            </div>
                          )}
                          <p className={`mt-1 text-right text-[10px] ${isMine ? 'text-violet-200' : 'text-gray-400 dark:text-slate-500'}`}>
                            {fmtTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Pending files */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-gray-200 px-4 py-2 dark:border-slate-700">
                {pendingFiles.map((f, i) => (
                  <span key={i} className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs dark:bg-slate-800">
                    <FileText className="h-3.5 w-3.5" />
                    <span className="max-w-[120px] truncate">{f.fileName}</span>
                    <button onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-500">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="border-t border-gray-200 p-3 dark:border-slate-700">
              <div className="flex items-end gap-2">
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl p-2.5 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  title="Attach file (auto-saves to Documents)"
                >
                  <Paperclip className="h-5 w-5" />
                </button>
                <textarea
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={activeChannel.type === 'announcements' ? 'Write an announcement…' : 'Type a message…'}
                  rows={1}
                  className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <button
                  onClick={handleSend}
                  disabled={(!messageBody.trim() && pendingFiles.length === 0) || sendMutation.isPending}
                  className="rounded-xl bg-violet-600 p-2.5 text-white hover:bg-violet-700 disabled:opacity-40"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
              {sendMutation.isError && (
                <p className="mt-1 text-xs text-red-600">{(sendMutation.error as any)?.response?.data?.error || 'Failed to send.'}</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* New DM modal */}
      {showNewDM && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">New direct message</h3>
              <button onClick={() => { setShowNewDM(false); setDmSearch(''); }} className="text-gray-500 hover:text-gray-700 dark:text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={dmSearch}
                onChange={(e) => setDmSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {searchResults?.map((u: any) => (
                <button
                  key={u.id}
                  onClick={() => dmMutation.mutate(u.id)}
                  disabled={dmMutation.isPending}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-slate-800"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                    {u.name.charAt(0).toUpperCase()}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-gray-900 dark:text-white">{u.name}</span>
                    <span className="block text-xs text-gray-500 dark:text-slate-400">{u.email}</span>
                  </span>
                </button>
              ))}
              {dmSearch.length >= 2 && searchResults?.length === 0 && (
                <p className="py-4 text-center text-sm text-gray-500">No users found.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
