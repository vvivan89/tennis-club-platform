import Link from 'next/link';
import type { ReactNode } from 'react';

type PortalNavLinkProps = {
  href: string;
  current: boolean;
  label: string;
  icon: ReactNode;
  children?: ReactNode;
  horizontalPadding?: 'px-3' | 'px-4';
};

export function PortalNavLink({
  href,
  current,
  label,
  icon,
  children,
  horizontalPadding = 'px-3',
}: PortalNavLinkProps) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={`inline-flex items-center gap-2 rounded-md ${horizontalPadding} py-2 text-sm transition-colors ${current ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
    >
      {icon}
      <span>{label}</span>
      {children}
    </Link>
  );
}
