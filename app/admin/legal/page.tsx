import { redirect } from 'next/navigation';

type Props = { searchParams?: Promise<{ tab?: string | string[] }> };

export default async function LegacyAdminLegalPage({ searchParams }: Props) {
  const value = (await searchParams)?.tab;
  const tab = Array.isArray(value) ? value[0] : value;
  redirect(tab ? `/admin/documents?tab=${encodeURIComponent(tab)}` : '/admin/documents');
}
