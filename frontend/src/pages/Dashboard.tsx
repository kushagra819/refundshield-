import {
  ArrowRight, Boxes, FlaskConical, Gauge, Layers, PlayCircle, ScrollText, Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RiskDistribution } from '../components/charts/ThresholdChart';
import { ErrorState, PageHeader, PageTransition, SkeletonCard } from '../components/feedback';
import { Reveal } from '../components/feedback/Reveal';
import { Panel, PriorityBadge, RiskBadge, ScoreRing, Tooltip } from '../components/risk';
import { useAsync, useCountUp } from '../hooks';
import { BAND_STYLE, cx, SCENARIO_LABEL, pct } from '../lib/format';
import { api } from '../services/api';
import { useApp } from '../state/AppContext';
import type { Band, Cluster, DashboardCard, QueueRow } from '../types/models';

const CARD_ICON: Record<string, typeof Gauge> = {
  urgent: ScrollText, coordination: Layers, threshold: Gauge, clusters: Boxes,
};

export function Dashboard() {
  const { scenario } = useApp();
  const navigate = useNavigate();

  const dash = useAsync(() => api.dashboard(scenario), [scenario]);
  const clusters = useAsync(() => api.clusters(scenario), [scenario]);
  const queue = useAsync(() => api.queue(scenario), [scenario]);
  const activity = useAsync(() => api.activity(scenario, 7), [scenario]);
  const accounts = useAsync(() => api.accounts(scenario), [scenario]);

  const loading = dash.loading || clusters.loading || queue.loading;
  const error = dash.error ?? clusters.error ?? queue.error;

  const top = useMemo<Cluster | null>(() => {
    const list = clusters.data?.clusters ?? [];
    return list.length ? list[0] : null;
  }, [clusters.data]);

  const distributions = useMemo(() => {
    const rows = accounts.data?.accounts ?? [];
    const buckets = (pick: (r: typeof rows[number]) => number) => {
      const b = { LOW: 0, MODERATE: 0, HIGH: 0, 'VERY HIGH': 0 } as Record<Band, number>;
      rows.forEach((r) => {
        const v = pick(r);
        const key: Band = v >= 80 ? 'VERY HIGH' : v >= 60 ? 'HIGH' : v >= 30 ? 'MODERATE' : 'LOW';
        b[key] += 1;
      });
      return Object.entries(b).map(([label, value]) => ({ label: label.split(' ')[0], value }));
    };
    return {
      individual: buckets((r) => r.individual_risk),
      coordination: buckets((r) => r.coordination_risk),
      threshold: buckets((r) => r.threshold_signal),
    };
  }, [accounts.data]);

  if (error) return <ErrorState message={error} onRetry={() => { dash.reload(); clusters.reload(); queue.reload(); }} />;

  return (
    <PageTransition>
      <PageHeader
        eyebrow={`Synthetic scenario · ${SCENARIO_LABEL[scenario]}`}
        title="Good morning, Investigator."
        subtitle="Here's what requires attention in your synthetic investigation environment."
        action={
          <Link to="/scenarios?demo=1" className="btn btn-primary">
            <PlayCircle size={15} aria-hidden /> Run hero investigation
          </Link>
        }
      />

      {/* ---- metric cards ---- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={1} />)
          : dash.data!.cards.map((c, i) => (
              <StatCard key={c.key} card={c} index={i}
                        onClick={() => navigate(c.link === 'queue' ? '/investigations'
                          : c.link === 'threshold' ? '/threshold' : '/network')} />
            ))}
      </div>

      {/* ---- coordination watch + feed ---- */}
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Panel
          eyebrow="Coordination watch"
          title={top ? `Cluster ${top.cluster_id} · ${top.size} linked accounts` : 'No active clusters'}
          alert={top?.coordination.band === 'HIGH' || top?.coordination.band === 'VERY HIGH'}
          action={top && (
            <Link to="/network" className="btn px-2.5 py-1.5 text-xs">
              Investigate <ArrowRight size={13} aria-hidden />
            </Link>
          )}
        >
          {loading || !top ? (
            <div className="h-[200px] animate-pulse rounded-lg bg-hairline/40" />
          ) : (
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
              <div className="shrink-0">
                <ScoreRing score={top.coordination.coordination_risk}
                           band={top.coordination.band} label="Coordination risk" />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityBadge priority={top.coordination.investigation_priority} />
                  <span className="text-[12px] text-fg3">
                    {top.coordination.independent_evidence_count} independent evidence categories
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
                  <Metric label="Return-rate range"
                          value={`${top.return_rate_range[0]}–${top.return_rate_range[1]}%`} />
                  <Metric label="Seller threshold"
                          value={pct(dash.data!.threshold.value * 100, 0)} />
                  <Metric label="Network evidence" value={top.network_evidence.toFixed(1)}
                          band={top.network_band} />
                  <Metric label="Threshold signal"
                          value={top.coordination.breakdown.threshold_evasion_signal.toFixed(1)} />
                  <Metric label="Individual context"
                          value={top.coordination.breakdown.individual_risk_context.toFixed(1)} />
                  <Metric label="Benign factor"
                          value={top.coordination.breakdown.benign_factor.toFixed(2)} />
                </dl>
                <p className="rounded-lg bg-raised px-3.5 py-2.5 text-[12px] leading-relaxed text-fg2">
                  {top.coordination.recommended_action} — {top.coordination.action_note}
                </p>
              </div>
            </div>
          )}
        </Panel>

        <Panel
          eyebrow="Investigation feed"
          title="Recent signals"
          action={<span className="rounded-full bg-moderate-bg px-2 py-0.5 font-mono text-[9.5px]
                                   font-bold uppercase tracking-wider text-moderate-fg
                                   dark:bg-moderate/15 dark:text-moderate">Synthetic demo</span>}
        >
          {activity.loading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) =>
              <div key={i} className="h-12 animate-pulse rounded-lg bg-hairline/40" />)}</div>
          ) : (
            <ul className="space-y-1">
              {(activity.data?.events ?? []).map((e, i) => (
                <Reveal as="li"
                  key={`${e.kind}-${e.subject}-${i}`}
                  delay={Math.min(i * 35, 210)}
                  className="flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-raised"
                >
                  <span className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                                      BAND_STYLE[e.band].dot)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium leading-snug">{e.title}</p>
                    <p className="mono-num truncate text-[11px] text-fg3">{e.subject}</p>
                    <p className="truncate text-[11px] text-fg3">{e.detail}</p>
                  </div>
                </Reveal>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ---- distributions + queue preview ---- */}
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-3">
        <Panel eyebrow="Risk distribution" title="Individual risk"
               action={<Tooltip text="How each account's own return behaviour scores, across the population." />}>
          <RiskDistribution data={distributions.individual} color="#2E4059" />
        </Panel>
        <Panel eyebrow="Risk distribution" title="Coordination risk"
               action={<Tooltip text="Combines individual, threshold and network evidence to prioritise cases for human review." />}>
          <RiskDistribution data={distributions.coordination} color="#C1462F" />
        </Panel>
        <Panel eyebrow="Risk distribution" title="Threshold signals"
               action={<Tooltip text="Measures unusual concentration of accounts immediately below the seller's review threshold." />}>
          <RiskDistribution data={distributions.threshold} color="#9A6B12" />
        </Panel>
      </div>

      <Panel className="mt-4" eyebrow="Investigation queue" title="Highest priority right now"
             action={<Link to="/investigations" className="btn px-2.5 py-1.5 text-xs">
               View all <ArrowRight size={13} aria-hidden /></Link>}>
        <ul className="divide-y divide-hairline">
          {(queue.data?.queue ?? []).slice(0, 5).map((r: QueueRow) => (
            <li key={r.return_id}>
              <Link to={`/investigations/${r.return_id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-2 py-2.5
                               transition hover:bg-raised">
                <PriorityBadge priority={r.priority} />
                <span className="mono-num text-[12.5px] font-semibold">{r.return_id}</span>
                <span className="mono-num text-[12px] text-fg3">{r.account_id}</span>
                <span className="mono-num text-[12px] text-fg3">{r.return_rate_pct}%</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg3">
                  {r.primary_reasons.join(' · ')}
                </span>
                <RiskBadge band={r.coordination_band} score={r.coordination_risk} size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </PageTransition>
  );
}

function StatCard({ card, index, onClick }: {
  card: DashboardCard; index: number; onClick: () => void;
}) {
  const value = useCountUp(card.value, 900);
  const Icon = CARD_ICON[card.key] ?? Users;
  return (
    <Reveal as="button" delay={Math.min(index * 55, 220)} onClick={onClick}
            className="card card-hover group p-4 text-left">
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">{card.label}</p>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg
                         bg-hairline/50 text-fg3 transition group-hover:text-fg2">
          <Icon size={14} aria-hidden />
        </span>
      </div>
      <p className="mono-num mt-2 text-[28px] font-bold leading-none tracking-tight">{value}</p>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <RiskBadge band={card.band} size="sm" />
        <ArrowRight size={13} aria-hidden
                    className="text-fg3 opacity-0 transition group-hover:opacity-100" />
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-fg3">{card.hint}</p>
    </Reveal>
  );
}

function Metric({ label, value, band }: { label: string; value: string; band?: Band }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mono-num mt-0.5 flex items-center gap-1.5 text-[14px] font-semibold">
        {value}
        {band && <span className={cx('font-mono text-[9.5px] font-bold', BAND_STYLE[band].text)}>
          {band}</span>}
      </dd>
    </div>
  );
}

export { FlaskConical };
