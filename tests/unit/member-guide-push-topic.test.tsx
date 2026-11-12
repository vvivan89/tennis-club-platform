import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/site-header-state', () => ({
  useSiteHeaderState: () => ({ shortName: 'PCTC' }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { MemberHelpGuide, MemberHelpTopicNav } from '@/components/help-guides/member-guide';

afterEach(cleanup);

describe('member help guide chat push topic', () => {
  it('renders actual short club name in managed email subjects and separates push guidance', async () => {
    const user = userEvent.setup();
    render(
      <>
        <MemberHelpTopicNav />
        <MemberHelpGuide />
      </>,
    );

    await user.click(screen.getByRole('tab', { name: 'Profile' }));
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'LI' &&
          element.textContent?.includes('PCTC — Registration confirmed: {event title}') === true,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\{club short name\}/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('row', { name: /Enable push notifications/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Resources & chat' }));
    expect(screen.getByRole('heading', { name: 'Chat push notifications' })).toBeInTheDocument();
    expect(screen.getByText(/that particular device only/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chat push notifications' })).toBeInTheDocument();
  });
});
