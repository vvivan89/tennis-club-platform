import { redirect } from 'next/navigation';
export default function LegacyAdminTab() {
  redirect('/admin/members?tab=applications');
}
