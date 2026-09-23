import { Columns3, Download } from 'lucide-react';
import { useCallback, useState } from 'react';
import { RiskBadge } from '../risk';
import { downloadCsv } from '../../lib/download';
import { SCENARIO_LABEL, cx } from '../../lib/format';
import { api } from '../../services/api';
import { useApp } from '../../state/AppContext';
import type { Band, ScenarioId } from '../../types/models';

const ORDER: ScenarioId[] = ['normal', 'household', 'isolated', 'coordinated'];

export interface CompareRow {
  scenario: ScenarioId;
  individual: number; individualBand: Band;
  threshold: number; thresholdBand: Band;
  network: number; networkBand: Band;
  coordination: number; coordinationBand: Band;
  topCluster: string | null;
}

/** Runs every scenario through the same engines and tabulates the peak of each
 *  stream. Every number is an API response — nothing is written down here. */
export async function loadComparison(): Promise<CompareRow[]> {
  return Promise.all(ORDER.map(async (s): Promise<CompareRow> => {
    const [accounts, threshold, clusters] = await Promise.all([
      api.accounts(s), api.threshold(s), api.clusters(s),
    ]);

    const peakAccount = accounts.accounts.reduce(
      (a, b) => (b.individual_risk > a.individual_risk ? b : a));
    const peakCluster = clusters.clusters.length
      ? clusters.clusters.reduce((a, b) =>
          (b.coordination.coordination_risk > a.coordination.coordination_risk ? b : a))
      : null;
    const peakNetwork = clusters.clusters.length
      ? clusters.clusters.reduce((a, b) => (b.network_evidence > a.network_evidence ? b : a))
      : null;

    return {
      scenario: s,
      individual: peakAccount.individual_risk,
      individualBand: peakAccount.individual_band,
      threshold: threshold.bunching_score,
      thresholdBand: threshold.signal_band,
      network: peakNetwork?.network_evidence ?? 0,
      networkBand: peakNetwork?.network_band ?? 'LOW',
      coordination: peakCluster?.coordination.coordination_risk ?? 0,
      coordinationBand: peakCluster?.coordination.band ?? 'LOW',
      topCluster: peakCluster?.cluster_id ?? null,
    };
  }));
}

export function ScenarioCompare() {
  const { scenario, setScenario, pushToast } = useApp();
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      setRows(await loadComparison());
    } catch {
      pushToast({ title: 'Comparison failed', detail: 'Could not reach the API.', tone: 'warn' });
    } finally {
      setBusy(false);
    }
  }, [pushToast]);

  const exportCsv = () => {
    if (!rows) return;
    downloadCsv('refundshield-scenario-comparison.csv', [
      ['Scenario', 'Peak individual risk', 'Threshold signal', 'Peak network evidence',
       'Peak coordination risk', 'Top cluster'],
      ...rows.map((r) => [
        SCENARIO_LABEL[r.scenario], r.individual.toFixed(1), r.threshold.toFixed(1),
        r.network.toFixed(1), r.coordination.toFixed(1), r.topCluster ?? '—',
      ]),
    ]);
    pushToast({ title: 'Comparison exported', tone: 'success' });
  };

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Cross-scenario</p>
          <h3 className="text-[15px] font-bold tracking-tight">
            The same engines on four populations
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          {rows && (
            <button onClick={exportCsv} className="btn px-2.5 py-1.5 text-xs">
              <Download size={13} aria-hidden /> CSV
            </button>
          )}
          <button onClick={run} disabled={busy} className="btn btn-primary px-2.5 py-1.5 text-xs">
            <Columns3 size={13} aria-hidden />
            {busy ? 'Running…' : rows ? 'Re-run' : 'Compare scenarios'}
          </button>
        </div>
      </div>

      {!rows && !busy && (
        <p className="mt-3 text-[12px] leading-relaxed text-fg3">
          Scores every scenario and tabulates the peak of each evidence stream, so the
          contrast between a real ring and a legitimate household is visible in one table.
        </p>
      )}

      {rows && (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <caption className="sr-only">Peak score per evidence stream, by scenario</caption>
              <thead>
                <tr className="border-b border-hairline">
                  {['Scenario', 'Individual', 'Threshold', 'Network', 'Coordination'].map((h, i) => (
                    <th key={h} scope="col"
                        className={cx('px-2 py-2 font-mono text-2xs font-bold uppercase tracking-wider text-fg3',
                                      i === 0 ? 'text-left' : 'text-right')}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.scenario}
                      className={cx('border-b border-hairline last:border-0',
                                    r.scenario === scenario && 'bg-brand-tint/60 dark:bg-raised')}>
                    <td className="px-2 py-2.5">
                      <button onClick={() => setScenario(r.scenario)}
                              className="text-left text-[12.5px] font-medium hover:underline">
                        {SCENARIO_LABEL[r.scenario]}
                      </button>
                      {r.topCluster && (
                        <span className="mono-num ml-1.5 text-[10.5px] text-fg3">{r.topCluster}</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <RiskBadge band={r.individualBand} score={r.individual} size="sm" />
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <RiskBadge band={r.thresholdBand} score={r.threshold} size="sm" />
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <RiskBadge band={r.networkBand} score={r.network} size="sm" />
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <RiskBadge band={r.coordinationBand} score={r.coordination} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-fg3">
            Each cell is the peak of that stream in that population. Isolated abuse scores high
            individually but not on coordination; the household scores on network but is
            suppressed to LOW coordination; only the ring is high on both threshold and network.
            Select a scenario name to load it.
          </p>
        </>
      )}
    </div>
  );
}
