'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { api, Workspace, Trace } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  pending: '#62666d',
  processing: '#f59e0b',
  completed: '#27a644',
  failed: '#ef4444',
  hitl_required: '#7170ff',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        color: STATUS_COLORS[status] ?? '#62666d',
        backgroundColor: `${STATUS_COLORS[status] ?? '#62666d'}18`,
      }}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      const result = await api.process(id, {
        filename: file.name,
        content_base64: base64,
      });

      setSuccessMsg(`Submitted — trace ${result.trace_id.slice(0, 8)}`);
      // Reload traces after a short delay
      setTimeout(() => loadData(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
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
          <label className="flex items-center gap-3 cursor-pointer">
            <span
              className="text-sm px-4 py-2 rounded font-medium transition-opacity"
              style={{
                backgroundColor: uploading ? 'rgba(94,106,210,0.4)' : '#5e6ad2',
                color: '#fff',
                opacity: uploading ? 0.6 : 1,
                pointerEvents: uploading ? 'none' : 'auto',
              }}
            >
              {uploading ? 'Uploading…' : 'Choose file'}
            </span>
            <span className="text-sm" style={{ color: '#8a8f98' }}>
              PDF, DOCX, PNG, JPG supported
            </span>
            <input
              type="file"
              accept=".pdf,.docx,.doc,.png,.jpg,.jpeg"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>

          {successMsg && (
            <div className="mt-3 text-xs px-3 py-2 rounded" style={{ backgroundColor: 'rgba(39,166,68,0.1)', color: '#27a644', border: '1px solid rgba(39,166,68,0.2)' }}>
              {successMsg}
            </div>
          )}
          {error && (
            <div className="mt-3 text-xs px-3 py-2 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
              {error}
            </div>
          )}
        </div>

        {/* Traces */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: '#62666d' }}>
              Traces ({traces.length})
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
                      <span className="text-xs font-mono" style={{ color: '#8a8f98' }}>
                        {(parseFloat(trace.confidence) * 100).toFixed(0)}%
                      </span>
                    )}
                    <StatusBadge status={trace.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
