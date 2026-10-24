'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { markMemberChatAsRead, shouldShowChatNotification } from '@/lib/member-chat';

type ChatToast = { id: string; author: string; body: string; image_path: string | null };

export function MemberChatNotifications() {
  const pathname = usePathname();
  const [toast, setToast] = useState<ChatToast | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const currentPathname = useRef(pathname);
  currentPathname.current = pathname;
  useEffect(() => {
    let active = true;
    let channel: ReturnType<ReturnType<typeof createSupabaseBrowserClient>['channel']> | undefined;
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !(
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      )
    )
      return;
    const supabase = createSupabaseBrowserClient();
    let preference: 'all' | 'mentions' | 'none' = 'all';
    let userId = '';
    const handledMessageIds = new Set<string>();
    let onlineUserIds: string[] = [];
    const pendingMessages: Array<{
      id: string;
      user_id: string;
      body: string | null;
      image_path: string | null;
      mentions?: string[];
      suppressToast?: boolean;
    }> = [];
    const onPresenceRequest = () => {
      window.dispatchEvent(
        new CustomEvent('pctc-chat-presence-updated', { detail: { userIds: onlineUserIds } }),
      );
    };
    const preferenceUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ preference?: 'all' | 'mentions' | 'none' }>).detail;
      if (detail?.preference) preference = detail.preference;
    };
    const showMessage = (message: {
      id: string;
      user_id: string;
      body: string | null;
      image_path: string | null;
      mentions?: string[];
      suppressToast?: boolean;
    }) => {
      if (!active || !userId || handledMessageIds.has(message.id)) return;
      handledMessageIds.add(message.id);
      if (handledMessageIds.size > 100)
        handledMessageIds.delete(handledMessageIds.values().next().value as string);
      // Suppress at receipt time, not render time. Mark it handled so navigating
      // away from chat cannot turn this same message into a delayed toast.
      if (message.suppressToast || currentPathname.current === '/member/chat') return;
      if (!shouldShowChatNotification(preference, message.user_id, userId, message.mentions ?? []))
        return;

      // Render immediately; a profile-name lookup must never block the toast.
      setToast({
        id: message.id,
        author: 'A member',
        body: message.body || (message.image_path ? 'Sent an image' : 'New message'),
        image_path: message.image_path,
      });
      void supabase.rpc('get_member_chat_member_names').then(({ data: names }) => {
        if (!active) return;
        const author = (names ?? []).find(
          (member: { id: string; full_name: string }) => member.id === message.user_id,
        )?.full_name;
        if (author)
          setToast((current) => (current?.id === message.id ? { ...current, author } : current));
      });
    };
    const onIncomingMessage = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          message?: {
            id: string;
            user_id: string;
            body: string | null;
            image_path: string | null;
            mentions?: string[];
          };
        }>
      ).detail;
      const message = detail?.message;
      if (!message) return;
      if (!userId) {
        pendingMessages.push({
          ...message,
          suppressToast: currentPathname.current === '/member/chat',
        });
        return;
      }
      showMessage(message);
    };
    window.addEventListener('pctc-chat-notification-preference-updated', preferenceUpdated);
    window.addEventListener('pctc-chat-message-received', onIncomingMessage);
    window.addEventListener('pctc-chat-presence-request', onPresenceRequest);
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!active || !user) return;
      userId = user.id;
      const { data: profile } = await supabase
        .from('profiles')
        .select('application_status,chat_notification_preference')
        .eq('id', user.id)
        .maybeSingle();
      if (!active || profile?.application_status !== 'approved') return;
      preference = (profile.chat_notification_preference || 'all') as 'all' | 'mentions' | 'none';
      for (const message of pendingMessages.splice(0)) showMessage(message);
      channel = supabase
        .channel('pctc-member-chat-global', { config: { presence: { key: user.id } } })
        .on('presence', { event: 'sync' }, () => {
          const state = channel?.presenceState<Record<string, unknown>>() ?? {};
          onlineUserIds = Object.keys(state);
          window.dispatchEvent(
            new CustomEvent('pctc-chat-presence-updated', { detail: { userIds: onlineUserIds } }),
          );
        })
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
          (payload) => {
            const updated = payload.new as {
              chat_notification_preference?: 'all' | 'mentions' | 'none';
              application_status?: string;
            };
            preference = updated.chat_notification_preference || 'all';
            if (updated.application_status && updated.application_status !== 'approved')
              setToast(null);
          },
        )
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel?.track({ user_id: user.id, connected_at: new Date().toISOString() });
          }
        });
    })();
    return () => {
      active = false;
      window.removeEventListener('pctc-chat-notification-preference-updated', preferenceUpdated);
      window.removeEventListener('pctc-chat-message-received', onIncomingMessage);
      window.removeEventListener('pctc-chat-presence-request', onPresenceRequest);
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (pathname === '/member/chat') {
      setToast(null);
      setMarkingRead(false);
    }
  }, [pathname]);

  const markToastAsRead = async () => {
    if (markingRead || !toast) return;
    setMarkingRead(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await markMemberChatAsRead(supabase, user.id);
      window.dispatchEvent(new CustomEvent('pctc-chat-message-received'));
      setToast(null);
    } catch (error) {
      console.error('Unable to mark chat message as read.', error);
    } finally {
      setMarkingRead(false);
    }
  };

  useEffect(() => {
    if (!toast || pathname === '/member/chat') return;
    const timer = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(timer);
  }, [toast, pathname]);

  if (!toast || pathname === '/member/chat') return null;
  return (
    <div
      role="status"
      className="fixed right-4 top-4 z-[100] w-[min(24rem,calc(100vw-2rem))] rounded-lg border bg-card p-4 text-card-foreground shadow-xl"
    >
      <div className="mb-1 font-semibold">New chat message · {toast.author}</div>
      <p className="line-clamp-3 break-words text-sm text-muted-foreground">{toast.body}</p>
      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/member/chat"
            className="font-medium underline"
            onClick={() => setToast(null)}
          >
            View Chat
          </Link>
          <button
            type="button"
            disabled={markingRead}
            className="font-medium underline disabled:opacity-50"
            onClick={() => void markToastAsRead()}
          >
            {markingRead ? 'Marking…' : 'Mark as read'}
          </button>
        </div>
        <button
          type="button"
          className="text-muted-foreground underline"
          onClick={() => setToast(null)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
