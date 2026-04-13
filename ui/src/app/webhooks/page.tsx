'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Header from '@/components/Header';
import { Skeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useToast } from '@/components/ToastProvider';
import { api, WebhookRegistration, WebhookEvent } from '@/lib/api';

// ── Constants ───────────────────────────────────────────────────────────────

const ALL_EVENTS: { value: WebhookEvent; label: string; description: string }[] = [
  { value: 'trace.completed', label: 'Trace Completed', description: 'Fired when document processing finishes successfully' },
  { value: 'trace.failed', label: 'Trace Failed', description: 'Fired when document processing encounters an error' },
  { value: 'trace.hitl_required', label: 'HITL Required', description: 'Fired when human-in-the-loop review is needed' },
  { value: '*', label: 'All Events', description: 'Subscribe to every event (wildcard)' },
];

// ── Sub-components ──────────────────────────────────────────────────────────

function EventBadge({ event }: { event: string }) {
  const color =
    event === 'trace.completed'
      ? { bg: '#052e16', text: '#4ade80' }
      : event === 'trace.failed'
      ? { bg: '#450a0a', text: '#f87171' }
      : event === 'trace.hitl_required'
      ? { bg: '#1c1a01', text: '#fcd34d' }
      : { bg: '#0d0d2a', text: '#818cf8' };

  return (
    <span
      style={{
        background: color.bg,
        color: color.text,
        fontSize: '0.7rem',
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: '9999px',
        letterSpacing: '0.03em',
      }}
    >
      {event}
    </span>
  );
}

