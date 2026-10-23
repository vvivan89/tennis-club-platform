'use client';
import Image from 'next/image';
import { memo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MemberMenu } from '@/components/member-menu';
import { useSiteHeaderState } from '@/components/site-header-state';
import { CalendarDays, Images, ContactRound, Files, Trophy } from 'lucide-react';

export const SiteHeader = memo(function SiteHeader({
  clubName,
  shortName,
  active = '',
}: {
  clubName: string;
  shortName: string;
  active?: 'home' | 'events' | 'contacts' | 'gallery' | '';
}) {
  const pathname = usePathname();
  const { logoUrl, canSeeDocuments, canSeeRankings } = useSiteHeaderState();
  const current = (key: string) =>
    active === key ||
    (key === 'events' && (pathname === '/events' || pathname.startsWith('/events/'))) ||
    (key === 'contacts' && pathname === '/contacts') ||
    (key === 'gallery' && pathname.startsWith('/gallery')) ||
    (key === 'documents' && pathname === '/documents') ||
    (key === 'rankings' && pathname === '/rankings');
  const navClass = (selected: boolean) =>
    `rounded-md px-3 py-2 transition-colors ${selected ? 'bg-secondary text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'}`;
  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur">
      <div className="page-container grid min-h-[76px] grid-cols-[1fr_auto_1fr] items-center gap-3 py-3">
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
          className="hidden items-center justify-center gap-1 text-sm md:flex"
          aria-label="Main navigation"
        >
          <Link
            href="/events"
            aria-current={current('events') ? 'page' : undefined}
            className={`${navClass(current('events'))} inline-flex items-center gap-1.5`}
          >
            <CalendarDays className="h-4 w-4" />
            Events
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
        </nav>
        <div className="flex justify-end">
          <MemberMenu />
        </div>
      </div>
      <nav
        className="flex items-center justify-center gap-1 border-t border-border/50 px-4 py-2 text-sm md:hidden"
        aria-label="Main navigation mobile"
      >
        <Link
          href="/events"
          className={`${navClass(current('events'))} inline-flex items-center gap-1`}
        >
          <CalendarDays className="h-4 w-4" />
          Events
        </Link>
        <Link
          href="/gallery"
          className={`${navClass(current('gallery'))} inline-flex items-center gap-1`}
        >
          <Images className="h-4 w-4" />
          Gallery
        </Link>
        <Link
          href="/contacts"
          className={`${navClass(current('contacts'))} inline-flex items-center gap-1`}
        >
          <ContactRound className="h-4 w-4" />
          Contacts
        </Link>
        {canSeeRankings && (
          <Link
            href="/rankings"
            className={`${navClass(current('rankings'))} inline-flex items-center gap-1`}
          >
            <Trophy className="h-4 w-4" />
            Rankings
          </Link>
        )}
        {canSeeDocuments && (
          <Link
            href="/documents"
            className={`${navClass(current('documents'))} inline-flex items-center gap-1`}
          >
            <Files className="h-4 w-4" />
            Documents
          </Link>
        )}
      </nav>
    </header>
  );
});
