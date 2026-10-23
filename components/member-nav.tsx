'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, BarChart3, UsersRound, UserRound } from 'lucide-react';
const links = [
  { href: '/member/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/member/profile', label: 'Profile', Icon: UserRound },
  { href: '/member/results', label: 'Results', Icon: BarChart3 },
  { href: '/member/membership', label: 'Membership', Icon: UsersRound },
];
export function MemberNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Member portal navigation" className="border-b border-border/70 bg-background">
      <div className="page-container flex flex-wrap items-center gap-3 py-2">
        <div className="flex items-center gap-2 border-r border-border pr-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <UserRound className="h-4 w-4" />
          <span>Member Portal</span>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-center gap-1">
          {links.map((item) => {
            const current =
              item.href === '/member/dashboard'
                ? pathname === '/member/dashboard'
                : pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.Icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm transition-colors ${current ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
