'use client';
import Image from 'next/image';
import { memo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MemberMenu } from '@/components/member-menu';
import type { MainNavigationItem } from '@/components/mobile-navigation-drawer';
import { PendingTournamentInvitationBadge } from '@/components/pending-tournament-invitation-badge';
import { usePendingTournamentInvitations } from '@/components/use-pending-tournament-invitations';
import { useSiteHeaderState } from '@/components/site-header-state';
import { CalendarDays, Images, ContactRound, Files, Trophy, CircleHelp, Home } from 'lucide-react';

export const SiteHeader = memo(function SiteHeader({
  clubName: suppliedClubName,
  shortName: suppliedShortName,
  active = '',
}: {
  clubName?: string;
  shortName?: string;
  active?: 'home' | 'events' | 'contacts' | 'gallery' | 'help' | '';
}) {
  const pathname = usePathname();
  const {
    logoUrl,
    clubName: configuredClubName,
    shortName: configuredShortName,
    canSeeDocuments,
    canSeeRankings,
    approved,
    isAdmin,
    isOrganizer,
  } = useSiteHeaderState();
  const clubName = suppliedClubName || configuredClubName || 'Tennis Club';
  const shortName = suppliedShortName || configuredShortName || '';
  const invitations = usePendingTournamentInvitations(approved && !isAdmin && !isOrganizer);
  const current = (key: string) =>
    active === key ||
    (key === 'events' && (pathname === '/events' || pathname.startsWith('/events/'))) ||
    (key === 'contacts' && pathname === '/contacts') ||
    (key === 'gallery' && pathname.startsWith('/gallery')) ||
    (key === 'documents' && pathname === '/documents') ||
    (key === 'rankings' && pathname === '/rankings') ||
    (key === 'help' && pathname.startsWith('/help'));
  const mainLinks: MainNavigationItem[] = [
    {
      href: '/',
      label: 'Home',
      icon: <Home className="h-5 w-5 shrink-0" aria-hidden="true" />,
      current: pathname === '/',
    },
    {
      href: '/events',
      label: 'Events',
      icon: <CalendarDays className="h-5 w-5 shrink-0" aria-hidden="true" />,
      current: current('events'),
      badge: <PendingTournamentInvitationBadge count={invitations.length} />,
    },
    {
      href: '/gallery',
      label: 'Gallery',
      icon: <Images className="h-5 w-5 shrink-0" aria-hidden="true" />,
      current: current('gallery'),
    },
    {
      href: '/contacts',
      label: 'Contacts',
      icon: <ContactRound className="h-5 w-5 shrink-0" aria-hidden="true" />,
      current: current('contacts'),
    },
    ...(canSeeRankings
      ? [
          {
            href: '/rankings',
            label: 'Rankings',
            icon: <Trophy className="h-5 w-5 shrink-0" aria-hidden="true" />,
            current: current('rankings'),
          },
        ]
      : []),
    ...(canSeeDocuments
      ? [
          {
            href: '/documents',
            label: 'Documents',
            icon: <Files className="h-5 w-5 shrink-0" aria-hidden="true" />,
            current: current('documents'),
          },
        ]
      : []),
    {
      href: '/help/public',
      label: 'Help',
      icon: <CircleHelp className="h-5 w-5 shrink-0" aria-hidden="true" />,
      current: current('help'),
    },
  ];
  const navClass = (selected: boolean) =>
    `rounded-md px-3 py-2 transition-colors ${selected ? 'bg-secondary text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'}`;
  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur">
      <div className="page-container flex min-h-[76px] items-center justify-between gap-3 py-3 lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={`${clubName} logo`}
              width={40}
              height={40}
              unoptimized
              className="h-10 w-10 shrink-0 rounded-md object-contain"
            />
          ) : (
            <span className="brand-mark">P</span>
          )}
          <span className="min-w-0 leading-tight">
            <strong className="block truncate text-base tracking-tight">{clubName}</strong>
            <span className="mt-1 block text-[9px] font-semibold tracking-[0.22em] text-muted-foreground">
              {shortName}
            </span>
          </span>
        </Link>
        <nav
          className="hidden items-center justify-center gap-1 text-sm lg:flex"
          aria-label="Main navigation"
        >
          <Link
            href="/events"
            aria-current={current('events') ? 'page' : undefined}
            className={`${navClass(current('events'))} inline-flex items-center gap-1.5`}
          >
            <CalendarDays className="h-4 w-4" />
            Events
            <PendingTournamentInvitationBadge count={invitations.length} />
          </Link>
          <Link
            href="/gallery"
            aria-current={current('gallery') ? 'page' : undefined}
            className={`${navClass(current('gallery'))} inline-flex items-center gap-1.5`}
          >
            <Images className="h-4 w-4" />
            Gallery
          </Link>
          <Link
            href="/contacts"
            aria-current={current('contacts') ? 'page' : undefined}
            className={`${navClass(current('contacts'))} inline-flex items-center gap-1.5`}
          >
            <ContactRound className="h-4 w-4" />
            Contacts
          </Link>
          {canSeeRankings && (
            <Link
              href="/rankings"
              aria-current={current('rankings') ? 'page' : undefined}
              className={`${navClass(current('rankings'))} inline-flex items-center gap-1.5`}
            >
              <Trophy className="h-4 w-4" />
              Rankings
            </Link>
          )}
          {canSeeDocuments && (
            <Link
              href="/documents"
              aria-current={current('documents') ? 'page' : undefined}
              className={`${navClass(current('documents'))} inline-flex items-center gap-1.5`}
            >
              <Files className="h-4 w-4" />
              Documents
            </Link>
          )}
          <Link
            href="/help/public"
            aria-current={current('help') ? 'page' : undefined}
            className={`${navClass(current('help'))} inline-flex items-center gap-1.5`}
          >
            <CircleHelp className="h-4 w-4" />
            Help
          </Link>
        </nav>
        <div className="flex justify-end">
          <MemberMenu mainLinks={mainLinks} />
        </div>
      </div>
    </header>
  );
});
