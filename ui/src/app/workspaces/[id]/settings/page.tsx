'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useToast } from '@/components/ToastProvider';
import { api, Workspace } from '@/lib/api';

const SCHEMA_PLACEHOLDER = `{
  "invoice_number": "string",
  "invoice_date": "date",
  "vendor_name": "string",
  "total_amount": "number",
  "tax_amount": "number",
  "line_items": "any"
}`;

const SCHEMA_HELP = [
  { type: 'string', desc: 'Text value' },
  { type: 'number', desc: 'Decimal number' },
  { type: 'integer', desc: 'Whole number' },
  { type: 'boolean', desc: 'true / false' },
  { type: 'date', desc: 'ISO date string' },
  { type: 'any', desc: 'No type check' },
];

export default function WorkspaceSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [schemaText, setSchemaText] = useState('');
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [hitlThreshold, setHitlThreshold] = useState(0.8);
  const [promptVersion, setPromptVersion] = useState('1.0.0');

  useEffect(() => {
    api.workspaces.get(id)
      .then((ws) => {
        setWorkspace(ws);
        setName(ws.name);
        setDescription(ws.description ?? '');
        setSchemaText(ws.schema ? JSON.stringify(ws.schema, null, 2) : '');
        setHitlThreshold(ws.hitl_threshold);
        setPromptVersion(ws.prompt_version);
      })
      .catch(() => setError('Failed to load workspace'))
      .finally(() => setLoading(false));
  }, [id]);

  function validateSchema(text: string): Record<string, unknown> | null {
    if (!text.trim()) return {};
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setSchemaError('Schema must be a JSON object');
        return null;
      }
      setSchemaError(null);
      return parsed;
    } catch (e) {
      setSchemaError(`Invalid JSON: ${(e as Error).message}`);
      return null;
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const parsedSchema = validateSchema(schemaText);
    if (parsedSchema === null) return;

    setSaving(true);
    try {
      await api.workspaces.update(id, {
        name,
        description: description || undefined,
        schema: Object.keys(parsedSchema).length > 0 ? parsedSchema : undefined,
        hitl_threshold: hitlThreshold,
        prompt_version: promptVersion,
      });
      setSuccess('Workspace settings saved');
      showToast('Settings saved successfully', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleteConfirm !== workspace?.name) return;
    setError(null);
    setDeleting(true);
    try {
      await api.workspaces.delete(id);
      showToast(`Workspace "${workspace?.name}" deleted`, 'success');
      router.replace('/workspaces');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      setError(msg);
      showToast(msg, 'error');
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
        <Header title="Settings" />
        <div className="p-6 text-sm" style={{ color: '#62666d' }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title={`${workspace?.name ?? 'Workspace'} · Settings`} />
      <div className="flex-1 p-6 max-w-3xl mx-auto w-full">
        <ErrorBoundary section="Workspace Settings">

        {/* Back link */}
        <button
          onClick={() => router.push(`/workspaces/${id}`)}
          className="flex items-center gap-1.5 text-xs mb-6 transition-colors"
          style={{ color: '#62666d' }}
        >
          ← Back to workspace
        </button>

        <form onSubmit={handleSave} className="space-y-6">

          {/* Basic info */}
          <section
            className="rounded-lg p-5"
            style={{ backgroundColor: '#0f1011', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <h2 className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: '#62666d' }}>
              General
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: '#8a8f98' }}>Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full text-sm px-3 py-2 rounded outline-none"
                  style={{ backgroundColor: '#191a1b', border: '1px solid rgba(255,255,255,0.08)', color: '#f7f8f8' }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: '#8a8f98' }}>Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  className="w-full text-sm px-3 py-2 rounded outline-none"
                  style={{ backgroundColor: '#191a1b', border: '1px solid rgba(255,255,255,0.08)', color: '#f7f8f8' }}
                />
              </div>
            </div>
          </section>

          {/* Workflow config */}
          <section
            className="rounded-lg p-5"
            style={{ backgroundColor: '#0f1011', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <h2 className="text-xs font-medium uppercase tracking-wider mb-4" style={{ color: '#62666d' }}>
              Workflow configuration
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: '#8a8f98' }}>
                  Prompt version
                </label>
                <input
                  value={promptVersion}
                  onChange={(e) => setPromptVersion(e.target.value)}
                  placeholder="1.0.0"
                  className="w-full text-sm px-3 py-2 rounded outline-none font-mono"
                  style={{ backgroundColor: '#191a1b', border: '1px solid rgba(255,255,255,0.08)', color: '#f7f8f8' }}
                />
                <p className="text-xs mt-1" style={{ color: '#62666d' }}>
                  Bump to track which prompt produced which trace
                </p>
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: '#8a8f98' }}>
                  HITL threshold
                </label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={hitlThreshold}
                  onChange={(e) => setHitlThreshold(parseFloat(e.target.value))}
                  className="w-full text-sm px-3 py-2 rounded outline-none font-mono"
                  style={{ backgroundColor: '#191a1b', border: '1px solid rgba(255,255,255,0.08)', color: '#f7f8f8' }}
                />
                <p className="text-xs mt-1" style={{ color: '#62666d' }}>
                  Confidence below this triggers human review
                </p>
              </div>
            </div>
          </section>

          {/* Schema editor */}
          <section
            className="rounded-lg p-5"
            style={{ backgroundColor: '#0f1011', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-medium uppercase tracking-wider" style={{ color: '#62666d' }}>
                Extraction schema
              </h2>
              <button
                type="button"
                onClick={() => setSchemaText(SCHEMA_PLACEHOLDER)}
                className="text-xs px-2 py-1 rounded"
                style={{ color: '#7170ff', backgroundColor: 'rgba(113,112,255,0.08)' }}
              >
                Load example
              </button>
            </div>

            {/* Type reference */}
            <div className="flex gap-3 flex-wrap mb-3">
              {SCHEMA_HELP.map(({ type, desc }) => (
                <span key={type} className="text-xs" style={{ color: '#62666d' }}>
                  <span className="font-mono" style={{ color: '#8a8f98' }}>{type}</span> — {desc}
                </span>
              ))}
            </div>

            <textarea
              value={schemaText}
              onChange={(e) => {
                setSchemaText(e.target.value);
                if (e.target.value.trim()) validateSchema(e.target.value);
                else setSchemaError(null);
              }}
              placeholder={SCHEMA_PLACEHOLDER}
              rows={10}
              spellCheck={false}
              className="w-full text-sm px-3 py-2.5 rounded outline-none font-mono resize-y"
              style={{
                backgroundColor: '#191a1b',
                border: `1px solid ${schemaError ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`,
                color: '#f7f8f8',
                lineHeight: '1.6',
              }}
            />
            {schemaError && (
              <p className="text-xs mt-1.5" style={{ color: '#ef4444' }}>{schemaError}</p>
            )}
            <p className="text-xs mt-1.5" style={{ color: '#62666d' }}>
              Leave empty to skip LLM reasoning and only run Docling parsing.
            </p>
          </section>

          {/* Alerts */}
          {error && (
            <div className="text-xs px-3 py-2 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
              {error}
            </div>
          )}
          {success && (
            <div className="text-xs px-3 py-2 rounded" style={{ backgroundColor: 'rgba(39,166,68,0.1)', color: '#27a644', border: '1px solid rgba(39,166,68,0.2)' }}>
              {success}
            </div>
          )}

          {/* Save */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || !!schemaError}
              className="text-sm px-5 py-2 rounded font-medium disabled:opacity-40"
              style={{ backgroundColor: '#5e6ad2', color: '#fff' }}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>

        </form>

        {/* Danger Zone */}
        <section
          className="rounded-lg p-5 mt-6"
          style={{ backgroundColor: '#0f1011', border: '1px solid rgba(239,68,68,0.25)' }}
        >
          <h2 className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: '#ef4444' }}>
            Danger zone
          </h2>
          <p className="text-xs mb-4" style={{ color: '#62666d' }}>
            Permanently delete this workspace and all associated data. This action cannot be undone.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs mb-1.5" style={{ color: '#8a8f98' }}>
                Type <span className="font-mono" style={{ color: '#f7f8f8' }}>{workspace?.name}</span> to confirm
              </label>
              <input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={workspace?.name}
                className="w-full text-sm px-3 py-2 rounded outline-none"
                style={{ backgroundColor: '#191a1b', border: '1px solid rgba(239,68,68,0.3)', color: '#f7f8f8' }}
              />
            </div>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || deleteConfirm !== workspace?.name}
              className="text-sm px-4 py-2 rounded font-medium disabled:opacity-40"
              style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
            >
              {deleting ? 'Deleting…' : 'Delete workspace'}
            </button>
          </div>
        </section>
        </ErrorBoundary>
      </div>
    </div>
  );
}
