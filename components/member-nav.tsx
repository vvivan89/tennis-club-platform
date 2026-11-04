'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { DEFAULT_MEMBERSHIP_SEASON_SETTINGS, getMembershipSeason } from '@/lib/membership-season';
import { NavCountBadge } from '@/components/nav-count-badge';
import { PortalNavLink } from '@/components/portal-nav-link';
import {
  LayoutDashboard,
  BarChart3,
  UsersRound,
  UserRound,
  MessageCircle,
  CreditCard,
  AlertTriangle,
} from 'lucide-react';
const links = [
  { href: '/member/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/member/profile', label: 'Profile', Icon: UserRound },
  { href: '/member/results', label: 'Results', Icon: BarChart3 },
  { href: '/member/membership', label: 'Membership', Icon: UsersRound },
  { href: '/member/payments', label: 'Payments', Icon: CreditCard },
  { href: '/member/chat', label: 'Chat', Icon: MessageCircle },
];
export function MemberNav() {
  const pathname = usePathname();
  const [approved, setApproved] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [membershipUnpaid, setMembershipUnpaid] = useState(false);
  useEffect(() => {
    let active = true;
    let channel: ReturnType<ReturnType<typeof createSupabaseBrowserClient>['channel']> | undefined;
    let membershipChannel:
      ReturnType<ReturnType<typeof createSupabaseBrowserClient>['channel']> | undefined;
    const supabase = createSupabaseBrowserClient();
    let userId = '';
    let refreshInProgress = false;
    let refreshQueued = false;
    let membershipRefreshInProgress = false;
    let membershipRefreshQueued = false;

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
    const refreshOnFocus = () => {
      refreshOnSignal();
      void updateMembershipStatus();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshOnFocus();
    };

    const updateMembershipStatus = async () => {
      if (!active || !userId) return;
      if (membershipRefreshInProgress) {
        membershipRefreshQueued = true;
        return;
      }
      membershipRefreshInProgress = true;
      try {
        do {
          membershipRefreshQueued = false;
          const response = await fetch('/api/membership/family', { cache: 'no-store' });
          const membershipData = await response.json();
          if (!active) return;
          if (!response.ok) {
            console.error('[Member navigation] Could not refresh membership payment status', {
              status: response.status,
            });
            continue;
          }

          const season = getMembershipSeason(
            membershipData.settings ?? DEFAULT_MEMBERSHIP_SEASON_SETTINGS,
          )!;

          const familyLinks = (membershipData.families ?? [])
            .filter(
              (entry: {
                membership: {
                  user_id: string;
                  status: string;
                  joined_at: string | null;
                  created_at: string;
                };
              }) =>
                entry.membership.user_id === userId &&
                ['confirmed', 'pending', 'removed_next_season'].includes(entry.membership.status),
            )
            .sort(
              (
                a: { membership: { joined_at: string | null; created_at: string } },
                b: { membership: { joined_at: string | null; created_at: string } },
              ) =>
                new Date(b.membership.joined_at || b.membership.created_at || 0).getTime() -
                new Date(a.membership.joined_at || a.membership.created_at || 0).getTime(),
            );
          const activeFamilyLinks = familyLinks.filter(
            (entry: { membership: { status: string } }) =>
              entry.membership.status === 'confirmed' ||
              entry.membership.status === 'removed_next_season',
          );
          const familyPaid = activeFamilyLinks.some(
            (entry: { family: { paid_at: string | null; payment_id: string | null } }) =>
              Boolean(entry.family.paid_at || entry.family.payment_id),
          );

          const latestMembership = membershipData.memberships?.[0];
          const latestIsCurrentSeason = Boolean(
            latestMembership &&
            latestMembership.starts_on === season.startsOn &&
            latestMembership.ends_on === season.endsOn,
          );
          const individualPaid = Boolean(
            latestMembership &&
            latestIsCurrentSeason &&
            (latestMembership.payment_status === 'paid' ||
              membershipData.payments?.some(
                (payment: { business_record_id: string; status: string }) =>
                  payment.business_record_id === latestMembership.id &&
                  payment.status === 'succeeded',
              )),
          );

          if (active) setMembershipUnpaid(!(familyPaid || individualPaid));
        } while (active && membershipRefreshQueued);
      } catch {
        // Keep the last known badge state; focus and realtime events retry the status check.
      } finally {
        membershipRefreshInProgress = false;
        if (active && membershipRefreshQueued) void updateMembershipStatus();
      }
    };

    window.addEventListener('pctc-chat-message-received', refreshOnSignal);
    window.addEventListener('focus', refreshOnFocus);
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
        setMembershipUnpaid(false);
        return;
      }

      membershipChannel = supabase
        .channel(`member-membership-nav-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'payments',
            filter: `user_id=eq.${user.id}`,
          },
          () => void updateMembershipStatus(),
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'memberships',
            filter: `user_id=eq.${user.id}`,
          },
          () => void updateMembershipStatus(),
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'membership_family_members',
            filter: `user_id=eq.${user.id}`,
          },
          () => void updateMembershipStatus(),
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'membership_families' },
          () => void updateMembershipStatus(),
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') void updateMembershipStatus();
        });

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
      await updateMembershipStatus();
    })();

    return () => {
      active = false;
      window.removeEventListener('pctc-chat-message-received', refreshOnSignal);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (channel) void supabase.removeChannel(channel);
      if (membershipChannel) void supabase.removeChannel(membershipChannel);
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
              <PortalNavLink
                key={item.href}
                href={item.href}
                current={current}
                label={item.label}
                icon={<Icon className="h-4 w-4" />}
                horizontalPadding="px-4"
              >
                {item.href === '/member/membership' && membershipUnpaid && (
                  <span
                    aria-label="Membership payment is unpaid for the current season"
                    title="Membership payment is unpaid for the current season"
                    className="inline-flex text-amber-500"
                  >
                    <AlertTriangle className="h-4 w-4 fill-amber-100 dark:fill-amber-950" />
                  </span>
                )}
                {item.href === '/member/chat' && pathname !== '/member/chat' && (
                  <NavCountBadge count={unreadCount} label={`${unreadCount} unread messages`} />
                )}
              </PortalNavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
