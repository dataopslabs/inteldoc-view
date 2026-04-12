'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Hub } from 'aws-amplify/utils';
import { getCurrentUser } from 'aws-amplify/auth';
import { configureAmplify } from '@/lib/amplify';

// Ensure Amplify is configured before processing the OAuth callback
configureAmplify();

export default function AuthCallbackPage() {
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    const redirect = () => {
      if (!redirected.current) {
        redirected.current = true;
        router.replace('/dashboard');
      }
    };

    // Listen for Amplify signedIn Hub event — fires after Amplify
    // exchanges the ?code= in the URL for tokens automatically
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn') {
        redirect();
      }
      // Handle token refresh / already-authed edge case
      if (payload.event === 'tokenRefresh') {
        redirect();
      }
    });

    // Poll getCurrentUser every 500ms for up to 15s
    // (Amplify processes the code asynchronously on mount)
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      getCurrentUser()
        .then(() => {
          clearInterval(poll);
          redirect();
        })
        .catch(() => {
          if (attempts >= 30) {
            // 15s timeout — give up and send to login
            clearInterval(poll);
            if (!redirected.current) {
              redirected.current = true;
              router.replace('/auth/login');
            }
          }
        });
    }, 500);

    return () => {
      unsubscribe();
      clearInterval(poll);
    };
  }, [router]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#08090a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          border: '3px solid rgba(255,255,255,0.1)',
          borderTopColor: '#7170ff',
          borderRadius: '50%',
          animation: 'auth-spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes auth-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ color: '#d0d6e0', fontSize: '14px' }}>Signing you in…</div>
      <div style={{ color: '#62666d', fontSize: '12px' }}>Completing Google authentication</div>
    </div>
  );
}
