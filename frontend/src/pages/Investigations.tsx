import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorState, PageHeader, PageTransition, SkeletonTable } from '../components/feedback';
import { PriorityBadge, RiskBadge } from '../components/risk';
import { DataTable, FilterChip, type Column } from '../components/tables/DataTable';
import { useAsync } from '../hooks';
import { SCENARIO_LABEL, inr } from '../lib/format';
import { api } from '../services/api';
import { useApp } from '../state/AppContext';
import type { Band, Priority, QueueRow } from '../types/models';

const PRIORITIES: Priority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const BANDS: Band[] = ['VERY HIGH', 'HIGH', 'MODERATE', 'LOW'];

export function Investigations() {
  const { scenario, pushToast } = useApp();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.queue(scenario), [scenario]);

  const [q, setQ] = useState('');
  const [priority, setPriority] = useState<Priority | null>(null);
  const [band, setBand] = useState<Band | null>(null);
  const [cluster, setCluster] = useState<string | null>(null);

  const rows = data?.queue ?? [];
  const clusterIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.cluster_id).filter(Boolean))) as string[],
    [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (priority && r.priority !== priority) return false;
      if (band && r.coordination_band !== band) return false;
      if (cluster && r.cluster_id !== cluster) return false;
      if (!needle) return true;
      return r.return_id.toLowerCase().includes(needle)
        || r.account_id.toLowerCase().includes(needle)
        || r.claim_type.toLowerCase().includes(needle)
        || (r.cluster_id ?? '').toLowerCase().includes(needle);
    });
  }, [rows, q, priority, band, cluster]);

  const clearFilters = () => {
    setQ(''); setPriority(null); setBand(null); setCluster(null);
    pushToast({ title: 'Filters cleared' });
  };

  const columns: Column<QueueRow>[] = [
    { key: 'priority', header: 'Priority', width: '104px', sortable: true,
      value: (r) => PRIORITIES.length - PRIORITIES.indexOf(r.priority),
      render: (r) => <PriorityBadge priority={r.priority} /> },
    { key: 'return', header: 'Return', sortable: true, value: (r) => r.return_id,
      render: (r) => (
        <div>
          <p className="mono-num text-[12.5px] font-semibold">{r.return_id}</p>
          <p className="text-[11px] text-fg3">{r.claim_type}</p>
        </div>) },
    { key: 'account', header: 'Account', sortable: true, value: (r) => r.account_id,
      render: (r) => (
        <div>
          <p className="mono-num text-[12.5px]">{r.account_id}</p>
          <p className="mono-num text-[11px] text-fg3">{inr(r.refund_inr)}</p>
        </div>) },
    { key: 'rate', header: 'Return rate', align: 'right', sortable: true,
      value: (r) => r.return_rate_pct,
      render: (r) => <span className="mono-num text-[12.5px]">{r.return_rate_pct}%</span> },
    { key: 'individual', header: 'Individual', align: 'right', sortable: true,
      value: (r) => r.individual_risk,
      render: (r) => <RiskBadge band={r.individual_band} score={r.individual_risk} size="sm" /> },
    { key: 'threshold', header: 'Threshold', align: 'right', sortable: true,
      value: (r) => r.threshold_signal,
      render: (r) => <RiskBadge band={r.threshold_band} score={r.threshold_signal} size="sm" /> },
    { key: 'network', header: 'Network', align: 'right', sortable: true,
      value: (r) => r.network_evidence,
      render: (r) => <RiskBadge band={r.network_band} score={r.network_evidence} size="sm" /> },
    { key: 'coordination', header: 'Coordination', align: 'right', sortable: true,
      value: (r) => r.coordination_risk,
      render: (r) => <RiskBadge band={r.coordination_band} score={r.coordination_risk} size="sm" /> },
    { key: 'cluster', header: 'Cluster', sortable: true, value: (r) => r.cluster_id ?? '',
      render: (r) => <span className="mono-num text-[11.5px] text-fg3">{r.cluster_id ?? '—'}</span> },
    { key: 'reason', header: 'Primary reason', width: '240px',
      render: (r) => (
        <span className="line-clamp-2 text-[11.5px] text-fg3">
          {r.primary_reasons.join(' · ')}
        </span>) },
    { key: 'status', header: 'Status', width: '128px',
      render: (r) => <span className="text-[11.5px] text-fg3">{r.status}</span> },
  ];

  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <PageTransition>
      <PageHeader
        eyebrow={`Synthetic scenario · ${SCENARIO_LABEL[scenario]}`}
        title="Investigations"
        subtitle={data?.human_in_the_loop
          ?? 'RefundShield prioritises cases for investigation. It does not automatically deny refunds.'}
      />

      <div className="mb-4 space-y-3">
        <div className="relative max-w-sm">
          <Search size={15} aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg3" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search return, account, claim type…"
            aria-label="Filter investigations"
            className="w-full rounded-lg border border-hairline bg-surface py-2 pl-9 pr-3 text-[13px]
                       placeholder:text-fg3 focus:border-ring2"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <FilterGroup label="Priority" options={PRIORITIES} value={priority} onChange={setPriority} />
          <FilterGroup label="Coordination" options={BANDS} value={band} onChange={setBand} />
          {clusterIds.length > 0 && (
            <FilterGroup label="Cluster" options={clusterIds} value={cluster} onChange={setCluster} />
          )}
        </div>
      </div>

      {loading ? <SkeletonTable rows={10} /> : (
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(r) => r.return_id}
          onRowClick={(r) => navigate(`/investigations/${r.return_id}`)}
          initialSort={{ key: 'coordination', dir: 'desc' }}
          emptyTitle="No investigations match your filters."
          emptyMessage="Try widening the priority or coordination filters."
          onClearFilters={clearFilters}
          caption="Return requests ranked by investigation priority"
        />
      )}
    </PageTransition>
  );
}

function FilterGroup<T extends string>({ label, options, value, onChange }: {
  label: string; options: T[]; value: T | null; onChange: (v: T | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="eyebrow mr-1">{label}</span>
      <FilterChip label="All" active={value === null} onClick={() => onChange(null)} />
      {options.map((o) => (
        <FilterChip key={o} label={o} active={value === o}
                    onClick={() => onChange(value === o ? null : o)} />
      ))}
    </div>
  );
}
