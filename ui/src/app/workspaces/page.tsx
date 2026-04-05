'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { api, Workspace } from '@/lib/api';

export default function WorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.workspaces.list()
      .then((res) => setWorkspaces(res.workspaces))
      .catch(() => setError('Failed to load workspaces'))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const ws = await api.workspaces.create({ name: name.trim() });
      setWorkspaces((prev) => [ws, ...prev]);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title="Workspaces" />
      <div className="flex-1 p-6 max-w-4xl mx-auto w-full">

        {/* Create form */}
        <form onSubmit={handleCreate} className="flex gap-2 mb-8">
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

        {/* Workspace list */}
        {loading ? (
          <div className="text-sm" style={{ color: '#62666d' }}>Loading…</div>
        ) : workspaces.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-sm mb-2" style={{ color: '#62666d' }}>No workspaces yet</div>
            <div className="text-xs" style={{ color: '#62666d' }}>Create your first workspace above</div>
          </div>
        ) : (
          <div className="space-y-2">
            {workspaces.map((ws) => (
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
      </div>
    </div>
  );
}
