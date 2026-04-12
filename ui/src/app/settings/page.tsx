'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { Skeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useToast } from '@/components/ToastProvider';
import { useAuth } from '@/components/AuthProvider';
import { api, UsageResponse } from '@/lib/api';

/* ── helpers ─────────────────────────────────────────────── */

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg p-5 ${className}`}
      style={{
        backgroundColor: '#0f1011',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="text-xs font-medium mb-3 uppercase tracking-wider"
      style={{ color: '#62666d' }}
    >
      {children}
    </h3>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <label className="block text-xs mb-1" style={{ color: '#8a8f98' }}>
        {label}
      </label>
      <div
        className="rounded-md px-3 py-2 text-sm select-all"
        style={{
          backgroundColor: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          color: '#d0d6e0',
        }}
      >
        {value || '—'}
      </div>
    </div>
  );
}

function ProgressBar({ label, value, max }: { label: string; value: number; max: number }) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-xs mb-1" style={{ color: '#8a8f98' }}>
        <span>{label}</span>
        <span>
          {fmt(value)} / {fmt(max)}
        </span>
      </div>
      <div className="h-2 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-2 rounded-full transition-all"
          style={{
            width: `${ratio * 100}%`,
            backgroundColor: ratio >= 0.9 ? '#ef4444' : '#7170ff',
          }}
        />
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg p-4 text-sm text-red-400"
      style={{
        backgroundColor: 'rgba(239,68,68,0.1)',
        border: '1px solid rgba(239,68,68,0.2)',
      }}
    >
      {message}
    </div>
  );
}

/* ── main component ──────────────────────────────────────── */

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();

  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';

  useEffect(() => {
    let cancelled = false;
    setUsageLoading(true);
    setUsageError(null);
    api.observability
      .usage()
      .then((res) => {
        if (!cancelled) {
          setUsage(res);
          setUsageLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setUsageError(err instanceof Error ? err.message : 'Failed to load usage data');
          setUsageLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('API endpoint copied to clipboard', 'success');
    } catch {
      showToast('Failed to copy — please select and copy manually', 'error');
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.push('/auth/login');
    } catch {
      setSigningOut(false);
    }
  };

  const plan = usage?.usage;

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title="Settings" />
      <div className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-6">
        <ErrorBoundary section="Settings">

          {/* ── Profile ─────────────────────────────────────── */}
          <section aria-label="Profile">
            <SectionTitle>Profile</SectionTitle>
            <Panel>
              <ReadOnlyField label="Email" value={user?.email ?? ''} />
              <ReadOnlyField label="Tenant ID" value={user?.tenantId ?? ''} />
            </Panel>
          </section>

          {/* ── Plan ────────────────────────────────────────── */}
          <section aria-label="Plan" className="mt-6">
            <SectionTitle>Plan</SectionTitle>
            {usageLoading ? (
              <Skeleton variant="card" count={1} />
            ) : usageError ? (
              <ErrorBox message={usageError} />
            ) : plan ? (
              <Panel>
                <ReadOnlyField label="Plan" value={plan.plan} />
                <ReadOnlyField
                  label="Max workspaces"
                  value={String(plan.plan_limits.workspaces)}
                />
                <ReadOnlyField
                  label="Documents per month"
                  value={fmt(plan.plan_limits.docs_per_month)}
                />
              </Panel>
            ) : null}
          </section>

          {/* ── Usage ───────────────────────────────────────── */}
          <section aria-label="Usage" className="mt-6">
            <SectionTitle>Usage</SectionTitle>
            {usageLoading ? (
              <Skeleton variant="card" count={1} />
            ) : usageError ? (
              <ErrorBox message={usageError} />
            ) : plan ? (
              <Panel>
                <ProgressBar
                  label="Documents processed"
                  value={plan.total_documents_processed}
                  max={plan.plan_limits.docs_per_month}
                />
                <ProgressBar
                  label="Workspaces"
                  value={plan.workspace_count}
                  max={plan.plan_limits.workspaces}
                />
              </Panel>
            ) : null}
          </section>

          {/* T3-08: Developer Access section — API endpoint with auth requirements note */}
          <section aria-label="Developer Access" className="mt-6">
            <SectionTitle>Developer Access</SectionTitle>
            <Panel>
              <label className="block text-xs mb-1" style={{ color: '#8a8f98' }}>
                API Endpoint
              </label>
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="flex-1 rounded-md px-3 py-2 text-sm select-all truncate font-mono"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    color: '#d0d6e0',
                  }}
                >
                  {apiUrl || '—'}
                </div>
                <button
                  onClick={handleCopy}
                  className="shrink-0 rounded-md px-3 py-2 text-sm transition-colors"
                  style={{
                    backgroundColor: copied ? 'rgba(39,166,68,0.15)' : 'rgba(255,255,255,0.06)',
                    color: copied ? '#27a644' : '#d0d6e0',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {/* T3-08: Auth requirements note */}
              <div
                className="rounded-md px-3 py-2 text-xs"
                style={{
                  backgroundColor: 'rgba(113,112,255,0.06)',
                  border: '1px solid rgba(113,112,255,0.15)',
                  color: '#9ca3af',
                }}
              >
                <span style={{ color: '#7170ff', fontWeight: 500 }}>Authentication required.</span>{' '}
                All API requests must include an{' '}
                <code style={{ color: '#c2ef4e', backgroundColor: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 3 }}>
                  Authorization: Bearer &lt;Cognito ID token&gt;
                </code>{' '}
                header and optionally{' '}
                <code style={{ color: '#c2ef4e', backgroundColor: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 3 }}>
                  X-User-Email
                </code>{' '}
                for audit trail. Tokens expire after 1 hour — use Cognito Refresh Token to obtain a new ID token.
              </div>
            </Panel>
          </section>

          {/* ── Sign out ────────────────────────────────────── */}
          <section aria-label="Account" className="mt-6">
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full rounded-lg px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.2)',
                color: '#ef4444',
              }}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </section>

        </ErrorBoundary>
      </div>
    </div>
  );
}
