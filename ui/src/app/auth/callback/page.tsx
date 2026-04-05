'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // Amplify handles the OAuth code exchange automatically via Hub events.
    // Redirect to dashboard after a short delay to allow token processing.
    const timer = setTimeout(() => router.replace('/dashboard'), 1500);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <div className="text-center">
        <div className="text-sm mb-2" style={{ color: '#d0d6e0' }}>Signing you in…</div>
        <div className="text-xs" style={{ color: '#62666d' }}>Redirecting to dashboard</div>
      </div>
    </div>
  );
}
