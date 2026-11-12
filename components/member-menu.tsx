'use client';
import Image from 'next/image';
import { memo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, User, ShieldCheck, CalendarDays, LogOut, LogIn } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { removeChatPushSubscriptionForSignOut } from '@/lib/chat-push-client';
import { useSiteHeaderState } from '@/components/site-header-state';
import { Button } from '@/components/ui/button';
import {
  MobileNavigationDrawer,
  type MainNavigationItem,
} from '@/components/mobile-navigation-drawer';

export const MemberMenu = memo(function MemberMenu({
  mainLinks = [],
}: {
  mainLinks?: MainNavigationItem[];
}) {
  const { signedIn, authReady, name, avatar, isAdmin, isOrganizer, approved, isEventGuest } =
    useSiteHeaderState();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'M';
  async function signOut() {
    await removeChatPushSubscriptionForSignOut();
    const db = createSupabaseBrowserClient();
    await db.rpc('record_client_audit_event', {
      p_action: 'auth.sign_out',
      p_summary: 'User signed out',
      p_route: window.location.pathname,
      p_source: 'web',
      p_metadata: {},
    });
    await db.auth.signOut();
    setOpen(false);
    router.replace('/');
    router.refresh();
  }
  if (!signedIn)
    return (
      <>
        <div className="hidden lg:block">
          <Button asChild variant="outline" size="sm">
            <Link href="/login" className="inline-flex items-center gap-2">
              <LogIn className="h-4 w-4" />
              {authReady ? 'Member sign in' : 'Checking session…'}
            </Link>
          </Button>
        </div>
        <MobileNavigationDrawer
          mainLinks={mainLinks}
          signedIn={false}
          avatar=""
          initials=""
          name=""
          approved={false}
          isAdmin={false}
          isOrganizer={false}
          isEventGuest={false}
          onSignOut={() => {}}
        />
      </>
    );
  return (
    <>
      <div
        className="relative hidden lg:block"
        onBlur={(event) => {
          const nextFocusedElement = event.relatedTarget;
          if (
            !(nextFocusedElement instanceof Node) ||
            !event.currentTarget.contains(nextFocusedElement)
          )
            setOpen(false);
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Member menu"
          className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 text-sm font-medium hover:bg-accent"
        >
          {avatar ? (
            <Image
              src={avatar}
              alt=""
              width={32}
              height={32}
              unoptimized
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <span className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-xs font-semibold">
              {initials}
            </span>
          )}
          <span className="max-w-32 truncate">{name || 'Member'}</span>
          <ChevronDown className="h-4 w-4" />
        </button>
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-48 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-1 shadow-lg">
            {approved && (
              <Link
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
                href="/member/dashboard"
              >
                <User className="h-4 w-4" />
                Member Portal
              </Link>
            )}
            {isEventGuest && (
              <Link
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
                href="/my-events"
              >
                <CalendarDays className="h-4 w-4" />
                My events
              </Link>
            )}
            {approved && isAdmin && (
              <Link
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
                href="/admin/dashboard"
              >
                <ShieldCheck className="h-4 w-4" />
                Admin Portal
              </Link>
            )}
            {approved && isOrganizer && (
              <Link
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
                href="/admin/organizer-dashboard"
              >
                <CalendarDays className="h-4 w-4" />
                Organizer Portal
              </Link>
            )}
            <button
              onClick={signOut}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-accent"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
      <MobileNavigationDrawer
        mainLinks={mainLinks}
        signedIn
        avatar={avatar}
        initials={initials}
        name={name || 'Member'}
        approved={approved}
        isAdmin={isAdmin}
        isOrganizer={isOrganizer}
        isEventGuest={isEventGuest}
        onSignOut={() => void signOut()}
      />
    </>
  );
});
