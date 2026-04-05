'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '⬡' },
  { href: '/workspaces', label: 'Workspaces', icon: '⊞' },
  { href: '/traces', label: 'Traces', icon: '⋯' },
  { href: '/hitl', label: 'HITL Review', icon: '◎' },
  { href: '/chat', label: 'Chat', icon: '◻' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed top-0 left-0 h-full flex flex-col"
      style={{
        width: 'var(--sidebar-width)',
        backgroundColor: '#0f1011',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        zIndex: 40,
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div
          className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold"
          style={{ backgroundColor: '#5e6ad2', color: '#fff' }}
        >
          D
        </div>
        <span className="text-sm font-medium" style={{ color: '#f7f8f8', letterSpacing: '-0.01em' }}>
          DocOps
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors mb-0.5"
              style={{
                color: isActive ? '#f7f8f8' : '#8a8f98',
                backgroundColor: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                fontWeight: isActive ? 510 : 400,
              }}
            >
              <span className="text-xs opacity-70">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t text-xs" style={{ borderColor: 'rgba(255,255,255,0.06)', color: '#62666d' }}>
        Phase 1 · Foundation
      </div>
    </aside>
  );
}
