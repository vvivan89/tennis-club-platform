import { TennisLoader } from '@/components/tennis-loader';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/auth-form';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <Suspense
          fallback={
            <div className="p-8">
              <TennisLoader label="Loading form" />
            </div>
          }
        >
          <AuthForm mode="reset" />
        </Suspense>
      </div>
      <SiteFooter />
    </main>
  );
}
