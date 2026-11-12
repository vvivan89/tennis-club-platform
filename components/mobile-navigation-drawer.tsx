'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Globe2,
  LogIn,
  LogOut,
  Menu,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import {
  adminPortalLinks,
  isAdminPortalLinkCurrent,
  isMemberPortalLinkCurrent,
  memberPortalLinks,
  organizerPortalLinks,
} from '@/components/portal-navigation-items';

export type MainNavigationItem = {
  href: string;
  label: string;
  icon: ReactNode;
  current: boolean;
  badge?: ReactNode;
};

type DrawerSection = {
  id: 'main' | 'member' | 'admin';
  title: string;
  icon?: ReactNode;
  items: Array<{
    href: string;
    label: string;
    icon: ReactNode;
    current: boolean;
    badge?: ReactNode;
  }>;
};

export function MobileNavigationDrawer({
  mainLinks,
  signedIn,
  avatar,
  initials,
  name,
  approved,
  isAdmin,
  isOrganizer,
  isEventGuest,
  onSignOut,
}: {
  mainLinks: MainNavigationItem[];
  signedIn: boolean;
  avatar: string;
  initials: string;
  name: string;
  approved: boolean;
  isAdmin: boolean;
  isOrganizer: boolean;
  isEventGuest: boolean;
  onSignOut: () => void;
}) {
  const pathname = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'main' | 'member' | 'admin' | null>(null);
  const [helpExpanded, setHelpExpanded] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const activeSection: 'main' | 'member' | 'admin' = pathname.startsWith('/member/')
    ? 'member'
    : pathname.startsWith('/admin/') || pathname === '/admin'
      ? 'admin'
      : 'main';

  const sections = useMemo<DrawerSection[]>(() => {
    const mainItems = [...mainLinks];
    if (isEventGuest) {
      mainItems.push({
        href: '/my-events',
        label: 'My events',
        icon: <CalendarDays className="h-5 w-5 shrink-0" aria-hidden="true" />,
        current: pathname === '/my-events',
      });
    }

    const result: DrawerSection[] = [
      {
        id: 'main',
        title: 'Main menu',
        items: mainItems,
      },
    ];
    if (approved) {
      result.push({
        id: 'member',
        title: 'Member Portal',
        icon: <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />,
        items: memberPortalLinks
          .filter((item) => item.href !== '/member/chat' || approved)
          .map(({ href, label, Icon }) => ({
            href,
            label,
            icon: <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />,
            current: isMemberPortalLinkCurrent(href, pathname),
          })),
      });
    }
    if (approved && (isAdmin || isOrganizer)) {
      const portalItems = isOrganizer && !isAdmin ? organizerPortalLinks : adminPortalLinks;
      result.push({
        id: 'admin',
        title: isOrganizer && !isAdmin ? 'Organizer Portal' : 'Admin Portal',
        icon:
          isOrganizer && !isAdmin ? (
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          ),
        items: portalItems.map(({ href, label, Icon }) => ({
          href,
          label,
          icon: <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />,
          current: isAdminPortalLinkCurrent(href, pathname),
        })),
      });
    }
    return result;
  }, [approved, isAdmin, isEventGuest, isOrganizer, mainLinks, pathname]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.querySelector<HTMLElement>('[data-drawer-close]')?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setExpandedSection(activeSection);
      setHelpExpanded(pathname.startsWith('/help'));
    }
  }, [activeSection, open, pathname]);

  return (
    <>
      <button
        type="button"
        aria-label={signedIn ? 'Open navigation menu' : 'Open public menu'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="mobile-navigation-drawer"
        onClick={() => setOpen(true)}
        className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        {signedIn ? (
          avatar ? (
            <Image
              src={avatar}
              alt=""
              width={36}
              height={36}
              unoptimized
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-xs font-semibold">
              {initials}
            </span>
          )
        ) : (
          <Menu className="h-5 w-5" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div
          className="mobile-navigation-backdrop fixed inset-0 z-[80] bg-overlay/60 lg:hidden"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            ref={drawerRef}
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-navigation-title"
            className="mobile-navigation-panel ml-auto flex h-[100dvh] w-full max-w-sm flex-col border-l border-border bg-background shadow-xl"
          >
            <header className="flex min-h-16 items-center justify-between border-b border-border px-5">
              <h2
                id="mobile-navigation-title"
                className="min-w-0 flex-1 truncate text-lg font-semibold"
              >
                {signedIn ? name : 'Menu'}
              </h2>
              <button
                type="button"
                data-drawer-close
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {!signedIn && (
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="mb-3 flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                  Log in
                </Link>
              )}
              {sections.map((section) => {
                const expanded = expandedSection === section.id;
                const panelId = `mobile-navigation-${section.id}-links`;
                const items = (
                  <nav
                    id={panelId}
                    aria-label={section.title}
                    className={`grid ${signedIn ? 'gap-0 pl-2' : 'gap-1'}`}
                  >
                    {section.items.map((item) => {
                      if (signedIn && item.href === '/help/public') {
                        const guides = [
                          {
                            href: '/help/public',
                            label: 'Public guide',
                            icon: <Globe2 className="h-4 w-4 shrink-0" aria-hidden="true" />,
                          },
                          ...(isAdmin
                            ? [
                                {
                                  href: '/help/admin',
                                  label: 'Admin guide',
                                  icon: (
                                    <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                                  ),
                                },
                              ]
                            : []),
                          ...(isOrganizer && !isAdmin
                            ? [
                                {
                                  href: '/help/organizer',
                                  label: 'Organizer guide',
                                  icon: (
                                    <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                                  ),
                                },
                              ]
                            : []),
                          ...(approved
                            ? [
                                {
                                  href: '/help/member',
                                  label: 'Member guide',
                                  icon: (
                                    <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
                                  ),
                                },
                              ]
                            : []),
                        ];
                        const helpPanelId = 'mobile-navigation-help-guides';
                        return (
                          <div key={item.href}>
                            <button
                              type="button"
                              aria-expanded={helpExpanded}
                              aria-controls={helpPanelId}
                              onClick={() => setHelpExpanded((value) => !value)}
                              className={`flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${item.current ? 'border-l-4 border-primary bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                            >
                              {item.icon || (
                                <CircleHelp className="h-5 w-5 shrink-0" aria-hidden="true" />
                              )}
                              <span className="min-w-0 flex-1">{item.label}</span>
                              <ChevronDown
                                className={`h-4 w-4 shrink-0 transition-transform ${helpExpanded ? 'rotate-180' : ''}`}
                                aria-hidden="true"
                              />
                            </button>
                            {helpExpanded && (
                              <nav
                                id={helpPanelId}
                                aria-label="Help guides"
                                className="grid gap-0 pl-8"
                              >
                                {guides.map((guide) => {
                                  const current = pathname === guide.href;
                                  return (
                                    <Link
                                      key={guide.href}
                                      href={guide.href}
                                      aria-current={current ? 'page' : undefined}
                                      onClick={() => setOpen(false)}
                                      className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm ${current ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                                    >
                                      {guide.icon}
                                      {guide.label}
                                    </Link>
                                  );
                                })}
                              </nav>
                            )}
                          </div>
                        );
                      }
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={item.current ? 'page' : undefined}
                          onClick={() => setOpen(false)}
                          className={`flex min-h-12 items-center gap-3 rounded-md px-3 py-2 text-sm ${item.current ? 'border-l-4 border-primary bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                        >
                          {item.icon}
                          <span className="min-w-0 flex-1">{item.label}</span>
                          {item.badge}
                        </Link>
                      );
                    })}
                  </nav>
                );

                if (!signedIn) {
                  return <div key={section.id}>{items}</div>;
                }

                return (
                  <section key={section.id} className="border-b border-border/50 pb-1">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      onClick={() => setExpandedSection(expanded ? null : section.id)}
                      className="flex min-h-10 w-full items-center justify-between gap-3 px-2 py-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        {section.icon}
                        {section.title}
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                    {expanded && items}
                  </section>
                );
              })}
              {signedIn && (
                <div className="border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onSignOut();
                    }}
                    className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-destructive hover:bg-muted"
                  >
                    <LogOut className="h-5 w-5" aria-hidden="true" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
