import { NextResponse } from 'next/server';
import { checkAdminRole, getConfiguredServiceClient, getSignedInUser } from '@/lib/api-helpers';
export async function GET() {
  const { user, response: authError } = await getSignedInUser();
  if (authError) return authError;
  const { db, response: configError } = getConfiguredServiceClient('Database is not configured.');
  if (configError) return configError;
  const adminError = await checkAdminRole(db, user.id, { approved: true });
  if (adminError) return adminError;
  const { data, error } = await db
    .from('email_announcement_history')
    .select('id,subject,body_html,recipient_group,sent_count,failed_count,sent_at')
    .order('sent_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
