'use client';

import { useCallback, useEffect, useState } from 'react';
import Header from '@/components/Header';
import { Skeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useToast } from '@/components/ToastProvider';
import { useAuth } from '@/components/AuthProvider';
import { api, BillingPlan, PlanChangeResponse } from '@/lib/api';

// ── Plan definitions ────────────────────────────────────────────────────────

interface PlanDef {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  highlight?: boolean;
}

const PLANS: PlanDef[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '/month',
    description: 'For individuals and small projects',
    features: [
      '1 workspace',
      '50 documents/month',
      '100K tokens/month',
      '50 chats/month',
      'Community support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$49',
    period: '/month',
    description: 'For professionals and growing teams',
    features: [
      '10 workspaces',
      '1,000 documents/month',
      '5M tokens/month',
      '1,000 chats/month',
      'Priority email support',
      'Webhook integrations',
      'Usage analytics',
    ],
    highlight: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For large organizations',
    features: [
      'Unlimited workspaces',
      'Unlimited documents',
      'Unlimited tokens',
      'Unlimited chats',
      'Dedicated support',
      'SLA guarantee',
      'Custom integrations',
      'SSO / SAML',
    ],
  },
];

// ── Sub-components ──────────────────────────────────────────────────────────

function UsageBar({
  label,
  used,
  limit,
  unit = '',
}: {
  label: string;
  used: number;
  limit: number;
  unit?: string;
}) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color =
    pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#7170ff';

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '0.375rem',
        }}
      >
        <span style={{ fontSize: '0.875rem', color: '#9ca3af' }}>{label}</span>
        <span style={{ fontSize: '0.875rem', color: '#e5e7eb' }}>
          {used.toLocaleString()}
          {unit} / {limit > 0 ? `${limit.toLocaleString()}${unit}` : '∞'}
        </span>
      </div>
      <div
        style={{
          height: '6px',
          background: '#1f2022',
          borderRadius: '9999px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: '9999px',
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  currentPlan,
  onSelect,
  loading,
}: {
  plan: PlanDef;
  currentPlan: string;
  onSelect: (planId: string) => void;
  loading: boolean;
}) {
  const isCurrent = plan.id === currentPlan;
  const isEnterprise = plan.id === 'enterprise';

  return (
    <div
      style={{
        background: plan.highlight ? '#0d0d1a' : '#0f1011',
        border: plan.highlight
          ? '1px solid #7170ff'
          : isCurrent
          ? '1px solid #4b5563'
          : '1px solid #1f2022',
        borderRadius: '12px',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        flex: '1 1 280px',
        minWidth: '250px',
        position: 'relative',
      }}
    >
      {plan.highlight && (
        <div
          style={{
            position: 'absolute',
            top: '-12px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#7170ff',
            color: '#fff',
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.05em',
            padding: '2px 12px',
            borderRadius: '9999px',
            textTransform: 'uppercase',
          }}
        >
          Popular
        </div>
      )}
      <div>
        <h3
          style={{
            fontSize: '1.125rem',
            fontWeight: 700,
            color: '#f9fafb',
            margin: 0,
          }}
        >
          {plan.name}
        </h3>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          {plan.description}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
        <span style={{ fontSize: '2rem', fontWeight: 800, color: '#f9fafb' }}>
          {plan.price}
        </span>
        {plan.period && (
          <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>{plan.period}</span>
        )}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {plan.features.map((f) => (
          <li
            key={f}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: '#d1d5db' }}
          >
            <span style={{ color: '#7170ff', fontWeight: 700 }}>✓</span>
            {f}
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 'auto' }}>
        {isCurrent ? (
          <div
            style={{
              textAlign: 'center',
              padding: '0.625rem',
              background: '#1f2022',
              borderRadius: '8px',
              color: '#9ca3af',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            Current Plan
          </div>
        ) : isEnterprise ? (
          <a
            href="mailto:sales@example.com"
            style={{
              display: 'block',
              textAlign: 'center',
              padding: '0.625rem',
              background: 'transparent',
              border: '1px solid #7170ff',
              borderRadius: '8px',
              color: '#7170ff',
              fontSize: '0.875rem',
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            Contact Sales
          </a>
        ) : (
          <button
            onClick={() => onSelect(plan.id)}
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.625rem',
              background: plan.highlight ? '#7170ff' : 'transparent',
              border: plan.highlight ? 'none' : '1px solid #7170ff',
              borderRadius: '8px',
              color: plan.highlight ? '#fff' : '#7170ff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            {loading ? 'Updating...' : currentPlan === 'free' && plan.id !== 'free' ? 'Upgrade' : 'Downgrade'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Confirm Dialog ──────────────────────────────────────────────────────────

function ConfirmDialog({
  targetPlan,
  currentPlan,
  onConfirm,
  onCancel,
  loading,
}: {
  targetPlan: string;
  currentPlan: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const isUpgrade = PLANS.findIndex(p => p.id === targetPlan) > PLANS.findIndex(p => p.id === currentPlan);
  const planDef = PLANS.find(p => p.id === targetPlan);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0f1011',
          border: '1px solid #2d2d2d',
          borderRadius: '12px',
          padding: '2rem',
          width: '100%',
          maxWidth: '440px',
        }}
      >
        <h2 style={{ color: '#f9fafb', margin: '0 0 0.75rem', fontSize: '1.25rem', fontWeight: 700 }}>
          {isUpgrade ? 'Upgrade' : 'Downgrade'} to {planDef?.name}?
        </h2>
        <p style={{ color: '#9ca3af', margin: '0 0 1.5rem', fontSize: '0.9rem', lineHeight: 1.5 }}>
          {isUpgrade
            ? `You will be immediately upgraded to the ${planDef?.name} plan. Billing will be prorated.`
            : `You will be downgraded to ${planDef?.name} at the end of your current billing period. Features beyond the ${planDef?.name} limits will become unavailable.`}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '0.5rem 1.25rem',
              background: 'transparent',
              border: '1px solid #4b5563',
              borderRadius: '8px',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: '0.5rem 1.25rem',
              background: '#7170ff',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Updating...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

function BillingContent() {
  const { showToast } = useToast();
  const { user } = useAuth();

  const [billingData, setBillingData] = useState<BillingPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changingPlan, setChangingPlan] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  const fetchPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.billing.getPlan();
      setBillingData(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load billing information';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPlan();
  }, [fetchPlan]);

  const handlePlanSelect = (planId: string) => {
    setConfirmTarget(planId);
  };

  const handleConfirmChange = async () => {
    if (!confirmTarget) return;
    setChangingPlan(true);
    try {
      const result: PlanChangeResponse = await api.billing.changePlan(confirmTarget);
      showToast(
        result.upgrade
          ? `Successfully upgraded to ${result.plan}!`
          : `Scheduled downgrade to ${result.plan}${result.downgrade_at ? ` on ${new Date(result.downgrade_at).toLocaleDateString()}` : ''}.`,
        'success'
      );
      await fetchPlan();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to change plan';
      showToast(msg, 'error');
    } finally {
      setChangingPlan(false);
      setConfirmTarget(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <Skeleton style={{ height: '160px', borderRadius: '12px' }} />
        <Skeleton style={{ height: '120px', borderRadius: '12px' }} />
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: '360px', flex: '1 1 280px', minWidth: '250px', borderRadius: '12px' }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          background: '#1a0a0a',
          border: '1px solid #7f1d1d',
          borderRadius: '12px',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <p style={{ color: '#f87171', margin: '0 0 1rem' }}>{error}</p>
        <button
          onClick={() => void fetchPlan()}
          style={{
            padding: '0.5rem 1.25rem',
            background: '#7170ff',
            border: 'none',
            borderRadius: '8px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!billingData) return null;

  const { plan, billing_period, limits, usage, grace_period } = billingData;

  return (
    <>
      {/* Current Plan Summary */}
      <div
        style={{
          background: '#0f1011',
          border: '1px solid #2d2d2d',
          borderRadius: '12px',
          padding: '1.5rem',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#9ca3af', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Current Plan
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f9fafb', textTransform: 'capitalize' }}>
                {plan}
              </span>
              <span
                style={{
                  background: '#7170ff22',
                  color: '#7170ff',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Active
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: 0 }}>Billing Period</p>
            <p style={{ color: '#e5e7eb', fontSize: '0.9rem', margin: '0.125rem 0 0', fontWeight: 500 }}>
              {billing_period}
            </p>
          </div>
        </div>

        {grace_period && (
          <div
            style={{
              background: '#1c1200',
              border: '1px solid #78350f',
              borderRadius: '8px',
              padding: '0.75rem 1rem',
              marginBottom: '1.25rem',
              fontSize: '0.875rem',
              color: '#fcd34d',
            }}
          >
            Scheduled downgrade from <strong>{grace_period.previous_plan}</strong> on{' '}
            {new Date(grace_period.downgrade_at).toLocaleDateString()}. Expires:{' '}
            {new Date(grace_period.expires_at).toLocaleDateString()}.
          </div>
        )}

        <UsageBar label="Documents" used={usage.documents} limit={limits.docs_per_month} />
        <UsageBar label="Tokens" used={usage.tokens} limit={limits.tokens_per_month} />
        <UsageBar label="Chats" used={usage.chats} limit={limits.chats_per_month} />
        <UsageBar label="Workspaces" used={usage.workspaces} limit={limits.workspaces} />
      </div>

      {/* Plan Comparison */}
      <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#f9fafb', margin: '0 0 1rem' }}>
        Available Plans
      </h2>
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          flexWrap: 'wrap',
          alignItems: 'stretch',
        }}
      >
        {PLANS.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            currentPlan={plan}
            onSelect={handlePlanSelect}
            loading={changingPlan}
          />
        ))}
      </div>

      {confirmTarget && (
        <ConfirmDialog
          targetPlan={confirmTarget}
          currentPlan={plan}
          onConfirm={() => void handleConfirmChange()}
          onCancel={() => setConfirmTarget(null)}
          loading={changingPlan}
        />
      )}
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#08090a',
        color: '#f9fafb',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <Header title="Billing" />
      <main
        style={{
          maxWidth: '1100px',
          margin: '0 auto',
          padding: '2rem 1.5rem',
        }}
      >
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f9fafb', margin: '0 0 0.375rem' }}>
            Billing & Plans
          </h1>
          <p style={{ color: '#6b7280', fontSize: '0.9rem', margin: 0 }}>
            Manage your subscription, view usage, and change your plan.
          </p>
        </div>
        <ErrorBoundary>
          <BillingContent />
        </ErrorBoundary>
      </main>
    </div>
  );
}
