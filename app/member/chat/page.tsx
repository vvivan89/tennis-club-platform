import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { MemberNav } from '@/components/member-nav';
import { MemberChat } from '@/components/member-chat';

export default async function MemberChatPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/member/chat');
  const { data: profile } = await supabase
    .from('profiles')
    .select('application_status')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.application_status !== 'approved') redirect('/member/dashboard');
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="shrink-0">
        <SiteHeader />
      </div>
      <div className="shrink-0">
        <MemberNav />
      </div>
      <main className="page-container min-h-0 flex-1 overflow-hidden py-4">
        <MemberChat userId={user.id} />
      </main>
      <div className="shrink-0">
        <SiteFooter />
      </div>
    </div>
  );
}
