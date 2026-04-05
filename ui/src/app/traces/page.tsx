import Header from '@/components/Header';

export default function TracesPage() {
  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title="Traces" />
      <div className="flex-1 p-6 max-w-5xl mx-auto w-full">
        <div className="text-center py-16">
          <div className="text-sm mb-2" style={{ color: '#d0d6e0' }}>View traces per workspace</div>
          <div className="text-xs" style={{ color: '#62666d' }}>
            Open a workspace from the{' '}
            <a href="/workspaces" style={{ color: '#7170ff' }}>Workspaces</a>
            {' '}page to see its traces.
          </div>
        </div>
      </div>
    </div>
  );
}
