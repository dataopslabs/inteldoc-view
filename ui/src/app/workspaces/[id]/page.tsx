'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { api, Workspace, Trace } from '@/lib/api';
import { DropZone } from '@/components/DropZone';
import { StatusBadge } from '@/components/StatusBadge';
import { ConfidenceIndicator } from '@/components/ConfidenceIndicator';
import { useToast } from '@/components/ToastProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';

type UploadState = 'idle' | 'uploading' | 'submitted' | 'processing';

// T3-01: Max decoded file size — matches server-side limit (50 MB)
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// T2-01: Poll interval when traces are pending/processing
const POLL_INTERVAL_MS = 5000;
// Terminal states — no need to keep polling when all traces reach these
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'hitl_required']);

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  // T4-02: Upload progress percentage
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [ws, tr] = await Promise.all([
        api.workspaces.get(id),
        api.traces.list(id),
      ]);
      setWorkspace(ws);
      setTraces(tr.traces);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  // T2-01: Auto-poll while any trace is in a non-terminal state
  useEffect(() => {
    const hasInFlight = traces.some(t => !TERMINAL_STATUSES.has(t.status));

    if (hasInFlight) {
      pollTimerRef.current = setTimeout(async () => {
        try {
          const tr = await api.traces.list(id);
          setTraces(tr.traces);
        } catch {
          // Silently ignore poll errors — we'll retry next interval
        }
      }, POLL_INTERVAL_MS);
    }

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [traces, id]);

  async function handleFile(file: File) {
    // T3-01: Client-side file size validation — fast feedback before expensive FileReader
    if (file.size > MAX_FILE_BYTES) {
      setError(`File exceeds maximum size of ${MAX_FILE_BYTES / 1024 / 1024}MB. Please choose a smaller file.`);
      return;
    }

    setUploadState('uploading');
    setUploadProgress(0);
    setError(null);

    try {
      const base64 = await readFileAsBase64(file, setUploadProgress);
      setUploadState('submitted');
      setUploadProgress(100);

      const result = await api.process(id, {
        filename: file.name,
        content_base64: base64,
      });

      setUploadState('processing');

      // Optimistically prepend the new trace
      const newTrace: Trace = {
        trace_id: result.trace_id,
        workspace_id: id,
        status: 'pending',
        filename: file.name,
        prompt_version: workspace?.prompt_version ?? '',
        created_at: new Date().toISOString(),
      };
      setTraces((prev) => [newTrace, ...prev]);

      // T2-02: Show success toast
      showToast(`Document "${file.name}" submitted for processing`, 'success');

      // Reset upload state after a short delay
      setTimeout(() => {
        setUploadState('idle');
        setUploadProgress(0);
      }, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setError(msg);
      showToast(msg, 'error');
      setUploadState('idle');
      setUploadProgress(0);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
        <Header title="Workspace" />
        <div className="p-6 text-sm" style={{ color: '#62666d' }}>Loading…</div>
      </div>
    );
  }

  // T4-04: Compute doc count from traces
  const docCount = traces.length;

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title={workspace?.name ?? 'Workspace'} />
      <div className="flex-1 p-6 max-w-5xl mx-auto w-full">

        {/* Workspace meta */}
        {workspace && (
          <div className="mb-6 flex items-center gap-4 flex-wrap">
            <div className="text-xs" style={{ color: '#62666d' }}>
              Prompt <span style={{ color: '#d0d6e0' }}>v{workspace.prompt_version}</span>
            </div>
            <div className="text-xs" style={{ color: '#62666d' }}>
              HITL threshold <span style={{ color: '#d0d6e0' }}>{workspace.hitl_threshold}</span>
            </div>
            {/* T4-04: Show document count */}
            <div className="text-xs" style={{ color: '#62666d' }}>
              Docs <span style={{ color: '#d0d6e0' }}>{docCount}</span>
            </div>
            <div className="text-xs font-mono" style={{ color: '#62666d' }}>
              {workspace.workspace_id.slice(0, 8)}
            </div>
            <button
              onClick={() => router.push(`/workspaces/${id}/settings`)}
              className="ml-auto text-xs px-3 py-1.5 rounded transition-colors"
              style={{ color: '#8a8f98', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              Settings
            </button>
          </div>
        )}

        {/* Upload */}
        <div
          className="mb-8 p-4 rounded-lg"
          style={{ backgroundColor: '#0f1011', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="text-xs font-medium mb-3 uppercase tracking-wider" style={{ color: '#62666d' }}>
            Process document
          </div>

          <DropZone
            onFile={handleFile}
            accept=".pdf,.docx,.png,.jpg"
            disabled={false}
            uploading={uploadState !== 'idle'}
          />

          {/* Upload progress indicator */}
          {uploadState !== 'idle' && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <UploadProgressIndicator state={uploadState} />
              </div>
              {/* T4-02: Show upload percentage while reading file */}
              {uploadState === 'uploading' && uploadProgress > 0 && uploadProgress < 100 && (
                <div>
                  <div className="flex justify-between text-xs mb-1" style={{ color: '#8a8f98' }}>
                    <span>Reading file…</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-1 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                    <div
                      className="h-1 rounded-full transition-all"
                      style={{ width: `${uploadProgress}%`, backgroundColor: '#7170ff' }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              className="mt-3 text-xs px-3 py-2 rounded"
              style={{
                backgroundColor: 'rgba(239,68,68,0.1)',
                color: '#ef4444',
                border: '1px solid rgba(239,68,68,0.2)',
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Traces */}
        <ErrorBoundary section="Traces">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: '#62666d' }}>
                Traces ({traces.length})
                {/* T2-01: Show live indicator when polling */}
                {traces.some(t => !TERMINAL_STATUSES.has(t.status)) && (
                  <span
                    className="ml-2 inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ backgroundColor: '#7170ff', verticalAlign: 'middle' }}
                    title="Auto-refreshing…"
                  />
                )}
              </h3>
              <button
                onClick={loadData}
                className="text-xs px-2 py-1 rounded transition-colors"
                style={{ color: '#8a8f98', backgroundColor: 'rgba(255,255,255,0.04)' }}
              >
                Refresh
              </button>
            </div>

            {traces.length === 0 ? (
              <div className="text-center py-12" style={{ color: '#62666d' }}>
                <div className="text-3xl mb-3">📄</div>
                <div className="text-sm">No traces yet</div>
                <div className="text-xs mt-1">Upload a document to start processing</div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {traces.map((trace) => (
                  <div
                    key={trace.trace_id}
                    className="flex items-center gap-4 px-4 py-3 rounded-lg cursor-pointer transition-colors"
                    style={{
                      backgroundColor: '#0f1011',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                    onClick={() => router.push(`/traces/${trace.trace_id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono" style={{ color: '#8a8f98' }}>
                          {trace.trace_id.slice(0, 8)}
                        </span>
                        {trace.filename && (
                          <span className="text-xs truncate" style={{ color: '#d0d6e0' }}>
                            {trace.filename}
                          </span>
                        )}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: '#62666d' }}>
                        {new Date(trace.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {trace.confidence && (
                        <div className="w-24">
                          <ConfidenceIndicator value={parseFloat(trace.confidence)} />
                        </div>
                      )}
                      <StatusBadge status={trace.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
}

/**
 * T4-02: Reports upload progress percentage via callback.
 * Uses FileReader.onprogress for real-time percentage updates.
 */
function readFileAsBase64(file: File, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function UploadProgressIndicator({ state }: { state: UploadState }) {
  const steps: { key: UploadState; label: string }[] = [
    { key: 'uploading', label: 'Uploading' },
    { key: 'submitted', label: 'Submitted' },
    { key: 'processing', label: 'Processing' },
  ];

  const currentIndex = steps.findIndex((s) => s.key === state);

  return (
    <div className="flex items-center gap-1.5">
      {steps.map((step, i) => {
        const isActive = i === currentIndex;
        const isDone = i < currentIndex;
        const color = isActive ? '#5e6ad2' : isDone ? '#27a644' : '#62666d';

        return (
          <div key={step.key} className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full ${isActive ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: color }}
            />
            <span className="text-xs" style={{ color }}>
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <span className="text-xs" style={{ color: '#62666d' }}>→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
