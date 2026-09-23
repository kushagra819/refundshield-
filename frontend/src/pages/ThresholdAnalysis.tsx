import { Activity, Info, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThresholdChart } from '../components/charts/ThresholdChart';
import { ThresholdSweep, type SweepPoint } from '../components/charts/ThresholdSweep';
import { ErrorState, PageHeader, PageTransition, SkeletonCard } from '../components/feedback';
import { Panel, RiskBadge, Tooltip } from '../components/risk';
import { FilterChip } from '../components/tables/DataTable';
import { useAsync, useCountUp, useDebounced } from '../hooks';
import { SCENARIO_LABEL, cx } from '../lib/format';
import { api } from '../services/api';
import { useApp } from '../state/AppContext';
import type { ThresholdBin } from '../types/models';

const PRESETS = [16, 18, 20, 22, 24];
const MIN_PCT = 12;
const MAX_PCT = 28;
const SWEEP_PCTS = [14, 16, 17, 18, 19, 20, 21, 22, 24, 26];

export function ThresholdAnalysis() {
  const { scenario, pushToast } = useApp();
  const [focused, setFocused] = useState(true);

  // null = use the seller's configured policy threshold (no override).
  const [override, setOverride] = useState<number | null>(null);
  const debounced = useDebounced(override, 180);
  const overrideValue = debounced === null ? undefined : debounced / 100;

  const [openBin, setOpenBin] = useState<ThresholdBin | null>(null);
  const [sweep, setSweep] = useState<SweepPoint[] | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const full = useAsync(() => api.threshold(scenario, overrideValue), [scenario, overrideValue]);
  const focus = useAsync(() => api.thresholdFocus(scenario, overrideValue),
                         [scenario, overrideValue]);

  // The seller's configured policy, captured from the first un-overridden load.
  const policyRef = useRef<number | null>(null);
  if (policyRef.current === null && full.data && debounced === null) {
    policyRef.current = full.data.threshold_pct;
  }
  const policyPct = policyRef.current ?? 20;
  const activePct = override ?? policyPct;
  const isOverridden = override !== null && Math.abs(override - policyPct) > 0.001;

  // Scenario change invalidates a sweep and any bin drill-down.
  useEffect(() => { setSweep(null); setOpenBin(null); }, [scenario]);
  useEffect(() => { setOpenBin(null); }, [debounced]);

  const runSweep = useCallback(async () => {
    setSweeping(true);
    try {
      const pts = await Promise.all(SWEEP_PCTS.map(async (pct) => {
        const r = await api.threshold(scenario, pct / 100);
        return { pct, signal: r.bunching_score };
      }));
      setSweep(pts);
      const peak = pts.reduce((a, b) => (b.signal > a.signal ? b : a));
      pushToast({
        title: `Signal peaks at ${peak.pct}%`,
        detail: `${peak.signal.toFixed(1)} of 100 — recomputed at ${pts.length} thresholds`,
        tone: 'success',
      });
    } catch {
      pushToast({ title: 'Sweep failed', detail: 'Could not reach the API.', tone: 'warn' });
    } finally {
      setSweeping(false);
    }
  }, [scenario, pushToast]);

  const t = full.data;
  const f = focus.data;

  const binAccounts = useMemo(() => {
    if (!openBin || !t) return [];
    return Object.values(t.account_signals)
      .filter((a) => a.return_rate_pct >= openBin.lower_pct
                  && a.return_rate_pct < openBin.upper_pct)
      .sort((a, b) => b.return_rate_pct - a.return_rate_pct);
  }, [openBin, t]);

  const error = full.error ?? focus.error;
  if (error) return <ErrorState message={error} onRetry={() => { full.reload(); focus.reload(); }} />;

  // First load only — afterwards keep the previous numbers on screen while the
  // engine recomputes, so dragging the slider never flashes skeletons.
  if (!t || !f) {
    return <div className="space-y-4"><SkeletonCard lines={2} />
      <div className="grid gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} lines={1} />)}
      </div><SkeletonCard lines={8} /></div>;
  }

  const busy = full.loading || focus.loading;
  const bins = focused ? f.bins : t.bins;

  return (
    <PageTransition>
      <PageHeader
        eyebrow={`Synthetic scenario · ${SCENARIO_LABEL[scenario]}`}
        title="Threshold Evasion"
        subtitle="Detect unusual concentration immediately below the seller's review threshold."
      />

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="space-y-4 self-start">
          <Panel eyebrow="Seller policy" title="Review threshold"
                 action={isOverridden ? (
                   <button onClick={() => setOverride(null)}
                           className="btn px-2 py-1 text-[11px]">
                     <RotateCcw size={11} aria-hidden /> Policy
                   </button>
                 ) : undefined}>
            <div className="text-center">
              <p className={cx('mono-num text-[52px] font-bold leading-none tracking-tight transition-colors',
                               isOverridden && 'text-high-fg dark:text-high')}>
                {activePct.toFixed(1)}%
              </p>
              <p className="mt-2 text-[11.5px] text-fg3">
                {isOverridden
                  ? `Overridden for analysis — seller policy is ${policyPct}%`
                  : 'Illustrative seller threshold — synthetic demonstration'}
              </p>
            </div>

            {/* ---- the live control ---- */}
            <div className="mt-4">
              <input
                type="range"
                min={MIN_PCT} max={MAX_PCT} step={0.5}
                value={activePct}
                onChange={(e) => setOverride(Number(e.target.value))}
                aria-label="Review threshold percentage"
                className="w-full accent-[#C1462F]"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-fg3">
                <span>{MIN_PCT}%</span><span>{MAX_PCT}%</span>
              </div>
              <div className="mt-2.5 grid grid-cols-5 gap-1">
                {PRESETS.map((p) => {
                  const on = Math.abs(activePct - p) < 0.001;
                  return (
                    <button
                      key={p}
                      onClick={() => setOverride(p)}
                      aria-pressed={on}
                      className={cx('rounded-full border py-1 text-[11px] font-medium transition',
                        on ? 'border-transparent bg-ink text-white'
                           : 'border-hairline bg-surface text-fg2 hover:border-ring2 hover:bg-raised')}
                    >
                      {p}%
                    </button>
                  );
                })}
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-fg3">
                Moving the line re-runs the bunching estimator on the server against the new
                threshold. Nothing here is precomputed.
              </p>
            </div>

            <div className={cx('mt-4 space-y-3 border-t border-hairline pt-4 transition-opacity',
                               busy && 'opacity-55')}>
              <Reading label="Observed" value={t.observed_count} />
              <Reading label="Expected" value={t.expected_count} decimals={2} />
              <Reading label="Excess" value={t.excess_count} decimals={2} signed
                       tone={t.excess_count > 0 ? 'high' : 'low'} />
              <Reading label="p-value" value={t.p_value} decimals={4} />
              <div className="flex items-center justify-between border-t border-hairline pt-3">
                <span className="text-[12.5px] font-semibold">Signal</span>
                <RiskBadge band={t.signal_band} score={t.bunching_score} />
              </div>
            </div>

            <dl className="mt-4 space-y-1.5 border-t border-hairline pt-3 text-[11px] text-fg3">
              <div className="flex justify-between gap-2">
                <dt>Eligible accounts</dt><dd className="mono-num">{t.eligible_accounts}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Excluded (too few orders)</dt><dd className="mono-num">{t.excluded_unreliable}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Review band</dt>
                <dd className="mono-num">{t.window_pct[0]}%–{t.window_pct[1]}%</dd>
              </div>
            </dl>
          </Panel>

          <Panel eyebrow="Specificity" title="Signal across thresholds"
                 action={
                   <button onClick={runSweep} disabled={sweeping}
                           className="btn px-2.5 py-1 text-[11px]">
                     <Activity size={11} aria-hidden />
                     {sweeping ? 'Running…' : sweep ? 'Re-run' : 'Run sweep'}
                   </button>
                 }>
            {sweep ? (
              <>
                <ThresholdSweep points={sweep} activePct={activePct} policyPct={policyPct} />
                <p className="mt-2 text-[11px] leading-relaxed text-fg3">
                  Each point is a separate engine run. A detector that simply rewarded
                  proximity to the line would be flat here.
                </p>
              </>
            ) : (
              <p className="py-5 text-center text-[12px] leading-relaxed text-fg3">
                Recompute the signal at {SWEEP_PCTS.length} thresholds to show where it
                actually peaks.
              </p>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel
            eyebrow="Return-rate distribution"
            title={focused
              ? `Accounts by return rate · ${f.range_pct[0]}%–${f.range_pct[1]}%`
              : 'Accounts by return rate · full population'}
            action={
              <div className="flex gap-1.5">
                <FilterChip label="Near threshold" active={focused} onClick={() => setFocused(true)} />
                <FilterChip label="Full population" active={!focused} onClick={() => setFocused(false)} />
              </div>
            }
          >
            <div className={cx('transition-opacity', busy && 'opacity-60')}>
              <ThresholdChart bins={bins} thresholdPct={t.threshold_pct}
                              windowPct={t.window_pct} height={320}
                              onSelectBin={(b) => setOpenBin(b.count > 0 ? b : null)} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline pt-3">
              <Legend color="#C1462F" label="Near-threshold review band" />
              <Legend color="#9FADC2" label="Reference region (fits the trend)" />
              <Legend color="#B7C0CE" label="Other bins" />
              <span className="flex items-center gap-1.5 text-[11px] text-fg2">
                <svg width="18" height="8" aria-hidden><line x1="0" y1="4" x2="18" y2="4"
                  stroke="#2E4059" strokeWidth="1.8" strokeDasharray="4 3" /></svg>
                Expected trend
              </span>
              <span className="ml-auto text-[11px] text-fg3">Click a bar to list its accounts</span>
            </div>

            {openBin && (
              <div className="mt-3 rounded-lg border border-hairline bg-raised/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12.5px] font-semibold">
                    <span className="mono-num">{openBin.lower_pct}%–{openBin.upper_pct}%</span>
                    {' · '}{binAccounts.length} account{binAccounts.length === 1 ? '' : 's'}
                    {openBin.role === 'window' && (
                      <span className="ml-2 font-mono text-[10px] font-bold uppercase
                                       tracking-wider text-high-fg dark:text-high">
                        inside review band
                      </span>
                    )}
                  </p>
                  <button onClick={() => setOpenBin(null)} aria-label="Close bin detail"
                          className="rounded p-1 text-fg3 hover:text-fg"><X size={14} aria-hidden /></button>
                </div>
                {openBin.expected !== null && (
                  <p className="mono-num mt-1 text-[11px] text-fg3">
                    expected {openBin.expected.toFixed(2)} · observed {openBin.count}
                  </p>
                )}
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {binAccounts.map((a) => (
                    <li key={a.account_id}
                        className="rounded-md border border-hairline bg-surface px-2 py-1">
                      <span className="mono-num text-[11.5px] font-semibold">{a.account_id}</span>
                      <span className="mono-num ml-1.5 text-[11px] text-fg3">
                        {a.return_rate_pct}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {focused && (
              <p className="mt-2 text-[11px] text-fg3">
                Focused on the region around the threshold. The full-population view includes the
                0% bin, which is large enough to compress this region visually. Same data, same
                method — only the visible range differs.
              </p>
            )}
          </Panel>

          <div className="grid gap-4 md:grid-cols-2">
            <Panel eyebrow="Why this matters" title="What the signal means">
              <p className="text-[13px] font-semibold leading-relaxed text-fg">
                {f.plain_english}
              </p>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-fg2">
                {t.explanation}
              </p>
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-raised px-3.5 py-2.5
                            text-[12px] leading-relaxed text-fg3">
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                This is a population-level anomaly signal. It does not independently establish fraud.
              </p>
            </Panel>

            <Panel eyebrow="Method" title="How the baseline is estimated"
                   action={<Tooltip text="The expected count comes from a straight-line fit through the reference bins below the window, extrapolated across it." />}>
              <p className="text-[12.5px] leading-relaxed text-fg2">
                {t.baseline_method.charAt(0).toUpperCase() + t.baseline_method.slice(1)}.
              </p>
              <ol className="mt-3 space-y-2 text-[12px] leading-relaxed text-fg2">
                {[
                  'Keep only accounts with enough orders for a reliable return rate.',
                  'Bin those rates in fixed-width bins.',
                  `Define the review band ${t.window_pct[0]}%–${t.window_pct[1]}% (half-open).`,
                  'Fit a trend through the reference bins below the band.',
                  'Compare observed against that trend, then test how surprising the gap is.',
                ].map((s, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mono-num shrink-0 text-[10.5px] font-bold text-fg3">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
              <p className="mt-3 rounded-lg bg-raised px-3.5 py-2.5 text-[11.5px] text-fg3">
                {t.caveat}
              </p>
            </Panel>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}

function Reading({ label, value, decimals = 0, signed, tone }: {
  label: string; value: number; decimals?: number; signed?: boolean; tone?: 'high' | 'low';
}) {
  const shown = useCountUp(value, 800, decimals);
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12.5px] text-fg2">{label}</span>
      <span className={cx('mono-num text-[17px] font-bold',
        tone === 'high' ? 'text-high-fg dark:text-high' : tone === 'low' ? 'text-fg' : 'text-fg')}>
        {signed && value > 0 ? '+' : ''}{shown.toFixed(decimals)}
      </span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-fg2">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}
