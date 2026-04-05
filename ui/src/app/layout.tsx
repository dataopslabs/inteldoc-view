import type { Metadata } from 'next';
import './globals.css';
import { configureAmplify } from '@/lib/amplify';
import Sidebar from '@/components/Sidebar';

configureAmplify();

export const metadata: Metadata = {
  title: 'DocOps',
  description: 'Agentic Document Intelligence Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Sidebar />
        <main style={{ marginLeft: 'var(--sidebar-width)', minHeight: '100vh' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
