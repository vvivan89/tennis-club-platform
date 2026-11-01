'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

export function useApprovedAdminPage(loginPath: string, onAuthorized: () => void) {
  const router = useRouter();
  const onAuthorizedRef = useRef(onAuthorized);
  onAuthorizedRef.current = onAuthorized;

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    db.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.replace(loginPath);
        return;
      }
      const { data } = await db
        .from('profiles')
        .select('role,application_status')
        .eq('id', user.id)
        .maybeSingle();
      if (data?.role !== 'admin' || data?.application_status !== 'approved') {
        router.replace('/member/dashboard');
        return;
      }
      onAuthorizedRef.current();
    });
  }, [loginPath, router]);
}
