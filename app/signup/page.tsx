import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/auth-form';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { TennisLoader } from '@/components/tennis-loader';

export default function SignupPage() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName="Port Coquitlam Tennis Club" shortName="PCTC" />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <Suspense
          fallback={
            <div className="p-8">
              <TennisLoader label="Loading registration" />
            </div>
          }
        >
          <AuthForm mode="signup" />
        </Suspense>
      </div>
      <SiteFooter />
    </main>
  );
}
