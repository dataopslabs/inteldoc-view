'use client';

import { signOut } from 'aws-amplify/auth';
import { useRouter } from 'next/navigation';

interface HeaderProps {
  title: string;
}

export default function Header({ title }: HeaderProps) {
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push('/');
  }

  return (
    <header
      className="sticky top-0 flex items-center justify-between px-6 py-3 z-30"
      style={{
        backgroundColor: 'rgba(8,9,10,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <h1 className="text-sm font-medium" style={{ color: '#f7f8f8', letterSpacing: '-0.01em' }}>
        {title}
      </h1>
      <button
        onClick={handleSignOut}
        className="text-xs px-3 py-1.5 rounded transition-colors"
        style={{
          color: '#8a8f98',
          backgroundColor: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        Sign out
      </button>
    </header>
  );
}
