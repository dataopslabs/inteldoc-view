import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import { AuthProvider } from '@/components/AuthProvider';
import { AuthGuard } from '@/components/AuthGuard';
import { ToastProvider } from '@/components/ToastProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const metadata: Metadata = {
  title: 'DocOps',
  description: 'Agentic Document Intelligence Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* T2-02: ToastProvider wraps entire app — useToast() available everywhere */}
        <ToastProvider>
          <AuthProvider>
            <AuthGuard>
              <Sidebar />
              <main style={{ marginLeft: 'var(--sidebar-width)', minHeight: '100vh' }}>
                {/* T2-06: Top-level ErrorBoundary catches render errors in all pages */}
                <ErrorBoundary section="Application">
                  {children}
                </ErrorBoundary>
              </main>
            </AuthGuard>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
