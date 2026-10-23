import { redirect } from 'next/navigation';
export default function LegacyAdminGallery() {
  redirect('/admin/website?tab=gallery');
}
