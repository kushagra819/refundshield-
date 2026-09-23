import { motion } from 'framer-motion';
import {
  ArrowLeft, CheckCircle2, Download, FileQuestion, ShieldAlert, StickyNote, Eye,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorState, PageTransition, SkeletonCard } from '../components/feedback';
import { AhaMoment, EvidenceGroups, WhyPrioritised } from '../components/evidence';
import { NetworkGraph } from '../components/network/NetworkGraph';
import { MeterRow, Panel, PriorityBadge, RiskBadge, ScoreCard } from '../components/risk';
import { Timeline } from '../components/timeline/Timeline';
import { useAsync } from '../hooks';
import { downloadJson } from '../lib/download';
import { cx, inr, shortDate } from '../lib/format';
import { api } from '../services/api';
import { useApp } from '../state/AppContext';
import type { CaseState, GraphEdge, GraphNode } from '../types/models';

const ACTION_ICON: Record<string, typeof Eye> = {
  review: Eye, request_evidence: FileQuestion,
  approve_refund: CheckCircle2, escalate: ShieldAlert,
};

export function InvestigationDetail() {
  const { returnId = '' } = useParams();
  const { scenario, pushToast } = useApp();
  const navigate = useNavigate();

  const { data, loading, error, reload } = useAsync(
    () => api.investigation(returnId, scenario), [returnId, scenario]);
  const net = useAsync(
    () => data ? api.network(data.return.account_id, scenario) : Promise.resolve(null),
    [data?.return.account_id, scenario]);

  const { logEvent, log } = useApp();
  const [caseState, setCaseState] = useState<CaseState | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<GraphNode | GraphEdge | null>(null);

  useEffect(() => {
    if (data) { setCaseState(data.case_state); setNotes(data.case_state.notes); }
  }, [data]);

  if (error) return <ErrorState message={error} onRetry={reload} title="Unable to load investigation data." />;
  if (loading || !data) {
    return (
      <div className="space-y-4">
        <SkeletonCard lines={2} />
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={1} />)}
        </div>
        <SkeletonCard lines={6} />
      </div>
    );
  }

  const { risk_summary: rs, account, cluster } = data;
  const state = caseState ?? data.case_state;
  const caseLog = log.filter((e) => e.subject === data.return.return_id);

  const applyAction = async (action: string, label: string) => {
    setBusy(true);
    try {
      const res = await api.applyAction(data.return.return_id, scenario, action, notes || undefined);
      setCaseState(res.case_state);
      logEvent({ subject: data.return.return_id, action: label, detail: res.case_state.status });
      pushToast({ title: label, detail: res.case_state.notice, tone: 'success' });
    } catch {
      pushToast({ title: 'Action could not be recorded', tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    setBusy(true);
    try {
      const res = await api.saveNotes(data.return.return_id, scenario, notes);
      setCaseState(res.case_state);
      logEvent({ subject: data.return.return_id, action: 'Note added' });
      pushToast({ title: 'Case notes saved', detail: res.case_state.notice });
    } catch {
      pushToast({ title: 'Notes could not be saved', tone: 'warn' });
    } finally { setBusy(false); }
  };

  const exportSummary = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      environment: 'Synthetic demonstration — no real customer data',
      scenario,
      investigation: {
        return_id: data.return.return_id,
        account_id: data.return.account_id,
        claim_type: data.return.claim_type,
        refund_inr: data.return.refund_inr,
        filed_on: data.return.filed_on,
      },
      scores: {
        individual_risk: rs.individual.score,
        individual_band: rs.individual.band,
        threshold_signal: rs.threshold.score,
        threshold_band: rs.threshold.band,
        network_evidence: rs.network.score,
        network_band: rs.network.band,
        coordination_risk: rs.coordination.score,
        coordination_band: rs.coordination.band,
        investigation_priority: rs.priority,
      },
      cluster: cluster ? {
        cluster_id: cluster.cluster_id,
        account_ids: cluster.account_ids,
        return_rate_range: cluster.return_rate_range,
        evidence: cluster.evidence_items.map((e) => ({
          label: e.label, strength: e.strength, detail: e.detail,
        })),
      } : null,
      primary_reasons: data.primary_reasons,
      recommended_action: data.recommended_action,
      case_state: { status: state.status, notes: state.notes },
      local_audit_trail: caseLog.map((e) => ({ at: e.at, action: e.action, detail: e.detail })),
      notice: data.scoring_notice,
    };
    downloadJson(`${data.return.return_id}-summary.json`, payload);
    logEvent({ subject: data.return.return_id, action: 'Summary exported' });
    pushToast({ title: 'Summary exported', detail: `${data.return.return_id}-summary.json`,
                tone: 'success' });
  };

  return (
    <PageTransition>
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="btn px-2.5 py-1.5 text-xs">
          <ArrowLeft size={13} aria-hidden /> Back
        </button>
        <button onClick={exportSummary} className="btn ml-auto px-2.5 py-1.5 text-xs">
          <Download size={13} aria-hidden /> Export summary
        </button>
      </div>

      {/* ---- header ---- */}
      <div className="card mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">
              Investigation · {data.cluster_id ?? 'No linked group'}
            </p>
            <h1 className="mt-1.5 text-[24px] font-bold leading-tight tracking-[-0.02em]">
              {data.explanation.headline}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px] text-fg3">
              <Field label="Return" value={data.return.return_id} mono />
              <Field label="Account" value={data.return.account_id} mono />
              <Field label="Order" value={data.return.order_id} mono />
              <Field label="Claim" value={data.return.claim_type} />
              <Field label="Refund" value={inr(data.return.refund_inr)} mono />
              <Field label="Filed" value={shortDate(data.return.filed_on)} />
              <Field label="Account age" value={`${data.return.account_age_days} days`} />
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <PriorityBadge priority={rs.priority} />
            <span className="rounded-full bg-raised px-2.5 py-1 text-[11.5px] text-fg2">
              {state.status}
            </span>
          </div>
        </div>
      </div>

      {/* ---- risk overview ---- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ScoreCard label="Individual risk" score={rs.individual.score} band={rs.individual.band}
                   delay={0} hint="How this account's own return behaviour scores on its own." />
        <ScoreCard label="Threshold signal" score={rs.threshold.score} band={rs.threshold.band}
                   delay={0.06}
                   hint="Measures unusual concentration of accounts immediately below the seller's review threshold." />
        <ScoreCard label="Network evidence" score={rs.network.score} band={rs.network.band}
                   delay={0.12}
                   hint="Measures relationships between accounts based on shared or similar attributes." />
        <ScoreCard label="Coordination risk" score={rs.coordination.score}
                   band={rs.coordination.band} delay={0.18} accent
                   hint="Combines individual, threshold and network evidence to prioritise cases for human review." />
      </div>
      <p className="mt-2 text-[11px] text-fg3">{rs.notice}</p>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="min-w-0 space-y-4">
          {data.why_not_individual && cluster && (
            <Panel eyebrow="The signature moment" title="Why individual scoring did not catch this">
              <AhaMoment
                why={data.why_not_individual}
                thresholdSignal={rs.threshold.score}
                networkEvidence={rs.network.score}
                coordination={rs.coordination.score}
                band={rs.coordination.band}
              />
            </Panel>
          )}

          <Panel eyebrow="Explainability" title="Why was this case prioritised?">
            <WhyPrioritised explanation={data.explanation} />
          </Panel>

          {net.data && net.data.nodes.length > 0 && (
            <Panel eyebrow="Relationship graph" title="How these accounts connect">
              <NetworkGraph
                nodes={net.data.nodes}
                edges={net.data.edges}
                selectedId={selected && 'id' in selected ? selected.id : null}
                onSelectNode={(n) => setSelected(n)}
                onSelectEdge={(e) => setSelected(e)}
              />
              <div className="mt-3 min-h-[54px] rounded-lg bg-raised px-3.5 py-2.5 text-[12px]
                              leading-relaxed text-fg2">
                {selected === null && 'Select a node or a relationship to see the evidence behind it.'}
                {selected && 'id' in selected && (
                  <>
                    <b className="mono-num">{selected.label}</b>
                    {' — '}
                    {selected.kind === 'account'
                      ? `return rate ${selected.meta.return_rate_pct}%, ${selected.meta.orders} orders, ${selected.meta.returns} returns.`
                      : `shared by ${selected.meta.accounts} accounts (rarity ${selected.meta.rarity}).`}
                    {selected.kind !== 'account' && (
                      <span className="mt-1 block text-fg3">
                        Shared infrastructure is not proof of fraud.
                      </span>
                    )}
                  </>
                )}
                {selected && 'kind' in selected && !('id' in selected) && (
                  <><b>{(selected as GraphEdge).label}</b> — {(selected as GraphEdge).detail}</>
                )}
              </div>
              <p className="mt-2 text-[11px] text-fg3">{net.data.caveat}</p>
            </Panel>
          )}

          <Panel eyebrow="Evidence" title="Grouped evidence for this account">
            <EvidenceGroups groups={account.evidence_groups} />
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          {cluster && (
            <Panel eyebrow="Coordination score" title="How the score is built">
              <MeterRow label="Individual risk context" band={rs.individual.band}
                        score={cluster.coordination.breakdown.individual_risk_context}
                        weight={`×${cluster.coordination.breakdown.weights.individual}`} />
              <MeterRow label="Threshold-evasion signal" band={rs.threshold.band}
                        score={cluster.coordination.breakdown.threshold_evasion_signal}
                        weight={`×${cluster.coordination.breakdown.weights.threshold}`} />
              <MeterRow label="Network evidence" band={rs.network.band}
                        score={cluster.coordination.breakdown.network_evidence}
                        weight={`×${cluster.coordination.breakdown.weights.network}`} />
              <div className="flex items-center justify-between border-t border-hairline pt-2.5
                              text-[12.5px] text-fg3">
                <span>× benign-household factor</span>
                <span className="mono-num font-semibold">
                  {cluster.coordination.breakdown.benign_factor.toFixed(2)}
                </span>
              </div>
              <div className="mt-2.5 flex items-center justify-between border-t-2 border-fg pt-2.5">
                <span className="text-sm font-bold">Coordination risk</span>
                <span className="mono-num text-lg font-bold">
                  {cluster.coordination.breakdown.coordination_risk.toFixed(1)}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-fg3">
                {cluster.coordination.breakdown.notice}
              </p>
            </Panel>
          )}

          <Panel eyebrow="Human-in-the-loop" title="Investigator action">
            <p className="mb-3 rounded-lg bg-raised px-3.5 py-2.5 text-[12px] leading-relaxed text-fg2">
              <b>{data.recommended_action}</b> — {data.action_note}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {data.available_actions.map((a) => {
                const Icon = ACTION_ICON[a.key] ?? Eye;
                return (
                  <button key={a.key} disabled={busy}
                          onClick={() => applyAction(a.key, a.label)}
                          className={cx('btn justify-start text-xs',
                            a.key === 'escalate' && 'btn-primary')}>
                    <Icon size={13} aria-hidden /> {a.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 text-[11px] text-fg3">{state.notice}</p>

            <div className="mt-4">
              <label htmlFor="case-notes" className="eyebrow flex items-center gap-1.5">
                <StickyNote size={11} aria-hidden /> Case notes
              </label>
              <textarea
                id="case-notes" rows={3} value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Record what you checked before deciding…"
                className="mt-1.5 w-full resize-y rounded-lg border border-hairline bg-canvas p-2.5
                           text-[12.5px] placeholder:text-fg3 focus:border-ring2 focus:bg-surface"
              />
              <button className="btn mt-2 w-full text-xs" onClick={saveNotes} disabled={busy}>
                Save notes
              </button>
            </div>

            {state.history.length > 0 && (
              <ul className="mt-4 space-y-1 border-t border-hairline pt-3">
                {state.history.map((h, i) => (
                  <motion.li key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                             className="flex items-center justify-between text-[11.5px]">
                    <span className="text-fg2">{h.label}</span>
                    <span className="text-fg3">{h.status}</span>
                  </motion.li>
                ))}
              </ul>
            )}
          </Panel>

          {caseLog.length > 0 && (
            <Panel eyebrow="Audit trail" title="This session"
                   action={
                     <span className="text-[10.5px] text-fg3">{caseLog.length} recorded</span>
                   }>
              <ol className="space-y-1.5">
                {[...caseLog].reverse().map((e) => (
                  <li key={e.id} className="flex items-start gap-2.5">
                    <span className="mono-num mt-0.5 shrink-0 text-[10px] text-fg3">
                      {new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-medium">{e.action}</span>
                      {e.detail && <span className="block text-[11px] text-fg3">{e.detail}</span>}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[10.5px] text-fg3">
                Recorded in this browser only. The backend holds the authoritative case status.
              </p>
            </Panel>
          )}

          {data.timeline.events.length > 0 && (
            <Panel eyebrow="Timeline" title="Recorded activity">
              <Timeline data={data.timeline} limit={14} />
            </Panel>
          )}

          <Panel eyebrow="Account" title={account.verdict}>
            <p className="text-[12.5px] leading-relaxed text-fg2">{account.rationale}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
              <Stat label="Orders" value={String(account.orders)} />
              <Stat label="Returns" value={String(account.returns)} />
              <Stat label="Return rate" value={`${account.return_rate_pct}%`} />
              <Stat label="Related accounts" value={String(account.related_accounts.length)} />
            </dl>
            <Link to={`/accounts/${account.account_id}`} className="btn mt-3 w-full text-xs">
              Open account investigation
            </Link>
          </Panel>
        </div>
      </div>
    </PageTransition>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="eyebrow">{label}</span>
      <span className={cx('text-[12.5px] text-fg2', mono && 'font-mono')}>{value}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mono-num mt-0.5 text-[14px] font-semibold">{value}</dd>
    </div>
  );
}

export { RiskBadge };
