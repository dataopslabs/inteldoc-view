'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithRedirect } from 'aws-amplify/auth';
import { useAuth } from '@/components/AuthProvider';

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard');
    }
  }, [user, loading, router]);

  const handleSignIn = () => {
    signInWithRedirect({ provider: 'Google' });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        backgroundColor: '#08090a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          backgroundColor: '#0f1011',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '12px',
          padding: '40px',
          width: '100%',
          maxWidth: '380px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
        }}
      >
        {/* DocOps Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              backgroundColor: '#5e6ad2',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: 700,
            }}
          >
            D
          </div>
          <span
            style={{
              color: '#f7f8f8',
              fontSize: '18px',
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            DocOps
          </span>
        </div>

        {/* Tagline */}
        <p style={{ color: '#62666d', fontSize: '13px', textAlign: 'center', margin: 0 }}>
          Agentic Document Intelligence Platform
        </p>

        {/* Sign in button */}
        <button
          onClick={handleSignIn}
          disabled={loading}
          style={{
            width: '100%',
            padding: '10px 16px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: '#5e6ad2',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 500,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            transition: 'opacity 150ms',
          }}
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
