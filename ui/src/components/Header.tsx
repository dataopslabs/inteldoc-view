'use client';

import Link from 'next/link';
import { signOut } from 'aws-amplify/auth';
import { useRouter } from 'next/navigation';

interface HeaderProps {
  title: string;
  breadcrumbs?: { label: string; href: string }[];
}

export default function Header({ title, breadcrumbs }: HeaderProps) {
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
      <div className="flex items-center gap-1.5 text-sm" style={{ color: '#f7f8f8', letterSpacing: '-0.01em' }}>
        {breadcrumbs && breadcrumbs.length > 0 ? (
          breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <span key={crumb.href} className="flex items-center gap-1.5">
                {index > 0 && <span style={{ color: '#62666d' }}>/</span>}
                {isLast ? (
                  <span className="font-medium">{crumb.label}</span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="transition-colors hover:underline"
                    style={{ color: '#8a8f98' }}
                  >
                    {crumb.label}
                  </Link>
                )}
              </span>
            );
          })
        ) : (
          <h1 className="font-medium">{title}</h1>
        )}
      </div>
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
