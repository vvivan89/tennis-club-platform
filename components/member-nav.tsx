'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { LayoutDashboard, BarChart3, UsersRound, UserRound, MessageCircle } from 'lucide-react';
const links = [
  { href: '/member/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/member/profile', label: 'Profile', Icon: UserRound },
  { href: '/member/results', label: 'Results', Icon: BarChart3 },
  { href: '/member/membership', label: 'Membership', Icon: UsersRound },
  { href: '/member/chat', label: 'Chat', Icon: MessageCircle },
];
export function MemberNav() {
  const pathname = usePathname();
  const [approved, setApproved] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    let active = true;
    let channel: ReturnType<ReturnType<typeof createSupabaseBrowserClient>['channel']> | undefined;
    const supabase = createSupabaseBrowserClient();
    let userId = '';
    let refreshInProgress = false;
    let refreshQueued = false;

    const updateUnread = async () => {
      if (!active || !userId) return;
      if (refreshInProgress) {
        refreshQueued = true;
        return;
      }
      refreshInProgress = true;
      try {
        do {
          refreshQueued = false;
          const { data: count, error } = await supabase.rpc('get_member_chat_unread_count');
          if (!active) return;
          if (!error && typeof count === 'number') setUnreadCount(count);
        } while (active && refreshQueued);
      } finally {
        refreshInProgress = false;
        if (active && refreshQueued) void updateUnread();
      }
    };

    const refreshOnSignal = () => {
      void updateUnread();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshOnSignal();
    };
    window.addEventListener('pctc-chat-message-received', refreshOnSignal);
    window.addEventListener('focus', refreshOnSignal);
    document.addEventListener('visibilitychange', onVisibilityChange);

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!active || !user) return;
      userId = user.id;
      const { data: profile } = await supabase
        .from('profiles')
        .select('application_status')
        .eq('id', user.id)
        .maybeSingle();
      if (!active) return;
      const isApproved = profile?.application_status === 'approved';
      setApproved(isApproved);
      if (!isApproved) {
        setUnreadCount(0);
        return;
      }

      // Subscribe before the initial count so a message arriving during the first
      // query cannot be missed. Badge updates are event-driven; no periodic polling.
      channel = supabase
        .channel(`member-chat-nav-${user.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'member_chat_messages' },
          (payload) => {
            refreshOnSignal();
            window.dispatchEvent(
              new CustomEvent('pctc-chat-message-received', { detail: { message: payload.new } }),
            );
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'member_chat_messages' },
          refreshOnSignal,
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'member_chat_messages' },
          refreshOnSignal,
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'member_chat_reads',
            filter: `user_id=eq.${user.id}`,
          },
          refreshOnSignal,
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') refreshOnSignal();
        });
      await updateUnread();
    })();

    return () => {
      active = false;
      window.removeEventListener('pctc-chat-message-received', refreshOnSignal);
      window.removeEventListener('focus', refreshOnSignal);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);
  const visibleLinks = links.filter((item) => item.href !== '/member/chat' || approved);
  return (
    <nav aria-label="Member portal navigation" className="border-b border-border/70 bg-background">
      <div className="page-container flex flex-wrap items-center gap-3 py-2">
        <div className="flex items-center gap-2 border-r border-border pr-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <UserRound className="h-4 w-4" />
          <span>Member Portal</span>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-center gap-1">
          {visibleLinks.map((item) => {
            const current =
              item.href === '/member/dashboard'
                ? pathname === '/member/dashboard'
                : pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.Icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm transition-colors ${current ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
                {item.href === '/member/chat' && unreadCount > 0 && pathname !== '/member/chat' && (
                  <span
                    aria-label={`${unreadCount} unread messages`}
                    className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
