import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Files,
  LayoutDashboard,
  MessageCircle,
  Newspaper,
  UserRound,
  Users,
} from 'lucide-react';

export type PortalNavigationItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
};

export const memberPortalLinks: PortalNavigationItem[] = [
  { href: '/member/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/member/profile', label: 'Profile', Icon: UserRound },
  { href: '/member/results', label: 'Results', Icon: BarChart3 },
  { href: '/member/membership', label: 'Membership', Icon: Users },
  { href: '/member/payments', label: 'Payments', Icon: CreditCard },
  { href: '/member/chat', label: 'Chat', Icon: MessageCircle },
];

export const adminPortalLinks: PortalNavigationItem[] = [
  { href: '/admin/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/admin/club-profile', label: 'Club Profile', Icon: Building2 },
  { href: '/admin/members', label: 'Membership', Icon: Users },
  { href: '/admin/payments', label: 'Payments', Icon: CreditCard },
  { href: '/admin/events', label: 'Events', Icon: CalendarDays },
  { href: '/admin/website', label: 'Publications', Icon: Newspaper },
  { href: '/admin/documents', label: 'Documents', Icon: Files },
  { href: '/admin/audit-logs', label: 'Audit Logs', Icon: ClipboardList },
];

export const organizerPortalLinks: PortalNavigationItem[] = [
  { href: '/admin/organizer-dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/admin/events', label: 'Events', Icon: CalendarDays },
];

export function isMemberPortalLinkCurrent(href: string, pathname: string) {
  return href === '/member/dashboard'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function isAdminPortalLinkCurrent(href: string, pathname: string) {
  if (href === '/admin/dashboard' || href === '/admin/organizer-dashboard')
    return pathname === href || pathname === '/admin';
  if (href === '/admin/members')
    return (
      pathname.startsWith('/admin/members') ||
      pathname.startsWith('/admin/membership-types') ||
      pathname.startsWith('/admin/applications')
    );
  if (href === '/admin/website')
    return pathname.startsWith('/admin/website') || pathname.startsWith('/admin/gallery');
  if (href === '/admin/documents')
    return pathname.startsWith('/admin/documents') || pathname.startsWith('/admin/legal');
  return pathname === href || pathname.startsWith(`${href}/`);
}
