import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, PlayCircle, SkipForward, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorState, PageHeader, PageTransition, SkeletonCard } from '../components/feedback';
import { Reveal } from '../components/feedback/Reveal';
import { Panel, PriorityBadge, RiskBadge, ScoreRing } from '../components/risk';
import { ScenarioCompare } from '../components/evidence/ScenarioCompare';
import { useAsync } from '../hooks';
import { SCENARIO_LABEL, cx } from '../lib/format';
import { api } from '../services/api';
import { useApp } from '../state/AppContext';
import type { ScenarioId } from '../types/models';

const ORDER: ScenarioId[] = ['coordinated', 'household', 'isolated', 'normal'];

const STEPS = [
  'Five accounts detected',
  'All individually below threshold',
  'Population anomaly identified',
  'Cross-account relationships discovered',
  'Coordination evidence assembled',
  'Investigation priority elevated',
];

export function Scenarios() {
  const { scenario, setScenario, pushToast, reduceMotion } = useApp();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [demo, setDemo] = useState(params.get('demo') === '1');

  const list = useAsync(() => api.scenarios(), []);
  const dash = useAsync(() => api.dashboard(scenario), [scenario]);
  const clusters = useAsync(() => api.clusters(scenario), [scenario]);

  const top = clusters.data?.clusters?.[0] ?? null;

  useEffect(() => {
    if (params.get('demo') === '1') {
      setScenario('coordinated');
      setDemo(true);
    }
  }, [params, setScenario]);

  const load = (s: ScenarioId) => {
    setScenario(s);
    pushToast({ title: 'Scenario loaded', detail: SCENARIO_LABEL[s], tone: 'success' });
  };

  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Synthetic demonstration scenarios"
        title="Scenario Lab"
        subtitle="Four controlled populations. The same engines score every one of them."
        action={
          <button className="btn btn-primary"
                  onClick={() => { setScenario('coordinated'); setDemo(true); setParams({ demo: '1' }); }}>
            <PlayCircle size={15} aria-hidden /> Run hero investigation
          </button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {list.loading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={3} />)
          : ORDER.map((id, i) => {
              const s = list.data!.scenarios.find((x) => x.id === id)!;
              const activeCard = id === scenario;
              return (
                <Reveal
                  as="button"
                  key={id}
                  delay={reduceMotion ? 0 : i * 60}
                  onClick={() => load(id)}
                  className={cx('card card-hover p-4 text-left',
                    activeCard && 'ring-1 ring-ring2')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="eyebrow">{id}</p>
                    {activeCard && (
                      <span className="flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5
                                       text-[10px] font-bold text-brand dark:bg-raised dark:text-ring2">
                        <Check size={9} aria-hidden /> Active
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1.5 text-[14px] font-semibold leading-snug">{s.name}</h3>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg3">{s.summary}</p>
                  <p className="mt-2.5 border-t border-hairline pt-2.5 text-[11px] leading-relaxed text-fg2">
                    <span className="eyebrow block mb-1">Expected</span>
                    {s.expected}
                  </p>
                  <span className="mt-3 flex items-center gap-1 text-[11.5px] font-medium text-fg2">
                    Load scenario <ArrowRight size={12} aria-hidden />
                  </span>
                </Reveal>
              );
            })}
      </div>

      <div className="mt-4">
        <ScenarioCompare />
      </div>

      {/* current scenario summary */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <Panel eyebrow="Active scenario" title={SCENARIO_LABEL[scenario]}>
          {dash.loading || !dash.data ? (
            <div className="h-40 animate-pulse rounded-lg bg-hairline/40" />
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {dash.data.cards.map((c) => (
                <div key={c.key}>
                  <dt className="eyebrow">{c.label}</dt>
                  <dd className="mono-num mt-0.5 text-xl font-bold">{c.value}</dd>
                </div>
              ))}
              <div>
                <dt className="eyebrow">Return requests</dt>
                <dd className="mono-num mt-0.5 text-xl font-bold">
                  {dash.data.totals.return_requests}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Threshold signal</dt>
                <dd className="mt-1"><RiskBadge band={dash.data.threshold.band}
                                                score={dash.data.threshold.signal} /></dd>
              </div>
            </dl>
          )}
        </Panel>

        <Panel eyebrow="Top cluster" title={top ? `Cluster ${top.cluster_id}` : 'No clusters'}
               alert={top ? ['HIGH', 'VERY HIGH'].includes(top.coordination.band) : false}>
          {clusters.loading || !top ? (
            <div className="h-40 animate-pulse rounded-lg bg-hairline/40" />
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <ScoreRing score={top.coordination.coordination_risk} band={top.coordination.band}
                         label="Coordination risk" size={140} />
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex flex-wrap gap-2">
                  <PriorityBadge priority={top.coordination.investigation_priority} />
                  <RiskBadge band={top.network_band} score={top.network_evidence} size="sm" />
                </div>
                <p className="text-[12.5px] leading-relaxed text-fg2">
                  {top.size} accounts · rates {top.return_rate_range[0]}–{top.return_rate_range[1]}%
                  {' '}· benign factor {top.coordination.breakdown.benign_factor.toFixed(2)}
                </p>
                <ul className="space-y-1">
                  {top.evidence_items.slice(0, 3).map((e, i) => (
                    <li key={i} className="flex items-center gap-2 text-[11.5px] text-fg3">
                      <RiskBadge band={e.strength} size="sm" />
                      <span className="truncate">{e.label}</span>
                    </li>
                  ))}
                </ul>
                <button className="btn w-full text-xs" onClick={() => navigate('/network')}>
                  Open in network explorer
                </button>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <AnimatePresence>
        {demo && <HeroDemo onClose={() => { setDemo(false); setParams({}); }} />}
      </AnimatePresence>
    </PageTransition>
  );
}

/** The hero sequence. Every number shown is fetched from the API — the animation
 *  only controls WHEN a real value appears, never WHAT it is. */
function HeroDemo({ onClose }: { onClose: () => void }) {
  const { reduceMotion } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const hero = useAsync(() => api.clusters('coordinated'), []);
  const thr = useAsync(() => api.threshold('coordinated'), []);
  const why = useAsync(
    () => hero.data?.clusters?.[0]
      ? api.whyNotIndividual(hero.data.clusters[0].cluster_id, 'coordinated')
      : Promise.resolve(null),
    [hero.data?.clusters?.[0]?.cluster_id]);

  const cluster = hero.data?.clusters?.[0] ?? null;
  const ready = !!cluster && !!thr.data && !!why.data;

  const skip = useCallback(() => setStep(STEPS.length), []);

  useEffect(() => {
    if (!ready) return;
    if (reduceMotion) { setStep(STEPS.length); return; }
    if (step >= STEPS.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 700 : 1150);
    return () => clearTimeout(t);
  }, [ready, step, reduceMotion]);

  const done = step >= STEPS.length;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center px-4 py-8"
         role="dialog" aria-modal="true" aria-label="Hero investigation demo">
      <motion.div className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  onClick={onClose} />
      <motion.div
        className="relative max-h-full w-full max-w-[720px] overflow-y-auto rounded-2xl border
                   border-hairline bg-surface p-6 shadow-pop"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Hero investigation · synthetic demonstration</p>
            <h2 className="mt-1 text-[20px] font-bold tracking-tight">
              Potential coordinated return abuse
            </h2>
          </div>
          <div className="flex gap-1.5">
            {!done && (
              <button className="btn px-2.5 py-1.5 text-xs" onClick={skip}>
                <SkipForward size={12} aria-hidden /> Skip
              </button>
            )}
            <button className="btn px-2 py-1.5" onClick={onClose} aria-label="Close demo">
              <X size={14} aria-hidden />
            </button>
          </div>
        </div>

        {!ready ? (
          <div className="mt-6 h-56 animate-pulse rounded-xl bg-hairline/40" />
        ) : (
          <>
            <ol className="mt-5 space-y-2">
              {STEPS.map((s, i) => (
                <motion.li
                  key={s}
                  initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                  animate={i < step ? { opacity: 1, x: 0 } : { opacity: 0.28, x: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex items-center gap-3"
                >
                  <span className={cx(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                    i < step ? 'border-transparent bg-ink text-white' : 'border-hairline text-fg3')}>
                    {i < step ? <Check size={11} aria-hidden /> : i + 1}
                  </span>
                  <span className={cx('text-[13px]', i < step ? 'text-fg' : 'text-fg3')}>{s}</span>
                  {i === 1 && i < step && why.data && (
                    <span className="mono-num ml-auto text-[11.5px] text-fg3">
                      {why.data.rate_range_pct[0]}–{why.data.rate_range_pct[1]}%
                    </span>
                  )}
                  {i === 2 && i < step && (
                    <span className="mono-num ml-auto text-[11.5px] text-fg3">
                      {thr.data!.observed_count} vs {thr.data!.expected_count.toFixed(2)}
                    </span>
                  )}
                  {i === 3 && i < step && (
                    <span className="mono-num ml-auto text-[11.5px] text-fg3">
                      {Object.keys(cluster!.shared_devices).length} device ·{' '}
                      {Object.keys(cluster!.shared_addresses).length} address
                    </span>
                  )}
                </motion.li>
              ))}
            </ol>

            <AnimatePresence>
              {done && (
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-6 border-t border-hairline pt-6"
                >
                  <div className="flex flex-col items-center gap-5 sm:flex-row">
                    <ScoreRing score={cluster!.coordination.coordination_risk}
                               band={cluster!.coordination.band}
                               label="Coordination risk" size={156} />
                    <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left">
                      <PriorityBadge priority={cluster!.coordination.investigation_priority} />
                      <p className="text-[15px] font-bold">
                        {cluster!.coordination.recommended_action}
                      </p>
                      <p className="text-[12.5px] leading-relaxed text-fg3">
                        {cluster!.coordination.action_note}
                      </p>
                      <p className="rounded-lg bg-ink px-3.5 py-2.5 text-[13.5px] font-semibold text-white">
                        Individually normal. Collectively suspicious.
                      </p>
                      <button className="btn btn-primary w-full text-xs"
                              onClick={() => { onClose(); navigate('/network'); }}>
                        Open the investigation <ArrowRight size={13} aria-hidden />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </motion.div>
    </div>
  );
}
