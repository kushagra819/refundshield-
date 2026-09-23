import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ErrorState, PageHeader, PageTransition, SkeletonCard, SkeletonTable } from '../components/feedback';
import { EvidenceGroups } from '../components/evidence';
import { MeterRow, Panel, RiskBadge, ScoreCard } from '../components/risk';
import { DataTable, FilterChip, type Column } from '../components/tables/DataTable';
import { useAsync } from '../hooks';
import { SCENARIO_LABEL, cx } from '../lib/format';
import { api } from '../services/api';
import { useApp } from '../state/AppContext';
import type { AccountRow, Band } from '../types/models';

const BANDS: Band[] = ['VERY HIGH', 'HIGH', 'MODERATE', 'LOW'];

export function Accounts() {
  const { scenario, pushToast } = useApp();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.accounts(scenario), [scenario]);

  const [q, setQ] = useState('');
  const [band, setBand] = useState<Band | null>(null);
  const [cluster, setCluster] = useState<string | null>(null);
  const [inWindowOnly, setInWindowOnly] = useState(false);

  const rows = data?.accounts ?? [];
  const clusterIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.cluster_id).filter(Boolean))).sort() as string[],
    [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (band && r.coordination_band !== band) return false;
      if (cluster && r.cluster_id !== cluster) return false;
      if (inWindowOnly && !r.in_window) return false;
      if (!needle) return true;
      return r.account_id.toLowerCase().includes(needle)
        || (r.cluster_id ?? '').toLowerCase().includes(needle)
        || r.address_id.toLowerCase().includes(needle)
        || r.device_ids.some((d) => d.toLowerCase().includes(needle));
    });
  }, [rows, q, band, cluster, inWindowOnly]);

  const columns: Column<AccountRow>[] = [
    { key: 'account', header: 'Account', sortable: true, value: (r) => r.account_id,
      render: (r) => <span className="mono-num text-[12.5px] font-semibold">{r.account_id}</span> },
    { key: 'rate', header: 'Return rate', align: 'right', sortable: true,
      value: (r) => r.return_rate_pct,
      render: (r) => (
        <span className={cx('mono-num text-[12.5px]', r.in_window && 'font-bold text-high-fg dark:text-high')}>
          {r.return_rate_pct}%
        </span>) },
    { key: 'orders', header: 'Orders', align: 'right', sortable: true, value: (r) => r.order_count,
      render: (r) => <span className="mono-num text-[12.5px] text-fg3">{r.order_count}</span> },
    { key: 'returns', header: 'Returns', align: 'right', sortable: true, value: (r) => r.return_count,
      render: (r) => <span className="mono-num text-[12.5px] text-fg3">{r.return_count}</span> },
    { key: 'individual', header: 'Individual', align: 'right', sortable: true,
      value: (r) => r.individual_risk,
      render: (r) => <RiskBadge band={r.individual_band} score={r.individual_risk} size="sm" /> },
    { key: 'threshold', header: 'Threshold', align: 'right', sortable: true,
      value: (r) => r.threshold_signal,
      render: (r) => <span className="mono-num text-[12.5px]">{r.threshold_signal.toFixed(1)}</span> },
    { key: 'coordination', header: 'Coordination', align: 'right', sortable: true,
      value: (r) => r.coordination_risk,
      render: (r) => <RiskBadge band={r.coordination_band} score={r.coordination_risk} size="sm" /> },
    { key: 'cluster', header: 'Cluster', sortable: true, value: (r) => r.cluster_id ?? '',
      render: (r) => <span className="mono-num text-[11.5px] text-fg3">{r.cluster_id ?? '—'}</span> },
  ];

  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <PageTransition>
      <PageHeader eyebrow={`Synthetic scenario · ${SCENARIO_LABEL[scenario]}`} title="Accounts"
                  subtitle="Every account in the seller's synthetic population, with its evidence streams." />

      <div className="mb-4 space-y-3">
        <div className="relative max-w-sm">
          <Search size={15} aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg3" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Search account, cluster, device, address…"
                 aria-label="Filter accounts"
                 className="w-full rounded-lg border border-hairline bg-surface py-2 pl-9 pr-3
                            text-[13px] placeholder:text-fg3 focus:border-ring2" />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="eyebrow mr-1">Coordination</span>
            <FilterChip label="All" active={band === null} onClick={() => setBand(null)} />
            {BANDS.map((b) => (
              <FilterChip key={b} label={b} active={band === b}
                          onClick={() => setBand(band === b ? null : b)} />
            ))}
          </div>
          <FilterChip label="Near threshold only" active={inWindowOnly}
                      onClick={() => setInWindowOnly((v) => !v)} />
          {clusterIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="eyebrow mr-1">Cluster</span>
              <FilterChip label="All" active={cluster === null} onClick={() => setCluster(null)} />
              {clusterIds.slice(0, 6).map((c) => (
                <FilterChip key={c} label={c} active={cluster === c}
                            onClick={() => setCluster(cluster === c ? null : c)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {loading ? <SkeletonTable rows={10} /> : (
        <DataTable rows={filtered} columns={columns} rowKey={(r) => r.account_id}
                   onRowClick={(r) => navigate(`/accounts/${r.account_id}`)}
                   initialSort={{ key: 'coordination', dir: 'desc' }}
                   emptyTitle="No accounts match your filters."
                   onClearFilters={() => {
                     setQ(''); setBand(null); setCluster(null); setInWindowOnly(false);
                     pushToast({ title: 'Filters cleared' });
                   }}
                   caption="Accounts with their individual, threshold and coordination scores" />
      )}
    </PageTransition>
  );
}

export function AccountDetail() {
  const { accountId = '' } = useParams();
  const { scenario } = useApp();
  const { data, loading, error, reload } = useAsync(
    () => api.accountDetail(accountId, scenario), [accountId, scenario]);
  const timeline = useAsync(
    () => data?.cluster_id ? api.clusterTimeline(data.cluster_id, scenario) : Promise.resolve(null),
    [data?.cluster_id, scenario]);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) {
    return <div className="space-y-4"><SkeletonCard lines={2} />
      <div className="grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={1} />)}
      </div></div>;
  }

  return (
    <PageTransition>
      <PageHeader
        eyebrow={`Account · ${data.cluster_id ?? 'No linked group'}`}
        title={data.account_id}
        subtitle={data.explanation.headline}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.evidence_stack.map((s, i) => (
          <ScoreCard key={s.label} label={s.label} score={s.score} band={s.band}
                     hint={s.hint} delay={i * 0.06} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <Panel eyebrow="Assessment" title={data.verdict}
                 alert={data.prioritised}>
            <p className="text-[13px] leading-relaxed text-fg2">{data.rationale}</p>
            <ol className="mt-3 space-y-2">
              {data.explanation.reasons.map((r, i) => (
                <li key={i} className="flex gap-3 text-[12.5px] leading-relaxed text-fg2">
                  <span className="mono-num shrink-0 text-[11px] font-bold text-fg3">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {r}
                </li>
              ))}
            </ol>
            <p className="mt-3 rounded-lg bg-raised px-3.5 py-2.5 text-[12px] text-fg3">
              {data.explanation.caveat}
            </p>
          </Panel>

          <Panel eyebrow="Evidence" title="Grouped evidence">
            <EvidenceGroups groups={data.evidence_groups} />
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel eyebrow="Behaviour" title="Account profile">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Stat label="Orders" value={String(data.orders)} />
              <Stat label="Returns" value={String(data.returns)} />
              <Stat label="Return rate" value={`${data.return_rate_pct}%`} />
              <Stat label="Account age" value={`${data.account_age_days} days`} />
              <Stat label="Address" value={data.address} />
              <Stat label="Devices" value={data.devices.join(', ')} />
            </dl>
            <div className="mt-3 border-t border-hairline pt-3">
              <p className="eyebrow">Product categories</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {data.categories.map((c) => (
                  <span key={c} className="rounded-full bg-raised px-2.5 py-1 text-[11px] text-fg2">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </Panel>

          {data.related_accounts.length > 0 && (
            <Panel eyebrow="Network" title={`${data.related_accounts.length} related accounts`}>
              <ul className="space-y-1">
                {data.related_accounts.map((a) => (
                  <li key={a}>
                    <Link to={`/accounts/${a}`}
                          className="mono-num flex items-center justify-between rounded-lg px-2.5 py-2
                                     text-[12.5px] transition hover:bg-raised">
                      {a}
                      <span className="text-[11px] text-fg3">View</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {timeline.data && timeline.data.events.length > 0 && (
            <Panel eyebrow="Timeline" title="Group activity">
              <Timeline data={timeline.data} limit={12} />
            </Panel>
          )}
        </div>
      </div>
    </PageTransition>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mono-num mt-0.5 truncate text-[13px] font-semibold">{value}</dd>
    </div>
  );
}

import { Timeline } from '../components/timeline/Timeline';
