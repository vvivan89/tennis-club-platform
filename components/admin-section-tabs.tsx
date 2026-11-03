'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePendingMemberApplicationsCount } from '@/lib/use-pending-member-applications-count';
import {
  Users,
  Tags,
  ClipboardCheck,
  Newspaper,
  Megaphone,
  Images,
  FileCheck,
  BookOpen,
  ShieldAlert,
  Files,
} from 'lucide-react';

const membershipTabs = [
  { href: '/admin/members', label: 'Members', Icon: Users },
  { href: '/admin/members?tab=membership-types', label: 'Membership types', Icon: Tags },
  { href: '/admin/members?tab=applications', label: 'Applications', Icon: ClipboardCheck },
];
const publicationTabs = [
  { href: '/admin/website?tab=news', label: 'News', Icon: Newspaper },
  { href: '/admin/website?tab=announcements', label: 'Announcements', Icon: Megaphone },
  { href: '/admin/website?tab=gallery', label: 'Gallery', Icon: Images },
];
const legalTabs = [
  { href: '/admin/documents?tab=membership_waiver', label: 'Membership waiver', Icon: FileCheck },
  { href: '/admin/documents?tab=terms_of_use', label: 'Terms of use', Icon: BookOpen },
  { href: '/admin/documents?tab=disclaimer', label: 'Disclaimer', Icon: ShieldAlert },
  { href: '/admin/documents?tab=uploaded_documents', label: 'Uploaded documents', Icon: Files },
];
export function AdminSectionTabs({
  section,
}: {
  section: 'membership' | 'publications' | 'legal';
}) {
  const pathname = usePathname();
  const [search, setSearch] = useState('');
  const pendingApplicationCount = usePendingMemberApplicationsCount(section === 'membership');
  useEffect(() => {
    setSearch(window.location.search);
  }, [pathname]);
  const tabs =
    section === 'membership'
      ? membershipTabs
      : section === 'publications'
        ? publicationTabs
        : legalTabs;
  return (
    <div
      role="tablist"
      aria-label={`${section} pages`}
      className="mb-7 flex flex-wrap gap-2 border-b border-border pb-3"
    >
      {tabs.map((tab) => {
        const [path, query] = tab.href.split('?');
        const current =
          pathname === path &&
          ((section === 'publications' &&
            (new URLSearchParams(search).get('tab') || 'news') ===
              (new URLSearchParams(query || '').get('tab') || 'news')) ||
            (section === 'legal' &&
              (new URLSearchParams(search).get('tab') || 'membership_waiver') ===
                (new URLSearchParams(query || '').get('tab') || 'membership_waiver')) ||
            (section === 'membership' &&
              (new URLSearchParams(search).get('tab') || 'members') ===
                (new URLSearchParams(query || '').get('tab') || 'members')));
        const className = `inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm ${current ? 'border-primary bg-secondary font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`;
        const Icon = tab.Icon;
        const content = (
          <>
            <Icon className="h-4 w-4" />
            <span>{tab.label}</span>
            {section === 'membership' &&
              tab.label === 'Applications' &&
              pendingApplicationCount > 0 && (
                <span
                  aria-label={`${pendingApplicationCount} pending applications`}
                  className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
                >
                  {pendingApplicationCount > 99 ? '99+' : pendingApplicationCount}
                </span>
              )}
          </>
        );
        return (
          <a
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={current}
            className={className}
          >
            {content}
          </a>
        );
      })}
    </div>
  );
}
