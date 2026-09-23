import { AlertTriangle, ArrowRight, Rocket } from 'lucide-react';
import { ErrorState, PageHeader, PageTransition, SkeletonCard } from '../components/feedback';
import { Panel } from '../components/risk';
import { useAsync } from '../hooks';
import { api } from '../services/api';

const STREAMS: [string, string][] = [
  ['Individual return risk',
    'A transparent, additive rule score over one account’s own behaviour. A rate below the seller’s threshold contributes very little by design — which is exactly why a ring parked underneath it cannot be found this way.'],
  ['Threshold-evasion signal',
    'A population-level bunching estimator. It asks whether more accounts sit just below the review threshold than the surrounding distribution can account for, and gates proximity so that being near the line is not, by itself, suspicious.'],
  ['Network evidence',
    'A relationship graph over shared devices, addresses, products and claim timing. Links are weighted by how rare the shared entity is, and no single relationship type can carry a case.'],
];

export function About() {
  const { data, loading, error, reload } = useAsync(() => api.limitations(), []);

  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <PageTransition>
      <PageHeader
        eyebrow="System"
        title="About RefundShield"
        subtitle="Detect the fraud ring that stays below the radar. CX0507 — The Fraudulent Refund Loop."
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Panel eyebrow="How it works" title="Three independent evidence streams">
          <ol className="space-y-3">
            {STREAMS.map(([title, body], i) => (
              <li key={title} className="flex gap-3.5">
                <span className="mono-num shrink-0 pt-0.5 text-[11px] font-bold text-fg3">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <p className="text-[13.5px] font-semibold">{title}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-fg3">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-raised px-3.5 py-2.5
                        text-[12.5px] text-fg2">
            Combined into a coordination score
            <ArrowRight size={13} aria-hidden />
            prioritised for a human investigator
          </p>
        </Panel>

        <div className="space-y-4">
          <Panel eyebrow="Boundaries" title="Current prototype limitations">
            {loading || !data ? <SkeletonCard lines={5} /> : (
              <>
                <p className="mb-3 flex items-start gap-2 text-[12px] leading-relaxed text-fg3">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-moderate" aria-hidden />
                  These mark the boundary between a prototype demonstration and a production
                  deployment — not defects.
                </p>
                <ul className="space-y-2">
                  {data.limitations.map((l) => (
                    <li key={l} className="flex gap-2.5 text-[12.5px] leading-relaxed text-fg2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-fg3" aria-hidden />
                      {l}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel eyebrow="Roadmap" title="Production evolution">
            {loading || !data ? <SkeletonCard lines={4} /> : (
              <ol className="space-y-2">
                {data.production_evolution.map((p, i) => (
                  <li key={p} className="flex gap-3 text-[12.5px] leading-relaxed text-fg2">
                    <span className="mono-num shrink-0 text-[11px] font-bold text-fg3">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {p}
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-raised px-3.5 py-2.5 text-[11.5px]
                          leading-relaxed text-fg3">
              <Rocket size={12} className="mt-0.5 shrink-0" aria-hidden />
              Not yet implemented. Listed so the gap between this prototype and a deployable
              system is explicit.
            </p>
          </Panel>

          <Panel eyebrow="Environment" title="Synthetic demonstration">
            <p className="text-[12.5px] leading-relaxed text-fg2">
              {data?.synthetic_notice ?? 'Synthetic demonstration environment — no real customer data.'}
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-fg3">{data?.scoring_notice}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-hairline pt-3 text-[12px]">
              <div><dt className="eyebrow">Problem</dt><dd className="mt-0.5">CX0507</dd></div>
              <div><dt className="eyebrow">Theme</dt>
                   <dd className="mt-0.5">FinTech &amp; Digital Payments</dd></div>
              <div><dt className="eyebrow">Team</dt>
                   <dd className="mt-0.5">The Anomaly Syndicate</dd></div>
              <div><dt className="eyebrow">Build</dt>
                   <dd className="mono-num mt-0.5">Round 2 prototype</dd></div>
            </dl>
          </Panel>
        </div>
      </div>
    </PageTransition>
  );
}
