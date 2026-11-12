'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CircleHelp, ShieldCheck, CalendarDays, UserRound, Globe2 } from 'lucide-react';

type HelpNavProps = { role: string | null; approved: boolean };

export function HelpNav({ role, approved }: HelpNavProps) {
  const pathname = usePathname();
  const isAdmin = role === 'admin';
  const isOrganizer = role === 'organizer';
  const guides = [
    { href: '/help/public', label: 'Public guide', Icon: Globe2 },
    ...(isAdmin ? [{ href: '/help/admin', label: 'Admin guide', Icon: ShieldCheck }] : []),
    ...(isOrganizer
      ? [{ href: '/help/organizer', label: 'Organizer guide', Icon: CalendarDays }]
      : []),
    ...(approved ? [{ href: '/help/member', label: 'Member guide', Icon: UserRound }] : []),
  ];

  if (!isAdmin && !isOrganizer && !approved) return null;

  return (
    <nav
      aria-label="Help navigation"
      className="hidden border-b border-border/70 bg-background lg:block"
    >
      <div className="page-container flex flex-wrap items-center gap-3 py-2">
        <div className="flex items-center gap-2 border-r border-border pr-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <CircleHelp className="h-4 w-4" />
          <span>Help Guides</span>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-center gap-1">
          {guides.map(({ href, label, Icon }) => {
            const current = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${current ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
