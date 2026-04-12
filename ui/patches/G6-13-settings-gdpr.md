# G6-13: GDPR UI Additions to settings/page.tsx

Add these imports at the top of the file:
```typescript
import { api } from '@/lib/api';
```
(api is already imported but add gdpr state vars below)

## New state variables to add in SettingsPage function:
```typescript
const [gdprExporting, setGdprExporting] = useState(false);
const [deleteConfirm, setDeleteConfirm] = useState('');
const [showDeleteModal, setShowDeleteModal] = useState(false);
const [deleting, setDeleting] = useState(false);
```

## New handlers:
```typescript
const handleExportData = async () => {
  setGdprExporting(true);
  try {
    const data = await api.gdpr.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docops-data-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data export downloaded', 'success');
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Export failed', 'error');
  } finally {
    setGdprExporting(false);
  }
};

const handleDeleteAccount = async () => {
  if (deleteConfirm !== user?.email) return;
  setDeleting(true);
  try {
    await api.gdpr.deleteAccount();
    showToast('Account scheduled for deletion', 'success');
    await signOut();
    router.push('/auth/login');
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Deletion failed', 'error');
    setDeleting(false);
  }
};
```

## New GDPR section to add before "Sign out" section:
```tsx
{/* ── GDPR Data Controls ─────────────────────────────────── */}
<section aria-label="Data & Privacy" className="mt-6">
  <SectionTitle>Data &amp; Privacy</SectionTitle>
  <Panel>
    <div className="mb-4">
      <p className="text-sm mb-3" style={{ color: '#8a8f98' }}>
        Download a complete export of all your data (GDPR Article 20 — data portability).
      </p>
      <button
        onClick={handleExportData}
        disabled={gdprExporting}
        className="w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
        style={{
          backgroundColor: 'rgba(113,112,255,0.1)',
          border: '1px solid rgba(113,112,255,0.25)',
          color: '#7170ff',
        }}
      >
        {gdprExporting ? 'Exporting…' : 'Export My Data'}
      </button>
    </div>
    <div
      className="rounded-lg p-4 mt-4"
      style={{ backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}
    >
      <h4 className="text-sm font-medium mb-2" style={{ color: '#ef4444' }}>Delete Account</h4>
      <p className="text-xs mb-3" style={{ color: '#8a8f98' }}>
        Permanently delete your account and all data. This action cannot be undone.
        To confirm, type your email address below.
      </p>
      <input
        type="email"
        placeholder={user?.email ?? 'your@email.com'}
        value={deleteConfirm}
        onChange={(e) => setDeleteConfirm(e.target.value)}
        className="w-full rounded-md px-3 py-2 text-sm mb-3"
        style={{
          backgroundColor: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(239,68,68,0.2)',
          color: '#d0d6e0',
        }}
      />
      <button
        onClick={handleDeleteAccount}
        disabled={deleteConfirm !== user?.email || deleting}
        className="w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundColor: deleteConfirm === user?.email ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(239,68,68,0.2)',
          color: '#ef4444',
        }}
      >
        {deleting ? 'Deleting account…' : 'Delete Account Permanently'}
      </button>
    </div>
  </Panel>
</section>
```
