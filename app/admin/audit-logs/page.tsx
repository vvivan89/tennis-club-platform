import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { AdminNav } from '@/components/admin-nav';
import { AuditLogsConsole } from '@/components/admin/audit-logs-console';

export default async function AuditLogsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin/audit-logs');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') redirect('/member/dashboard');
  return (
    <>
      <AdminNav />
      <main className="page-container space-y-6 py-8">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="section-title">Audit &amp; error logs</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Search business changes, authentication events, and application failures. Audit records
            are read-only.
          </p>
        </div>
        <AuditLogsConsole />
      </main>
    </>
  );
}
