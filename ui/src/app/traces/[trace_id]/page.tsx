'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { api, Trace, FieldResult, ValidationError } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  pending: '#62666d',
  processing: '#f59e0b',
  completed: '#27a644',
  failed: '#ef4444',
  hitl_required: '#7170ff',
};

// Canonical pipeline step definitions
const PIPELINE_STEPS: { key: string; label: string }[] = [
  { key: 's3_download', label: 'Download' },
  { key: 'docling', label: 'Parse' },
  { key: 'llm_reasoning', label: 'Reason' },
  { key: 'reconciliation', label: 'Reconcile' },
];

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? '#27a644' : value >= 0.5 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full h-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono w-8 text-right" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

function FieldRow({ field }: { field: FieldResult }) {
  return (
    <div
      className="px-4 py-3 rounded-lg"
      style={{
        backgroundColor: field.conflict ? 'rgba(113,112,255,0.05)' : '#0f1011',
        border: `1px solid ${field.conflict ? 'rgba(113,112,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: '#d0d6e0' }}>{field.field}</span>
        {field.conflict && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(113,112,255,0.15)', color: '#7170ff' }}>
            conflict
          </span>
        )}
      </div>
      <ConfidenceBar value={field.confidence} />
      <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="mb-0.5" style={{ color: '#62666d' }}>Docling</div>
          <div className="font-mono truncate" style={{ color: '#8a8f98' }}>
            {field.docling_value !== null && field.docling_value !== undefined
              ? String(field.docling_value)
              : '—'}
          </div>
        </div>
        <div>
          <div className="mb-0.5" style={{ color: '#62666d' }}>LLM</div>
          <div className="font-mono truncate" style={{ color: '#8a8f98' }}>
            {field.llm_value !== null && field.llm_value !== undefined
              ? String(field.llm_value)
              : '—'}
          </div>
        </div>
        <div>
          <div className="mb-0.5" style={{ color: '#62666d' }}>Final</div>
          <div className="font-mono truncate font-medium" style={{ color: '#d0d6e0' }}>
            {field.final_value !== null && field.final_value !== undefined
              ? String(field.final_value)
              : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentPipeline({ trace }: { trace: Trace }) {
  const completedSteps = new Set(trace.agent_steps ?? []);
  const isProcessing = trace.status === 'processing' || trace.status === 'pending';
  const isFailed = trace.status === 'failed' || completedSteps.has('error');
  const isHitl = trace.status === 'hitl_required' || completedSteps.has('hitl_flagged');

  // Determine the last completed canonical step index for progress tracking
  let lastCompletedIdx = -1;
  for (let i = PIPELINE_STEPS.length - 1; i >= 0; i--) {
    if (completedSteps.has(PIPELINE_STEPS[i].key)) {
      lastCompletedIdx = i;
      break;
    }
  }

  return (
    <div className="mb-8">
      <h3 className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: '#62666d' }}>
        Agent pipeline
      </h3>
      <div className="flex items-start gap-0">
        {PIPELINE_STEPS.map((step, i) => {
          const done = completedSteps.has(step.key);
          const isNext = !done && isProcessing && i === lastCompletedIdx + 1;
          const skipped = !done && !isNext && i <= lastCompletedIdx;

          const dotColor = done ? '#27a644'
            : isNext ? '#f59e0b'
            : isFailed && i === lastCompletedIdx + 1 ? '#ef4444'
            : '#28282c';

          const lineColor = done && i < PIPELINE_STEPS.length - 1
            ? (completedSteps.has(PIPELINE_STEPS[i + 1]?.key) ? '#27a644' : 'rgba(255,255,255,0.08)')
            : 'rgba(255,255,255,0.08)';

          const textColor = done ? '#27a644'
            : isNext ? '#f59e0b'
            : isFailed && i === lastCompletedIdx + 1 ? '#ef4444'
            : '#62666d';

          return (
            <div key={step.key} className="flex items-start">
              <div className="flex flex-col items-center">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${isNext ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: dotColor }}
                />
                <span
                  className="text-center whitespace-nowrap mt-1"
                  style={{ color: textColor, fontSize: '10px' }}
                >
                  {done ? '✓ ' : skipped ? '' : ''}{step.label}
                </span>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div
                  className="mt-1 mx-1"
                  style={{ width: '32px', height: '1px', backgroundColor: lineColor, marginTop: '5px' }}
                />
              )}
            </div>
          );
        })}

        {/* Terminal node: HITL or Completed */}
        {(isHitl || trace.status === 'completed') && (
          <>
            <div
              className="mt-1 mx-1"
              style={{ width: '32px', height: '1px', backgroundColor: isHitl ? '#7170ff' : '#27a644', marginTop: '5px' }}
            />
            <div className="flex flex-col items-center">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: isHitl ? '#7170ff' : '#27a644' }}
              />
              <span
                className="text-center whitespace-nowrap mt-1"
                style={{ color: isHitl ? '#7170ff' : '#27a644', fontSize: '10px' }}
              >
                {isHitl ? 'HITL review' : '✓ Done'}
              </span>
            </div>
          </>
        )}

        {/* Failed terminal */}
        {isFailed && (
          <>
            <div
              className="mt-1 mx-1"
              style={{ width: '32px', height: '1px', backgroundColor: '#ef4444', marginTop: '5px' }}
            />
            <div className="flex flex-col items-center">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />
              <span className="text-center whitespace-nowrap mt-1" style={{ color: '#ef4444', fontSize: '10px' }}>
                Error
              </span>
            </div>
          </>
        )}
      </div>

      {/* Step list with timestamps if available */}
      {trace.agent_steps && trace.agent_steps.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {trace.agent_steps.map((step) => (
            <span
              key={step}
              className="text-xs px-2 py-0.5 rounded font-mono"
              style={{
                backgroundColor: step === 'error' ? 'rgba(239,68,68,0.1)'
                  : step === 'hitl_flagged' ? 'rgba(113,112,255,0.1)'
                  : 'rgba(39,166,68,0.08)',
                color: step === 'error' ? '#ef4444'
                  : step === 'hitl_flagged' ? '#7170ff'
                  : '#27a644',
                border: `1px solid ${step === 'error' ? 'rgba(239,68,68,0.2)'
                  : step === 'hitl_flagged' ? 'rgba(113,112,255,0.2)'
                  : 'rgba(39,166,68,0.15)'}`,
              }}
            >
              {step}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TraceDetailPage() {
  const { trace_id } = useParams<{ trace_id: string }>();
  const router = useRouter();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.traces.get(trace_id)
      .then(setTrace)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load trace'))
      .finally(() => setLoading(false));
  }, [trace_id]);

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
        <Header title="Trace" />
        <div className="p-6 text-sm" style={{ color: '#62666d' }}>Loading…</div>
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
        <Header title="Trace" />
        <div className="p-6 text-sm" style={{ color: '#ef4444' }}>{error ?? 'Trace not found'}</div>
      </div>
    );
  }

  const confidence = trace.confidence ? parseFloat(trace.confidence) : null;
  const statusColor = STATUS_COLORS[trace.status] ?? '#62666d';
  const conflicts = trace.fields?.filter((f) => f.conflict).length ?? 0;
  const hasAgentSteps = trace.agent_steps && trace.agent_steps.length > 0;

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title={`Trace · ${trace.trace_id.slice(0, 8)}`} />
      <div className="flex-1 p-6 max-w-5xl mx-auto w-full">
        <ErrorBoundary section="Trace Detail">

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          {[
            {
              label: 'Status',
              value: trace.status.replace('_', ' '),
              color: statusColor,
            },
            {
              label: 'Confidence',
              value: confidence !== null ? `${(confidence * 100).toFixed(1)}%` : '—',
              color: confidence !== null ? (confidence >= 0.8 ? '#27a644' : confidence >= 0.5 ? '#f59e0b' : '#ef4444') : '#62666d',
            },
            {
              label: 'Tokens',
              value: trace.tokens ? String(trace.tokens) : '—',
              color: '#d0d6e0',
            },
            {
              label: 'Latency',
              value: trace.latency ? `${parseFloat(trace.latency).toFixed(0)}ms` : '—',
              color: '#d0d6e0',
            },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded-lg p-4"
              style={{ backgroundColor: '#0f1011', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="text-xs mb-1.5" style={{ color: '#62666d' }}>{label}</div>
              <div className="text-lg font-semibold" style={{ color, letterSpacing: '-0.02em' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Agent pipeline — shown when agent_steps is populated */}
        {hasAgentSteps && <AgentPipeline trace={trace} />}

        {/* Validation errors */}
        {trace.validation_errors && trace.validation_errors.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: '#62666d' }}>
              Validation errors
            </h3>
            <div className="space-y-1.5">
              {trace.validation_errors.map((ve: ValidationError, i: number) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2 rounded text-xs"
                  style={{ backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}
                >
                  <span className="font-mono" style={{ color: '#ef4444' }}>{ve.field}</span>
                  <span style={{ color: '#8a8f98' }}>{ve.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {trace.error && (
          <div className="mb-6 px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
            {trace.error}
          </div>
        )}

        {/* Fields */}
        {trace.fields && trace.fields.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: '#62666d' }}>
                Extracted fields ({trace.fields.length})
              </h3>
              {conflicts > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(113,112,255,0.1)', color: '#7170ff' }}>
                  {conflicts} conflict{conflicts > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {trace.fields.map((field) => (
                <FieldRow key={field.field} field={field} />
              ))}
            </div>
          </div>
        )}

        {/* HITL banner */}
        {trace.status === 'hitl_required' && (
          <div
            className="mt-6 px-4 py-4 rounded-lg flex items-center justify-between gap-4"
            style={{ backgroundColor: 'rgba(113,112,255,0.08)', border: '1px solid rgba(113,112,255,0.2)' }}
          >
            <div>
              <div className="text-sm font-medium mb-1" style={{ color: '#7170ff' }}>
                Human review required
              </div>
              <div className="text-xs" style={{ color: '#8a8f98' }}>
                Confidence is below the workspace threshold. Open the review queue to assign and correct this trace.
              </div>
            </div>
            <button
              onClick={() => router.push(`/hitl/${trace_id}`)}
              className="shrink-0 text-xs font-medium px-3 py-1.5 rounded"
              style={{ backgroundColor: '#7170ff', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Open review →
            </button>
          </div>
        )}

        </ErrorBoundary>
      </div>
    </div>
  );
}
