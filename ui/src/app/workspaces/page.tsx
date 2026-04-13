'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useToast } from '@/components/ToastProvider';
import { api, Workspace } from '@/lib/api';

export default function WorkspacesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Create form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hitlThreshold, setHitlThreshold] = useState('0.8');
  const [schemaJson, setSchemaJson] = useState('');
  const [schemaError, setSchemaError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.workspaces.list()
      .then((res) => setWorkspaces(res.workspaces))
      .catch(() => setError('Failed to load workspaces'))
      .finally(() => setLoading(false));
  }, []);

  const filteredWorkspaces = useMemo(() => {
    if (!search.trim()) return workspaces;
    const q = search.trim().toLowerCase();
    return workspaces.filter(ws =>
      ws.name.toLowerCase().includes(q) ||
      ws.description?.toLowerCase().includes(q) ||
      ws.workspace_id.toLowerCase().includes(q)
    );
  }, [workspaces, search]);

  function validateSchema(raw: string): Record<string, unknown> | null {
    if (!raw.trim()) return null;
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('Schema is not valid JSON');
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSchemaError(null);
    let schema: Record<string, unknown> | undefined;
    if (schemaJson.trim()) {
      try {
        schema = validateSchema(schemaJson) ?? undefined;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid schema JSON';
        setSchemaError(msg);
        return;
      }
    }

    const threshold = parseFloat(hitlThreshold);
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      setError('HITL threshold must be between 0 and 1');
      return;
    }

    setCreating(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        hitl_threshold: threshold,
      };
      if (description.trim()) payload.description = description.trim();
      if (schema) payload.schema = schema;

      const ws = await api.workspaces.create(payload as Parameters<typeof api.workspaces.create>[0]);
      setWorkspaces((prev) => [ws, ...prev]);
      setName('');
      setDescription('');
      setHitlThreshold('0.8');
      setSchemaJson('');
      setShowAdvanced(false);
      showToast(`Workspace "${ws.name}" created`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create workspace';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setCreating(false);
    }
  }

  const schemaFieldCount = (ws: Workspace): number => {
    const s = (ws as any).schema;
    if (!s) return 0;
    const fields = s.fields ?? s.properties ?? s;
    if (typeof fields === 'object' && fields !== null) return Object.keys(fields).length;
    return 0;
  };

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title="Workspaces" />
      <div className="flex-1 p-6 max-w-4xl mx-auto w-full">

        {/* Create form */}
        <form onSubmit={handleCreate} className="mb-6 rounded-lg p-4" style={{ backgroundColor: '#0f1011', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="New workspace name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={() => setShowAdvanced(true)}
              className="flex-1 text-sm px-3 py-2 rounded outline-none"
              style={{
                backgroundColor: '#08090a',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#f7f8f8',
              }}
            />
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs px-3 py-2 rounded transition-colors"
              style={{ color: '#8a8f98', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              {showAdvanced ? 'Simple ▲' : 'Options ▼'}
            </button>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="text-sm px-4 py-2 rounded font-medium transition-opacity disabled:opacity-40"
              style={{ backgroundColor: '#5e6ad2', color: '#fff' }}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>

          {showAdvanced && (
            <div className="space-y-3 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              {/* Description */}
              <div>
                <label className="text-xs mb-1 block" style={{ color: '#8a8f98' }}>Description</label>
                <input
                  type="text"
                  placeholder="Optional description…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded outline-none"
                  style={{
                    backgroundColor: '#08090a',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#f7f8f8',
                  }}
                />
              </div>

              {/* HITL threshold */}
              <div>
                <label className="text-xs mb-1 block" style={{ color: '#8a8f98' }}>
                  HITL confidence threshold
                  <span className="ml-2 font-mono" style={{ color: '#d0d6e0' }}>{hitlThreshold}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={hitlThreshold}
                  onChange={(e) => setHitlThreshold(e.target.value)}
                  className="w-full accent-indigo-400"
                />
                <div className="flex justify-between text-xs mt-0.5" style={{ color: '#62666d' }}>
                  <span>0 — never flag</span>
                  <span>1 — always flag</span>
                </div>
              </div>

              {/* Extraction schema */}
              <div>
                <label className="text-xs mb-1 flex items-center justify-between" style={{ color: '#8a8f98' }}>
                  <span>Extraction schema <span style={{ color: '#62666d' }}>(JSON)</span></span>
                  <button
                    type="button"
                    onClick={() => setSchemaJson(JSON.stringify({
                      fields: {
                        invoice_number: { type: 'string', description: 'Invoice number' },
                        invoice_date: { type: 'string', description: 'Invoice date' },
                        total_amount: { type: 'string', description: 'Total amount due' },
                        vendor_name: { type: 'string', description: 'Vendor name' },
                      }
                    }, null, 2))}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ color: '#7170ff', backgroundColor: 'rgba(113,112,255,0.1)', border: 'none', cursor: 'pointer' }}
                  >
                    Insert example
                  </button>
                </label>
                <textarea
                  value={schemaJson}
                  onChange={(e) => { setSchemaJson(e.target.value); setSchemaError(null); }}
                  placeholder={'{\n  "fields": {\n    "invoice_number": { "type": "string" }\n  }\n}'}
                  rows={6}
                  className="w-full text-xs font-mono px-3 py-2 rounded outline-none resize-none"
                  style={{
                    backgroundColor: '#08090a',
                    border: `1px solid ${schemaError ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    color: '#f7f8f8',
                    lineHeight: '1.5',
                  }}
                  spellCheck={false}
                />
                {schemaError && (
                  <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{schemaError}</p>
                )}
                <p className="text-xs mt-1" style={{ color: '#62666d' }}>
                  Define which fields to extract from documents. You can also configure this later in workspace settings.
                </p>
              </div>
            </div>
          )}
        </form>

        {error && (
          <div className="mb-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}

        {/* Search filter */}
        {!loading && workspaces.length > 0 && (
          <div className="mb-4">
            <input
              type="search"
              placeholder="Search workspaces…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded outline-none"
              style={{
                backgroundColor: '#0f1011',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#f7f8f8',
              }}
              aria-label="Search workspaces"
            />
          </div>
        )}

        {/* Workspace list */}
        <ErrorBoundary section="Workspaces list">
          {loading ? (
            <div className="text-sm" style={{ color: '#62666d' }}>Loading…</div>
          ) : workspaces.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">🗂️</div>
              <div className="text-sm font-medium mb-1" style={{ color: '#d0d6e0' }}>No workspaces yet</div>
              <div className="text-xs" style={{ color: '#62666d' }}>Create your first workspace above to start processing documents</div>
            </div>
          ) : filteredWorkspaces.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🔍</div>
              <div className="text-sm" style={{ color: '#62666d' }}>
                No workspaces match &ldquo;{search}&rdquo;
              </div>
              <button
                onClick={() => setSearch('')}
                className="mt-2 text-xs"
                style={{ color: '#7170ff', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {search && (
                <p className="text-xs mb-2" style={{ color: '#62666d' }}>
                  {filteredWorkspaces.length} of {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}
                </p>
              )}
              {filteredWorkspaces.map((ws) => {
                const fieldCount = schemaFieldCount(ws);
                return (
                  <div
                    key={ws.workspace_id}
                    className="flex items-center justify-between px-4 py-3 rounded-lg cursor-pointer transition-colors"
                    style={{
                      backgroundColor: '#0f1011',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                    onClick={() => router.push(`/workspaces/${ws.workspace_id}`)}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium" style={{ color: '#d0d6e0' }}>{ws.name}</div>
                        {fieldCount > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(94,106,210,0.15)', color: '#7170ff' }}>
                            {fieldCount} field{fieldCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {ws.description && (
                        <div className="text-xs mt-0.5 truncate max-w-xs" style={{ color: '#8a8f98' }}>
                          {ws.description}
                        </div>
                      )}
                      <div className="text-xs mt-0.5" style={{ color: '#62666d' }}>
                        {ws.workspace_id.slice(0, 8)} · v{ws.prompt_version} · HITL {ws.hitl_threshold}
                      </div>
                    </div>
                    <div className="text-xs" style={{ color: '#62666d' }}>
                      {new Date(ws.created_at).toLocaleDateString()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}
