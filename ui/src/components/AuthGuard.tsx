'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

const PUBLIC_PATHS = ['/auth/login', '/auth/callback'];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isPublicPath = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (!loading && !user && !isPublicPath) {
      router.replace('/auth/login');
    }
  }, [loading, user, isPublicPath, router]);

  // Always render public paths immediately — never block /auth/callback
  // with the loading spinner, otherwise Amplify can't process the OAuth code
  if (isPublicPath) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          width: '100vw',
          background: '#08090a',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid rgba(255,255,255,0.1)',
            borderTopColor: '#7170ff',
            borderRadius: '50%',
            animation: 'auth-spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes auth-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
