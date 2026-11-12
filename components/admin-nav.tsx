'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { usePendingMemberApplicationsCount } from '@/lib/use-pending-member-applications-count';
import { usePendingInteracPaymentsCount } from '@/lib/use-pending-interac-payments-count';
import { NavCountBadge } from '@/components/nav-count-badge';
import { PortalNavLink } from '@/components/portal-nav-link';
import { ShieldCheck } from 'lucide-react';
import {
  adminPortalLinks,
  isAdminPortalLinkCurrent,
  organizerPortalLinks,
} from '@/components/portal-navigation-items';
export function AdminNav() {
  const pathname = usePathname();
  const [club, setClub] = useState({ short_name: '', club_name: 'Port Coquitlam Tennis Club' });
  const [role, setRole] = useState('member');
  const pendingApplicationCount = usePendingMemberApplicationsCount(role === 'admin');
  const pendingInteracPaymentCount = usePendingInteracPaymentsCount(role === 'admin');
  useEffect(() => {
    let active = true;
    const db = createSupabaseBrowserClient();
    async function load() {
      const [
        { data: clubData },
        {
          data: { user },
        },
      ] = await Promise.all([
        db.from('club_settings').select('short_name,club_name').eq('id', 1).maybeSingle(),
        db.auth.getUser(),
      ]);
      if (!active) return;
      if (clubData) setClub(clubData);
      if (user) {
        const { data } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
        if (active) setRole(data?.role ?? 'member');
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);
  const links = role === 'organizer' ? organizerPortalLinks : adminPortalLinks;
  return (
    <>
      <SiteHeader clubName={club.club_name} shortName={club.short_name} />
      <nav
        aria-label="Administration navigation"
        className="hidden border-b border-border/70 bg-background lg:block"
      >
        <div className="page-container flex flex-wrap items-center gap-3 py-2">
          <div className="flex items-center gap-2 border-r border-border pr-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            <span>{role === 'organizer' ? 'Organizer Portal' : 'Admin Portal'}</span>
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-center gap-1">
            {links.map((item) => {
              const current = isAdminPortalLinkCurrent(item.href, pathname);
              const Icon = item.Icon;
              return (
                <PortalNavLink
                  key={item.href}
                  href={item.href}
                  current={current}
                  label={item.label}
                  icon={<Icon className="h-4 w-4" />}
                >
                  {item.href === '/admin/members' && (
                    <NavCountBadge
                      count={pendingApplicationCount}
                      label={`${pendingApplicationCount} pending applications`}
                    />
                  )}
                  {item.href === '/admin/payments' && (
                    <NavCountBadge
                      count={pendingInteracPaymentCount}
                      label={`${pendingInteracPaymentCount} unreviewed Interac payments`}
                    />
                  )}
                </PortalNavLink>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
