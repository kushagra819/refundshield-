import { AlertTriangle, Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorState, PageHeader, PageTransition, SkeletonCard } from '../components/feedback';
import { NetworkGraph } from '../components/network/NetworkGraph';
import { MeterRow, Panel, PriorityBadge, RiskBadge } from '../components/risk';
import { FilterChip } from '../components/tables/DataTable';
import { useAsync } from '../hooks';
import { SCENARIO_LABEL, cx } from '../lib/format';
import { api } from '../services/api';
import { useApp } from '../state/AppContext';
import type { Cluster, GraphEdge, GraphNode } from '../types/models';

const RELATIONSHIPS = [
  { key: 'all', label: 'All' },
  { key: 'shared_device', label: 'Device' },
  { key: 'shared_address', label: 'Address' },
];

export function NetworkExplorer() {
  const { scenario } = useApp();
  const [params, setParams] = useSearchParams();
  const clusters = useAsync(() => api.clusters(scenario), [scenario]);

  const [selectedCluster, setSelectedCluster] = useState<string | null>(params.get('cluster'));
  const [relationship, setRelationship] = useState('all');
  const [selected, setSelected] = useState<GraphNode | GraphEdge | null>(null);
  const [spotlight, setSpotlight] = useState<{ code: string; ids: string[] } | null>(null);

  const list = clusters.data?.clusters ?? [];
  const active = useMemo<Cluster | null>(() => {
    if (!list.length) return null;
    return list.find((c) => c.cluster_id === selectedCluster) ?? list[0];
  }, [list, selectedCluster]);

  useEffect(() => {
    if (active && active.cluster_id !== selectedCluster) setSelectedCluster(active.cluster_id);
  }, [active, selectedCluster]);

  const focusAccount = active?.account_ids[0];
  const net = useAsync(
    () => focusAccount ? api.network(focusAccount, scenario, relationship) : Promise.resolve(null),
    [focusAccount, scenario, relationship]);

  const detail = useAsync(
    () => selected && 'id' in selected && selected.kind === 'account'
      ? api.accountDetail(selected.id, scenario)
      : Promise.resolve(null),
    [selected && 'id' in selected ? selected.id : null, scenario]);

  if (clusters.error) return <ErrorState message={clusters.error} onRetry={clusters.reload} />;

  return (
    <PageTransition>
      <PageHeader
        eyebrow={`Synthetic scenario · ${SCENARIO_LABEL[scenario]}`}
        title="Network Explorer"
        subtitle="Which accounts are related, and why. A relationship is context — not proof."
      />

      <div className="grid items-start gap-4 xl:grid-cols-[260px_1fr_300px]">
        {/* clusters */}
        <Panel eyebrow="Clusters" title={`${list.length} groups`} className="self-start">
          {clusters.loading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) =>
              <div key={i} className="h-14 animate-pulse rounded-lg bg-hairline/40" />)}</div>
          ) : (
            <ul className="max-h-[560px] space-y-1 overflow-y-auto pr-1">
              {list.map((c) => (
                <li key={c.cluster_id}>
                  <button
                    onClick={() => { setSelectedCluster(c.cluster_id); setSelected(null);
                                     setParams({ cluster: c.cluster_id }); }}
                    className={cx('w-full rounded-lg border px-3 py-2.5 text-left transition',
                      c.cluster_id === active?.cluster_id
                        ? 'border-ring2 bg-brand-tint dark:bg-raised'
                        : 'border-transparent hover:bg-raised')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono-num text-[12.5px] font-semibold">{c.cluster_id}</span>
                      <RiskBadge band={c.coordination.band} size="sm" />
                    </div>
                    <p className="mt-1 text-[11px] text-fg3">
                      {c.size} accounts · network {c.network_evidence.toFixed(1)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* graph */}
        <Panel
          eyebrow={active ? `Cluster ${active.cluster_id}` : 'Graph'}
          title={active ? `${active.size} accounts and what they share` : 'No clusters found'}
          action={
            <div className="flex flex-wrap gap-1.5">
              {RELATIONSHIPS.map((r) => (
                <FilterChip key={r.key} label={r.label} active={relationship === r.key}
                            onClick={() => setRelationship(r.key)} />
              ))}
            </div>
          }
        >
          {net.loading || !net.data ? (
            <div className="h-[420px] animate-pulse rounded-lg bg-hairline/40" />
          ) : net.data.nodes.length === 0 ? (
            <p className="py-16 text-center text-sm text-fg3">
              No relationships of this type in the selected cluster.
            </p>
          ) : (
            <NetworkGraph
              nodes={net.data.nodes} edges={net.data.edges}
              selectedId={selected && 'id' in selected ? selected.id : null}
              onSelectNode={(n) => { setSpotlight(null); setSelected(n); }}
              onSelectEdge={(e) => { setSpotlight(null); setSelected(e); }}
              highlightIds={spotlight?.ids ?? null}
            />
          )}
          {spotlight && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg
                            bg-raised px-3 py-2">
              <p className="text-[11.5px] text-fg2">
                Highlighting <b>{spotlight.ids.length}</b> linked entities for this evidence item.
              </p>
              <button onClick={() => setSpotlight(null)} className="btn px-2 py-1 text-[11px]">
                Clear highlight
              </button>
            </div>
          )}
        </Panel>

        {/* inspector */}
        <div className="space-y-4">
          <Panel eyebrow="Inspector" title={
            selected
              ? ('id' in selected ? selected.label : (selected as GraphEdge).label)
              : 'Nothing selected'}>
            {!selected && (
              <p className="py-6 text-center text-[12.5px] text-fg3">
                Select a node or a relationship in the graph to inspect it.
              </p>
            )}

            {selected && 'id' in selected && selected.kind === 'account' && (
              <div className="space-y-3">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Stat label="Return rate" value={`${selected.meta.return_rate_pct}%`} />
                  <Stat label="Orders" value={String(selected.meta.orders)} />
                  <Stat label="Returns" value={String(selected.meta.returns)} />
                </dl>
                {detail.data && (
                  <>
                    <div className="border-t border-hairline pt-2.5">
                      <MeterRow label="Individual" score={detail.data.individual_risk}
                                band={detail.data.individual_band} />
                      <MeterRow label="Threshold" score={detail.data.threshold_signal}
                                band={detail.data.threshold_band} />
                      <MeterRow label="Coordination" score={detail.data.coordination_risk}
                                band={detail.data.coordination_band} />
                    </div>
                    <p className="text-[11.5px] text-fg3">
                      Cluster <b className="mono-num">{detail.data.cluster_id ?? '—'}</b> ·
                      {' '}{detail.data.related_accounts.length} related accounts
                    </p>
                    <Link to={`/accounts/${selected.id}`} className="btn w-full text-xs">
                      Open account
                    </Link>
                  </>
                )}
              </div>
            )}

            {selected && 'id' in selected && selected.kind !== 'account' && (
              <div className="space-y-3">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Stat label="Connected accounts" value={String(selected.meta.accounts)} />
                  <Stat label="Relationship strength" value={String(selected.meta.rarity)} />
                </dl>
                <p className="flex items-start gap-2 rounded-lg bg-moderate-bg px-3 py-2.5
                              text-[12px] leading-relaxed text-moderate-fg dark:bg-moderate/10
                              dark:text-moderate">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                  Shared infrastructure is not proof of fraud.
                </p>
              </div>
            )}

            {selected && !('id' in selected) && (
              <div className="space-y-2">
                <p className="text-[12.5px] leading-relaxed text-fg2">
                  {(selected as GraphEdge).detail}
                </p>
                <p className="mono-num text-[11.5px] text-fg3">
                  weight {(selected as GraphEdge).weight.toFixed(3)}
                </p>
              </div>
            )}
          </Panel>

          {active && (
            <Panel eyebrow="Cluster evidence" title={`Coordination ${active.coordination.coordination_risk.toFixed(1)}`}
                   alert={['HIGH', 'VERY HIGH'].includes(active.coordination.band)}>
              <div className="mb-3 flex items-center gap-2">
                <PriorityBadge priority={active.coordination.investigation_priority} />
                <RiskBadge band={active.coordination.band} size="sm" />
              </div>
              <ul className="space-y-1.5">
                {active.evidence_items.map((e, i) => {
                  const ids = spotlightFor(e.code, active);
                  const on = spotlight?.code === e.code;
                  return (
                    <li key={i}>
                      <button
                        onClick={() => { setSelected(null);
                                         setSpotlight(on ? null : { code: e.code, ids }); }}
                        disabled={ids.length === 0}
                        aria-pressed={on}
                        className={cx('w-full rounded-lg border px-3 py-2 text-left transition',
                          on ? 'border-ring2 bg-brand-tint dark:bg-raised'
                             : 'border-hairline bg-raised/60 hover:border-ring2',
                          ids.length === 0 && 'cursor-default opacity-90')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-semibold">{e.label}</span>
                          <RiskBadge band={e.strength} size="sm" />
                        </div>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-fg3">{e.detail}</p>
                        {ids.length > 0 && (
                          <p className="mt-1 text-[10.5px] font-medium text-fg2">
                            {on ? 'Highlighted in the graph — select again to clear'
                                : `Show the ${ids.length} entities involved`}
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-raised px-3 py-2.5 text-[11.5px]
                            leading-relaxed text-fg3">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
                No single shared attribute proves fraud. Multiple behavioural and relational
                signals strengthen investigation priority.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </PageTransition>
  );
}

/** Which graph nodes an evidence item is actually about.
 *  Structural evidence names its own entities; behavioural and temporal
 *  evidence is a property of the member accounts, so those light the accounts. */
function spotlightFor(code: string, c: Cluster): string[] {
  switch (code) {
    case 'shared_device':
      return Object.entries(c.shared_devices)
        .flatMap(([dev, accts]) => [dev, ...accts]);
    case 'shared_address':
      return Object.entries(c.shared_addresses)
        .flatMap(([addr, accts]) => [addr, ...accts]);
    case 'product_overlap':
      return [...c.shared_categories, ...c.account_ids];
    case 'claim_timing':
    case 'rate_tightness':
    case 'behavioural_similarity':
      return [...c.account_ids];
    default:
      return [];
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mono-num mt-0.5 truncate text-[13px] font-semibold">{value}</dd>
    </div>
  );
}
