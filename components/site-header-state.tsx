'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

type HeaderState = {
  signedIn: boolean;
  authReady: boolean;
  logoUrl: string;
  canSeeDocuments: boolean;
  canSeeRankings: boolean;
  name: string;
  avatar: string;
  isAdmin: boolean;
  isOrganizer: boolean;
  approved: boolean;
};
const initialState: HeaderState = {
  signedIn: false,
  authReady: false,
  logoUrl: '',
  canSeeDocuments: false,
  canSeeRankings: false,
  name: '',
  avatar: '',
  isAdmin: false,
  isOrganizer: false,
  approved: false,
};
const HeaderStateContext = createContext<HeaderState>(initialState);

export function SiteHeaderStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HeaderState>(initialState);
  useEffect(() => {
    let alive = true;
    const db = createSupabaseBrowserClient();
    const loadLogo = async () => {
      const { data } = await db.from('club_settings').select('logo_url').eq('id', 1).maybeSingle();
      if (alive) setState((current) => ({ ...current, logoUrl: data?.logo_url || '' }));
    };
    const loadUser = async (user: { id: string; email?: string } | null) => {
      if (!user) {
        if (alive)
          setState((current) => ({ ...initialState, authReady: true, logoUrl: current.logoUrl }));
        return;
      }
      // Keep the previous profile/menu state visible while refreshing the session.
      const { data: profile } = await db
        .from('profiles')
        .select('full_name,avatar_url,role,application_status')
        .eq('id', user.id)
        .maybeSingle();
      let hasPaid = false;
      if (profile?.application_status === 'approved' && profile.role !== 'admin') {
        const { data } = await db.rpc('has_ever_paid_membership');
        hasPaid = Boolean(data);
        if (!hasPaid) {
          const { data: family } = await db
            .from('membership_family_members')
            .select('membership_families(paid_at)')
            .eq('user_id', user.id)
            .in('status', ['confirmed', 'removed_next_season'])
            .limit(1)
            .maybeSingle();
          const row = family as {
            membership_families: { paid_at: string | null } | { paid_at: string | null }[] | null;
          } | null;
          hasPaid = Boolean(
            Array.isArray(row?.membership_families)
              ? row.membership_families[0]?.paid_at
              : row?.membership_families?.paid_at,
          );
        }
      }
      if (alive)
        setState((current) => ({
          ...current,
          signedIn: true,
          authReady: true,
          name: profile?.full_name || user.email?.split('@')[0] || 'Member',
          avatar: profile?.avatar_url || '',
          isAdmin: profile?.role === 'admin',
          isOrganizer: profile?.role === 'organizer',
          approved: profile?.application_status === 'approved',
          canSeeDocuments:
            profile?.application_status === 'approved' && (profile?.role === 'admin' || hasPaid),
          canSeeRankings:
            profile?.application_status === 'approved' && (profile?.role === 'admin' || hasPaid),
        }));
    };
    void loadLogo();
    window.addEventListener('club-logo-updated', loadLogo);
    db.auth
      .getUser()
      .then(({ data: { user } }) => loadUser(user ? { id: user.id, email: user.email } : null))
      .catch(() => {
        if (alive) setState((current) => ({ ...current, authReady: true }));
      });
    const { data: subscription } = db.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) void loadUser(null);
      else void loadUser({ id: session.user.id, email: session.user.email });
    });
    return () => {
      alive = false;
      window.removeEventListener('club-logo-updated', loadLogo);
      subscription.subscription.unsubscribe();
    };
  }, []);
  return <HeaderStateContext.Provider value={state}>{children}</HeaderStateContext.Provider>;
}
export function useSiteHeaderState() {
  return useContext(HeaderStateContext);
}
