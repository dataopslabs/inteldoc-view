import Header from '@/components/Header';

const USAGE_STATS = [
  { label: 'Workspaces', value: '—', limit: '2', unit: 'free tier' },
  { label: 'Documents processed', value: '—', limit: '10', unit: 'this month' },
  { label: 'HITL pending', value: '—', limit: null, unit: 'reviews' },
  { label: 'Avg confidence', value: '—', limit: null, unit: 'score' },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title="Dashboard" />
      <div className="flex-1 p-6 max-w-5xl mx-auto w-full">

        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-1" style={{ color: '#f7f8f8', letterSpacing: '-0.02em' }}>
            Welcome to DocOps
          </h2>
          <p className="text-sm" style={{ color: '#8a8f98' }}>
            Agentic Document Intelligence Platform · Phase 1 Foundation
          </p>
        </div>

        {/* Usage stats */}
        <div className="grid grid-cols-2 gap-3 mb-8 lg:grid-cols-4">
          {USAGE_STATS.map(({ label, value, limit, unit }) => (
            <div
              key={label}
              className="rounded-lg p-4"
              style={{
                backgroundColor: '#0f1011',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div className="text-xs mb-2" style={{ color: '#62666d' }}>{label}</div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold" style={{ color: '#f7f8f8', letterSpacing: '-0.03em' }}>
                  {value}
                </span>
                {limit && (
                  <span className="text-xs" style={{ color: '#62666d' }}>/ {limit}</span>
                )}
              </div>
              <div className="text-xs mt-1" style={{ color: '#62666d' }}>{unit}</div>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div className="mb-8">
          <h3 className="text-xs font-medium mb-3 uppercase tracking-wider" style={{ color: '#62666d' }}>
            Quick actions
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { label: 'Create workspace', href: '/workspaces', description: 'Set up a new document processing workspace' },
              { label: 'View traces', href: '/traces', description: 'Inspect document processing traces (Phase 2)' },
              { label: 'HITL review', href: '/hitl', description: 'Review low-confidence extractions (Phase 4)' },
            ].map(({ label, href, description }) => (
              <a
                key={label}
                href={href}
                className="block rounded-lg p-4 transition-colors group"
                style={{
                  backgroundColor: '#0f1011',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div
                  className="text-sm font-medium mb-1 transition-colors"
                  style={{ color: '#d0d6e0' }}
                >
                  {label}
                </div>
                <div className="text-xs" style={{ color: '#62666d' }}>{description}</div>
              </a>
            ))}
          </div>
        </div>

        {/* Phase progress */}
        <div>
          <h3 className="text-xs font-medium mb-3 uppercase tracking-wider" style={{ color: '#62666d' }}>
            Roadmap
          </h3>
          <div className="space-y-1.5">
            {[
              { phase: 1, label: 'Foundation', status: 'active' },
              { phase: 2, label: 'Document Processing Pipeline', status: 'pending' },
              { phase: 3, label: 'Strands Workflow Engine', status: 'pending' },
              { phase: 4, label: 'HITL Review System', status: 'pending' },
              { phase: 5, label: 'Memory & Chat', status: 'pending' },
              { phase: 6, label: 'Observability & Tracing', status: 'pending' },
              { phase: 7, label: 'Full UI & Trace Explorer', status: 'pending' },
              { phase: 8, label: 'Pricing & Billing', status: 'pending' },
            ].map(({ phase, label, status }) => (
              <div
                key={phase}
                className="flex items-center gap-3 px-3 py-2 rounded"
                style={{
                  backgroundColor: status === 'active' ? 'rgba(94,106,210,0.1)' : 'transparent',
                  border: status === 'active' ? '1px solid rgba(113,112,255,0.2)' : '1px solid transparent',
                }}
              >
                <span
                  className="text-xs font-mono w-6 text-center"
                  style={{ color: status === 'active' ? '#7170ff' : '#62666d' }}
                >
                  {phase}
                </span>
                <span
                  className="text-sm"
                  style={{ color: status === 'active' ? '#d0d6e0' : '#62666d' }}
                >
                  {label}
                </span>
                {status === 'active' && (
                  <span
                    className="ml-auto text-xs px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'rgba(113,112,255,0.15)', color: '#7170ff' }}
                  >
                    In progress
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
