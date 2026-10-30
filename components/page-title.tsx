'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

function titleCase(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getPageTitle(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const portal = parts[0] === 'admin' ? 'Admin' : parts[0] === 'member' ? 'Member' : '';
  const path = portal ? parts.slice(1) : parts;
  let page = path[0] ? titleCase(path[0]) : 'Home';
  if (path[0] === 'events') page = 'Events';
  else if (path[0] === 'profile') page = 'Profile';
  else if (path[0] === 'dashboard' || (!path.length && portal)) page = 'Dashboard';
  else if (path[0] === 'create') page = 'Create Event';
  else if (path[0] === 'membership-types') page = 'Membership Types';
  else if (path[0] === 'audit-logs') page = 'Audit Logs';
  else if (path[0] === 'club-profile') page = 'Club Profile';
  else if (path[0] === 'forgot-password') page = 'Forgot Password';
  else if (path[0] === 'reset-password') page = 'Reset Password';
  return ['PCTC', portal, page].filter(Boolean).join(' | ');
}

export function PageTitle() {
  const pathname = usePathname() || '/';
  useEffect(() => {
    // Event detail pages set their title from the loaded event record.
    if (/^\/events\/[^/]+\/?$/.test(pathname)) return;
    document.title = getPageTitle(pathname);
  }, [pathname]);
  return null;
}
