'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import {
  LayoutDashboard,
  Building2,
  Users,
  CalendarDays,
  Newspaper,
  Files,
  ShieldCheck,
  ClipboardList,
  CreditCard,
} from 'lucide-react';
const adminLinks = [
  { href: '/admin/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/admin/club-profile', label: 'Club Profile', Icon: Building2 },
  { href: '/admin/members', label: 'Membership', Icon: Users },
  { href: '/admin/payments', label: 'Payments', Icon: CreditCard },
  { href: '/admin/events', label: 'Events', Icon: CalendarDays },
  { href: '/admin/website', label: 'Publications', Icon: Newspaper },
  { href: '/admin/documents', label: 'Documents', Icon: Files },
  { href: '/admin/audit-logs', label: 'Audit Logs', Icon: ClipboardList },
];
const organizerLinks = [
  { href: '/admin/organizer-dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/admin/events', label: 'Events', Icon: CalendarDays },
];
export function AdminNav() {
  const pathname = usePathname();
  const [club, setClub] = useState({ short_name: 'PCTC', club_name: 'Port Coquitlam Tennis Club' });
  const [role, setRole] = useState('member');
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
  const links = role === 'organizer' ? organizerLinks : adminLinks;
  return (
    <>
      <SiteHeader clubName={club.club_name} shortName={club.short_name} />
      <nav
        aria-label="Administration navigation"
        className="border-b border-border/70 bg-background"
      >
        <div className="page-container flex flex-wrap items-center gap-3 py-2">
          <div className="flex items-center gap-2 border-r border-border pr-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            <span>{role === 'organizer' ? 'Organizer Portal' : 'Admin Portal'}</span>
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-center gap-1">
            {links.map((item) => {
              const current =
                item.href === '/admin/dashboard' || item.href === '/admin/organizer-dashboard'
                  ? pathname === item.href || pathname === '/admin'
                  : item.href === '/admin/members'
                    ? pathname.startsWith('/admin/members') ||
                      pathname.startsWith('/admin/membership-types') ||
                      pathname.startsWith('/admin/applications')
                    : item.href === '/admin/website'
                      ? pathname.startsWith('/admin/website') ||
                        pathname.startsWith('/admin/gallery')
                      : item.href === '/admin/documents'
                        ? pathname.startsWith('/admin/documents') ||
                          pathname.startsWith('/admin/legal')
                        : pathname === item.href || pathname.startsWith(item.href + '/');
              const Icon = item.Icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${current ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
