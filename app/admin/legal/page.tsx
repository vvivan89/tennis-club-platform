import { redirect } from 'next/navigation';

type Props = { searchParams?: { tab?: string | string[] } };

export default function LegacyAdminLegalPage({ searchParams }: Props) {
  const value = searchParams?.tab;
  const tab = Array.isArray(value) ? value[0] : value;
  redirect(tab ? `/admin/documents?tab=${encodeURIComponent(tab)}` : '/admin/documents');
}