function WebhookRow({
  webhook,
  onDelete,
  deleting,
}: {
  webhook: WebhookRegistration;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      style={{
        background: '#0f1011',
        border: '1px solid #1f2022',
        borderRadius: '10px',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <code
              style={{
                color: '#e5e7eb',
                fontSize: '0.875rem',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
              }}
            >
              {webhook.url}
            </code>
            <span
              style={{
                background: webhook.active ? '#052e16' : '#1f2022',
                color: webhook.active ? '#4ade80' : '#6b7280',
                fontSize: '0.65rem',
                fontWeight: 700,
                padding: '1px 7px',
                borderRadius: '9999px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                flexShrink: 0,
              }}
            >
              {webhook.active ? 'Active' : 'Inactive'}
            </span>
          </div>
          {webhook.description && (
            <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
              {webhook.description}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
          {confirmDelete ? (
            <>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{
                  padding: '0.375rem 0.75rem',
                  background: 'transparent',
                  border: '1px solid #4b5563',
                  borderRadius: '6px',
                  color: '#9ca3af',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => onDelete(webhook.webhook_id)}
                disabled={deleting}
                style={{
                  padding: '0.375rem 0.75rem',
                  background: '#7f1d1d',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fca5a5',
                  fontSize: '0.8rem',
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{
                padding: '0.375rem 0.75rem',
                background: 'transparent',
                border: '1px solid #7f1d1d',
                borderRadius: '6px',
                color: '#f87171',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
        {webhook.events.map((e) => (
          <EventBadge key={e} event={e} />
        ))}
      </div>

      <p style={{ color: '#4b5563', fontSize: '0.75rem', margin: 0 }}>
        ID: {webhook.webhook_id} &nbsp;·&nbsp; Created:{' '}
        {new Date(webhook.created_at).toLocaleString()}
      </p>
    </div>
  );
}

// ── Signing Secret Modal ────────────────────────────────────────────────────

function SigningSecretModal({
  secret,
  onClose,
}: {
  secret: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      if (copyRef.current) clearTimeout(copyRef.current);
      copyRef.current = setTimeout(() => setCopied(false), 2500);
    });
  };

  useEffect(() => {
    return () => {
      if (copyRef.current) clearTimeout(copyRef.current);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        style={{
          background: '#0f1011',
          border: '1px solid #7170ff',
          borderRadius: '12px',
          padding: '2rem',
          width: '100%',
          maxWidth: '520px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ color: '#f9fafb', margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>
            Webhook Signing Secret
          </h2>
        </div>
        <div
          style={{
            background: '#1a1a00',
            border: '1px solid #78350f',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            marginBottom: '1.25rem',
            fontSize: '0.825rem',
            color: '#fcd34d',
            lineHeight: 1.5,
          }}
        >
          This secret will only be shown once. Store it securely — you cannot retrieve it again. Use it to verify webhook signatures from your server.
        </div>
        <div
          style={{
            background: '#08090a',
            border: '1px solid #2d2d2d',
            borderRadius: '8px',
            padding: '0.875rem 1rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <code
            style={{
              flex: 1,
              color: '#a5f3fc',
              fontSize: '0.8rem',
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {secret}
          </code>
          <button
            onClick={handleCopy}
            style={{
              flexShrink: 0,
              padding: '0.375rem 0.875rem',
              background: copied ? '#052e16' : '#7170ff',
              border: 'none',
              borderRadius: '6px',
              color: copied ? '#4ade80' : '#fff',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.2s, color 0.2s',
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1.5rem',
              background: '#7170ff',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            I&apos;ve saved the secret
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Register Form ───────────────────────────────────────────────────────────

function RegisterForm({ onRegistered }: { onRegistered: (webhook: WebhookRegistration) => void }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<WebhookEvent>>(new Set<WebhookEvent>(['trace.completed']));
  const [submitting, setSubmitting] = useState(false);
  const [urlError, setUrlError] = useState('');

  const toggleEvent = (event: WebhookEvent) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) {
        next.delete(event);
      } else {
        // If selecting '*', clear others; if selecting specific, clear '*'
        if (event === '*') {
          next.clear();
        } else {
          next.delete('*');
        }
        next.add(event);
      }
      return next;
    });
  };

  const validateUrl = (val: string): boolean => {
    try {
      const u = new URL(val);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUrlError('');

    if (!validateUrl(url)) {
      setUrlError('Please enter a valid URL (must start with http:// or https://)');
      return;
    }
    if (selectedEvents.size === 0) {
      showToast('Select at least one event to subscribe to.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.webhooks.register({
        url: url.trim(),
        events: Array.from(selectedEvents),
        description: description.trim() || undefined,
      });
      onRegistered(result);
      // Reset form
      setUrl('');
      setDescription('');
      setSelectedEvents(new Set<WebhookEvent>(['trace.completed']));
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to register webhook';
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '0.625rem 1.25rem',
          background: '#7170ff',
          border: 'none',
          borderRadius: '8px',
          color: '#fff',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>+</span>
        Register Webhook
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      style={{
        background: '#0f1011',
        border: '1px solid #2d2d2d',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h3 style={{ color: '#f9fafb', margin: 0, fontSize: '1rem', fontWeight: 700 }}>Register New Webhook</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1.2rem' }}
        >
          ✕
        </button>
      </div>

      {/* URL */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', color: '#9ca3af', fontSize: '0.825rem', marginBottom: '0.375rem', fontWeight: 500 }}>
          Endpoint URL *
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setUrlError(''); }}
          placeholder="https://your-server.com/webhook"
          required
          style={{
            width: '100%',
            padding: '0.625rem 0.875rem',
            background: '#08090a',
            border: urlError ? '1px solid #f87171' : '1px solid #2d2d2d',
            borderRadius: '8px',
            color: '#f9fafb',
            fontSize: '0.875rem',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {urlError && <p style={{ color: '#f87171', fontSize: '0.775rem', margin: '0.25rem 0 0' }}>{urlError}</p>}
      </div>

      {/* Description */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={{ display: 'block', color: '#9ca3af', fontSize: '0.825rem', marginBottom: '0.375rem', fontWeight: 500 }}>
          Description (optional)
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Production notification handler"
          style={{
            width: '100%',
            padding: '0.625rem 0.875rem',
            background: '#08090a',
            border: '1px solid #2d2d2d',
            borderRadius: '8px',
            color: '#f9fafb',
            fontSize: '0.875rem',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Events */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', color: '#9ca3af', fontSize: '0.825rem', marginBottom: '0.625rem', fontWeight: 500 }}>
          Events to Subscribe *
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {ALL_EVENTS.map((ev) => (
            <label
              key={ev.value}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.75rem',
                background: selectedEvents.has(ev.value) ? '#0d0d2a' : '#08090a',
                border: `1px solid ${selectedEvents.has(ev.value) ? '#7170ff55' : '#1f2022'}`,
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'background 0.15s, border-color 0.15s',
              }}
            >
              <input
                type="checkbox"
                checked={selectedEvents.has(ev.value)}
                onChange={() => toggleEvent(ev.value)}
                style={{ marginTop: '2px', accentColor: '#7170ff', flexShrink: 0 }}
              />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.125rem' }}>
                  <span style={{ color: '#e5e7eb', fontSize: '0.875rem', fontWeight: 600 }}>{ev.label}</span>
                  <EventBadge event={ev.value} />
                </div>
                <p style={{ color: '#6b7280', fontSize: '0.775rem', margin: 0 }}>{ev.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => setOpen(false)}
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
          type="submit"
          disabled={submitting}
          style={{
            padding: '0.5rem 1.5rem',
            background: '#7170ff',
            border: 'none',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? 'Registering...' : 'Register Webhook'}
        </button>
      </div>
    </form>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

function WebhooksContent() {
  const { showToast } = useToast();

  const [webhooks, setWebhooks] = useState<WebhookRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const fetchWebhooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.webhooks.list();
      setWebhooks(data.webhooks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load webhooks';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchWebhooks();
  }, [fetchWebhooks]);

  const handleRegistered = (webhook: WebhookRegistration) => {
    setWebhooks((prev) => [webhook, ...prev]);
    if (webhook.signing_secret) {
      setNewSecret(webhook.signing_secret);
    } else {
      showToast('Webhook registered successfully.', 'success');
    }
  };

  const handleDelete = async (webhookId: string) => {
    setDeletingId(webhookId);
    try {
      await api.webhooks.delete(webhookId);
      setWebhooks((prev) => prev.filter((w) => w.webhook_id !== webhookId));
      showToast('Webhook deleted.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete webhook';
      showToast(msg, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={{ height: '100px', borderRadius: '10px' }} />
        ))}
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
          onClick={() => void fetchWebhooks()}
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

  return (
    <>
      <RegisterForm onRegistered={handleRegistered} />

      {webhooks.length === 0 ? (
        <div
          style={{
            background: '#0f1011',
            border: '1px dashed #2d2d2d',
            borderRadius: '12px',
            padding: '3rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🔗</div>
          <p style={{ color: '#6b7280', margin: 0, fontSize: '0.9rem' }}>
            No webhooks registered yet. Register one above to receive real-time notifications.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {webhooks.map((webhook) => (
            <WebhookRow
              key={webhook.webhook_id}
              webhook={webhook}
              onDelete={(id) => void handleDelete(id)}
              deleting={deletingId === webhook.webhook_id}
            />
          ))}
        </div>
      )}

      {newSecret && (
        <SigningSecretModal
          secret={newSecret}
          onClose={() => {
            setNewSecret(null);
            showToast('Webhook registered. Remember to save the signing secret!', 'success');
          }}
        />
      )}
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function WebhooksPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#08090a',
        color: '#f9fafb',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <Header title="Webhooks" />
      <main
        style={{
          maxWidth: '900px',
          margin: '0 auto',
          padding: '2rem 1.5rem',
        }}
      >
        <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f9fafb', margin: '0 0 0.375rem' }}>
              Webhook Integrations
            </h1>
            <p style={{ color: '#6b7280', fontSize: '0.9rem', margin: 0 }}>
              Register endpoints to receive real-time notifications for document processing events.
            </p>
          </div>
        </div>

        {/* Info panel */}
        <div
          style={{
            background: '#0d0d1a',
            border: '1px solid #3730a355',
            borderRadius: '10px',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            fontSize: '0.825rem',
            color: '#a5b4fc',
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: '#818cf8' }}>Webhook Security:</strong> Each webhook has a unique signing secret used to sign payloads with HMAC-SHA256. Verify the{' '}
          <code style={{ fontFamily: 'monospace', background: '#1e1b4b44', padding: '0 4px', borderRadius: '3px' }}>X-Webhook-Signature</code>{' '}
          header on your server to ensure authenticity. The secret is only shown once at registration time.
        </div>

        <ErrorBoundary>
          <WebhooksContent />
        </ErrorBoundary>
      </main>
    </div>
  );
}
