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
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // T3-02: Search/filter state
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.workspaces.list()
      .then((res) => setWorkspaces(res.workspaces))
      .catch(() => setError('Failed to load workspaces'))
      .finally(() => setLoading(false));
  }, []);

  // T3-02: Client-side filter by workspace name
  const filteredWorkspaces = useMemo(() => {
    if (!search.trim()) return workspaces;
    const q = search.trim().toLowerCase();
    return workspaces.filter(ws =>
      ws.name.toLowerCase().includes(q) ||
      ws.description?.toLowerCase().includes(q) ||
      ws.workspace_id.toLowerCase().includes(q)
    );
  }, [workspaces, search]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const ws = await api.workspaces.create({ name: name.trim() });
      setWorkspaces((prev) => [ws, ...prev]);
      setName('');
      showToast(`Workspace "${ws.name}" created`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create workspace';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title="Workspaces" />
      <div className="flex-1 p-6 max-w-4xl mx-auto w-full">

        {/* Create form */}
        <form onSubmit={handleCreate} className="flex gap-2 mb-6">
          <input
            type="text"
            placeholder="New workspace name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 text-sm px-3 py-2 rounded outline-none"
            style={{
              backgroundColor: '#0f1011',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#f7f8f8',
            }}
          />
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="text-sm px-4 py-2 rounded font-medium transition-opacity disabled:opacity-40"
            style={{ backgroundColor: '#5e6ad2', color: '#fff' }}
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>

        {error && (
          <div className="mb-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}

        {/* T3-02: Search filter — shown when there are workspaces */}
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
            /* T4-03: Illustrated empty state */
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
              {/* T3-02: Show count when filtered */}
              {search && (
                <p className="text-xs mb-2" style={{ color: '#62666d' }}>
                  {filteredWorkspaces.length} of {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}
                </p>
              )}
              {filteredWorkspaces.map((ws) => (
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
                    <div className="text-sm font-medium" style={{ color: '#d0d6e0' }}>{ws.name}</div>
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
              ))}
            </div>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}
