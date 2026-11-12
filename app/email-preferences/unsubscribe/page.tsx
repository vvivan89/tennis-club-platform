import type { Metadata } from 'next';
import { EmailUnsubscribeConfirmation } from '@/components/email-unsubscribe-confirmation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Email preferences',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? '' : params.token || '';

  return (
    <main className="page-container flex flex-1 items-center justify-center py-10">
      <EmailUnsubscribeConfirmation token={token} />
    </main>
  );
}
