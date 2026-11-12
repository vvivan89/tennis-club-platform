'use client';

import Image from 'next/image';
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { dispatchChatPush } from '@/lib/chat-push-client';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  canEditChatMessage,
  CHAT_PAGE_SIZE,
  countUnreadMessages,
  markMemberChatAsRead,
  validateChatImage,
} from '@/lib/member-chat';
import { ImagePlus, Loader2, MessageCircle, MoreVertical, Send, Smile } from 'lucide-react';

type MemberNameRow = { id: string; full_name: string | null };

type ChatMessage = {
  id: string;
  user_id: string;
  body: string;
  image_path: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  author_name: string;
  author_full_name: string;
  author_avatar_url: string | null;
  mentions: string[];
  image_url?: string;
};
const EMOJI = ['😀', '😂', '😍', '👍', '👏', '🎾', '❤️', '😊', '😅', '🙌', '🤔', '😎'];

export function MemberChat({ userId }: { userId: string }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const offsetRef = useRef(0);
  const [hasMore, setHasMore] = useState(false);
  const [unread, setUnread] = useState(0);
  const [online, setOnline] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [mentionCandidates, setMentionCandidates] = useState<
    Array<{ id: string; full_name: string }>
  >([]);
  const [memberNames, setMemberNames] = useState<
    Array<{ id: string; full_name: string; avatar_url?: string | null }>
  >([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentions, setMentions] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<ChatMessage | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const previousScrollHeightRef = useRef<number | null>(null);
  const loadingOlderRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const requestImageCleanup = useCallback(() => {
    void fetch('/api/member/chat/cleanup-images', { method: 'POST' }).catch(() => undefined);
  }, []);

  const loadMessages = useCallback(
    async (reset = true) => {
      setError('');
      const start = reset ? 0 : offsetRef.current;
      const query = supabase
        .from('member_chat_messages')
        .select('id,user_id,body,image_path,created_at,updated_at,deleted_at,mentions')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(start, start + CHAT_PAGE_SIZE);
      const { data, error: queryError } = await query;
      if (queryError) {
        setError('Unable to load chat history. Please try again.');
        return;
      }
      const fetchedRows = data ?? [];
      const rows = fetchedRows.slice(0, CHAT_PAGE_SIZE);
      if (!reset && messagesContainerRef.current) {
        previousScrollHeightRef.current = messagesContainerRef.current.scrollHeight;
        loadingOlderRef.current = true;
      }
      const userIds = [...new Set(rows.map((row) => row.user_id))];
      const namesResult = userIds.length
        ? await supabase.rpc('get_member_chat_member_names')
        : { data: [], error: null };
      const names = new Map(
        ((namesResult.data ?? []) as Array<{ id: string; full_name: string }>).map((profile) => [
          profile.id,
          profile.full_name || 'Member',
        ]),
      );
      const avatarsResult = userIds.length
        ? await supabase.rpc('get_member_chat_member_avatars', { p_user_ids: userIds })
        : { data: [], error: null };
      const avatars = new Map(
        ((avatarsResult.data ?? []) as Array<{ id: string; avatar_url: string | null }>).map(
          (profile) => [profile.id, profile.avatar_url],
        ),
      );
      const formatted: ChatMessage[] = await Promise.all(
        rows.map(async (row) => {
          let imageUrl: string | undefined;
          if (row.image_path) {
            const { data: signed } = await supabase.storage
              .from('member-chat-images')
              .createSignedUrl(row.image_path, 3600);
            imageUrl = signed?.signedUrl;
          }
          const authorFullName = names.get(row.user_id) ?? 'Member';
          return {
            ...row,
            mentions: row.mentions ?? [],
            author_name: row.user_id === userId ? 'You' : authorFullName,
            author_full_name: authorFullName,
            author_avatar_url: avatars.get(row.user_id) ?? null,
            image_url: imageUrl,
          };
        }),
      );
      setMessages((current) => (reset ? formatted : [...current, ...formatted]));
      setHasMore(fetchedRows.length > CHAT_PAGE_SIZE);
      offsetRef.current = start + rows.length;
    },
    [supabase, userId],
  );

  const refreshUnread = useCallback(async () => {
    const { data: count, error: countError } = await supabase.rpc('get_member_chat_unread_count');
    if (!countError && typeof count === 'number') setUnread(countUnreadMessages(count));
  }, [supabase]);

  const markRead = useCallback(async () => {
    await markMemberChatAsRead(supabase, userId);
    setUnread(0);
    window.dispatchEvent(new CustomEvent('pctc-chat-message-received'));
  }, [supabase, userId]);

  useEffect(() => {
    void loadMessages(true);
    requestImageCleanup();
    void (async () => {
      await markRead();
      await refreshUnread();
    })();
  }, [loadMessages, markRead, refreshUnread, requestImageCleanup]);
  useEffect(() => {
    let active = true;
    void supabase.rpc('get_member_chat_member_names').then(({ data }) => {
      if (active) {
        const members = ((data ?? []) as MemberNameRow[]).map((item: MemberNameRow) => ({
          id: item.id,
          full_name: item.full_name || 'Member',
        }));
        setMemberNames(members);
        setMentionCandidates(
          members.filter((item: { id: string; full_name: string }) => item.id !== userId),
        );
      }
    });
    const channel = supabase
      .channel('pctc-member-chat-messages')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_chat_messages' },
        () => {
          void loadMessages(true);
          void markRead();
        },
      )
      .subscribe();
    const onPresenceUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ userIds?: string[] }>).detail;
      if (active && detail?.userIds) setOnline(detail.userIds);
    };
    window.addEventListener('pctc-chat-presence-updated', onPresenceUpdate);
    window.dispatchEvent(new Event('pctc-chat-presence-request'));
    // Presence is owned by the app-wide component so it remains active across navigation.
    return () => {
      active = false;
      window.removeEventListener('pctc-chat-presence-updated', onPresenceUpdate);
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId, loadMessages, markRead]);
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (loadingOlderRef.current && previousScrollHeightRef.current !== null) {
      container.scrollTop += container.scrollHeight - previousScrollHeightRef.current;
      previousScrollHeightRef.current = null;
      loadingOlderRef.current = false;
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [messages.length]);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() && !image) return;
    setBusy(true);
    setError('');
    try {
      let imagePath: string | null = null;
      if (image) {
        const extension = image.name.split('.').pop()?.toLowerCase() || 'jpg';
        imagePath = `${userId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('member-chat-images')
          .upload(imagePath, image, { contentType: image.type, upsert: false });
        if (uploadError) throw uploadError;
      }
      const { data: insertedMessage, error: insertError } = await supabase
        .from('member_chat_messages')
        .insert({
          user_id: userId,
          body: draft.trim(),
          image_path: imagePath,
          mentions: mentions.filter((id) => {
            const member = mentionCandidates.find((candidate) => candidate.id === id);
            return member ? draft.includes(`@${member.full_name}`) : false;
          }),
        })
        .select('id')
        .single();
      if (insertError) {
        if (imagePath) await supabase.storage.from('member-chat-images').remove([imagePath]);
        throw insertError;
      }
      if (insertedMessage?.id) {
        void dispatchChatPush(insertedMessage.id).catch((dispatchError) => {
          console.warn('[Chat push] Dispatch request failed.', dispatchError);
        });
      }
      setDraft('');
      setMentions([]);
      setMentionQuery(null);
      setImage(null);
      if (fileRef.current) fileRef.current.value = '';
      requestImageCleanup();
      await loadMessages(true);
      await markRead();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send message. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const validationError = validateChatImage(file);
    if (validationError) {
      setError(validationError);
      event.target.value = '';
      return;
    }
    setError('');
    setImage(file);
  }

  async function saveEdit(messageId: string) {
    const { error: updateError } = await supabase
      .from('member_chat_messages')
      .update({ body: editDraft.trim() })
      .eq('id', messageId)
      .eq('user_id', userId);
    if (updateError)
      setError(
        updateError.message.includes('five minutes')
          ? 'Messages can only be edited within five minutes.'
          : 'Unable to edit this message.',
      );
    else {
      setEditingId(null);
      await loadMessages(true);
    }
  }
  async function deleteMessage(message: ChatMessage) {
    setPendingDeleteMessage(message);
  }
  async function confirmDeleteMessage() {
    const message = pendingDeleteMessage;
    if (!message) return;
    setPendingDeleteMessage(null);
    const { error: deleteError } = await supabase
      .from('member_chat_messages')
      .delete()
      .eq('id', message.id)
      .eq('user_id', userId);
    if (deleteError)
      setError(
        deleteError.message.includes('five minutes')
          ? 'Messages can only be deleted within five minutes.'
          : 'Unable to delete this message.',
      );
    else {
      requestImageCleanup();
      await loadMessages(true);
    }
  }

  return (
    <section
      className="mx-auto flex h-full min-h-0 max-w-4xl flex-col gap-3 overflow-hidden"
      aria-label="Member group chat"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <MessageCircle className="h-6 w-6" /> Member chat
          </h1>
        </div>
        <div className="text-sm text-muted-foreground" aria-live="polite">
          {online.length} online · {unread} unread
        </div>
        {online.length > 0 && (
          <div
            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
            aria-label="Members currently online"
          >
            <span>Online now:</span>
            {online.map((id) => (
              <span key={id} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-success" />
                {memberNames.find((member) => member.id === id)?.full_name ||
                  (id === userId ? 'You' : 'Member')}
              </span>
            ))}
          </div>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card">
        <div
          ref={messagesContainerRef}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
          aria-live="polite"
        >
          {hasMore && (
            <div className="text-center">
              <button
                className="rounded-md border px-3 py-1.5 text-sm"
                onClick={() => void loadMessages(false)}
              >
                Load older messages
              </button>
            </div>
          )}
          {messages.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No messages found. Start the conversation.
            </p>
          )}
          {[...messages].reverse().map((message) => {
            const mine = message.user_id === userId;
            const editable = mine && canEditChatMessage(message.created_at);
            const initials =
              message.author_full_name
                .split(/\s+/)
                .filter(Boolean)
                .map((part) => part[0])
                .slice(0, 2)
                .join('')
                .toUpperCase() || 'M';
            return (
              <article
                key={message.id}
                className={`flex max-w-[95%] items-start gap-2.5 ${mine ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
              >
                <div
                  className="mt-1 grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
                  aria-label={`${message.author_name} avatar`}
                >
                  {message.author_avatar_url ? (
                    <Image
                      src={message.author_avatar_url}
                      alt=""
                      width={36}
                      height={36}
                      unoptimized
                      className="h-9 w-9 object-cover"
                    />
                  ) : (
                    initials
                  )}
                </div>
                <div
                  className={`min-w-0 rounded-lg border p-3 ${mine ? 'bg-secondary/60' : 'bg-background'}`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{message.author_name}</span>
                    {online.includes(message.user_id) && (
                      <span
                        aria-label={`${message.author_name} is online`}
                        title="Online"
                        className="inline-block h-2 w-2 rounded-full bg-success"
                      />
                    )}
                    <time dateTime={message.created_at}>
                      {new Date(message.created_at).toLocaleString()}
                    </time>
                    {message.updated_at && <span>(edited)</span>}
                    {editable && editingId !== message.id && (
                      <div className="relative">
                        <button
                          type="button"
                          aria-label={`Message actions for ${new Date(message.created_at).toLocaleString()}`}
                          aria-haspopup="menu"
                          aria-expanded={openMessageMenuId === message.id}
                          className="rounded p-1 hover:bg-muted"
                          onClick={() =>
                            setOpenMessageMenuId((current) =>
                              current === message.id ? null : message.id,
                            )
                          }
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {openMessageMenuId === message.id && (
                          <div
                            role="menu"
                            className="absolute right-0 top-full z-30 min-w-28 max-w-[calc(100vw-2rem)] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
                              onClick={() => {
                                setEditingId(message.id);
                                setEditDraft(message.body);
                                setOpenMessageMenuId(null);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="block w-full rounded px-3 py-2 text-left text-sm text-destructive hover:bg-muted"
                              onClick={() => {
                                setOpenMessageMenuId(null);
                                void deleteMessage(message);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {editingId === message.id ? (
                    <div className="space-y-2">
                      <textarea
                        aria-label="Edit message"
                        className="w-full rounded border bg-background p-2 text-sm"
                        maxLength={4000}
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          className="rounded border px-2 py-1 text-sm"
                          onClick={() => void saveEdit(message.id)}
                        >
                          Save
                        </button>
                        <button
                          className="rounded border px-2 py-1 text-sm"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {message.body && (
                        <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
                      )}
                      {message.image_url && (
                        <a href={message.image_url} target="_blank" rel="noreferrer">
                          <Image
                            src={message.image_url}
                            alt="Image attached to chat message"
                            width={640}
                            height={480}
                            unoptimized
                            className="mt-2 h-auto max-h-64 max-w-full rounded object-contain"
                          />
                        </a>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="px-4 pb-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {image && (
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
            Image selected: {image.name}
            <button
              className="underline"
              onClick={() => {
                setImage(null);
                if (fileRef.current) fileRef.current.value = '';
              }}
            >
              Remove
            </button>
          </div>
        )}
        {showEmoji && (
          <div className="flex flex-wrap gap-2 border-t px-4 py-2" aria-label="Smileys">
            {EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Insert ${emoji}`}
                className="rounded p-1 text-xl hover:bg-muted"
                onClick={() => setDraft((value) => value + emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={sendMessage} className="flex shrink-0 items-end gap-2 border-t p-3">
          <button
            type="button"
            title="Attach image"
            aria-label="Attach image"
            className="rounded-md border p-2"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={(event) => void selectImage(event)}
          />
          <button
            type="button"
            title="Insert smiley"
            aria-label="Insert smiley"
            className="rounded-md border p-2"
            onClick={() => setShowEmoji((value) => !value)}
          >
            <Smile className="h-4 w-4" />
          </button>
          <label className="flex-1">
            <span className="sr-only">Message</span>
            <div className="relative flex-1">
              <textarea
                aria-label="Message"
                value={draft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey) {
                    event.preventDefault();
                    if (!busy && (draft.trim() || image))
                      void sendMessage(event as unknown as FormEvent);
                  }
                }}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft(value);
                  const match = value.match(/(?:^|\s)@([^\s@]*)$/);
                  setMentionQuery(match ? match[1].toLowerCase() : null);
                }}
                maxLength={4000}
                rows={2}
                placeholder="Write a message… (Enter to send, Ctrl+Enter for a new line)"
                className="w-full resize-y rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              {mentionQuery !== null && (
                <div
                  className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
                  role="listbox"
                  aria-label="Mention a member"
                >
                  {mentionCandidates
                    .filter((candidate) => candidate.full_name.toLowerCase().includes(mentionQuery))
                    .slice(0, 8)
                    .map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          const next = draft.replace(
                            /(?:^|\s)@[^\s@]*$/,
                            (match) =>
                              `${match.startsWith(' ') ? ' ' : ''}@${candidate.full_name} `,
                          );
                          setDraft(next);
                          setMentions((old) =>
                            old.includes(candidate.id) ? old : [...old, candidate.id],
                          );
                          setMentionQuery(null);
                        }}
                      >
                        {candidate.full_name}
                      </button>
                    ))}
                  {mentionCandidates.filter((candidate) =>
                    candidate.full_name.toLowerCase().includes(mentionQuery),
                  ).length === 0 && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">No members found</p>
                  )}
                </div>
              )}
            </div>
          </label>
          <button
            type="submit"
            disabled={busy || (!draft.trim() && !image)}
            aria-label="Send message"
            className="rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
        <p className="shrink-0 border-t px-3 py-2 text-xs text-muted-foreground">
          Messages can be edited or deleted for five minutes after sending. Images must be 1 MB or
          smaller.
        </p>
      </div>
      <ConfirmDialog
        open={!!pendingDeleteMessage}
        title="Delete message?"
        description="This message will be deleted from the club chat."
        confirmLabel="Delete message"
        destructive
        busy={busy}
        onCancel={() => setPendingDeleteMessage(null)}
        onConfirm={() => void confirmDeleteMessage()}
      />
    </section>
  );
}
