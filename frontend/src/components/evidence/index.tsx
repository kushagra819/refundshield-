import {
  ArrowDown, Boxes, CalendarClock, Fingerprint, Gauge, MapPin, ShieldAlert, User,
} from 'lucide-react';
import { useInView } from '../../hooks';
import { BAND_STYLE, cx } from '../../lib/format';
import { useApp } from '../../state/AppContext';
import type { Band, EvidenceGroup, Explanation, WhyNotIndividual } from '../../types/models';
import { RiskBadge } from '../risk';
import { Reveal } from '../feedback/Reveal';

const CATEGORY_ICON: Record<string, typeof Gauge> = {
  INDIVIDUAL: User, THRESHOLD: Gauge, RELATIONAL: Fingerprint,
  TEMPORAL: CalendarClock, BEHAVIOURAL: Boxes,
};

/** The numbered "why was this prioritised" story. Items reveal on scroll. */
export function WhyPrioritised({ explanation }: { explanation: Explanation }) {
  const { reduceMotion } = useApp();
  const { ref, seen } = useInView<HTMLOListElement>();
  return (
    <div>
      <ol ref={ref} className="space-y-0">
        {explanation.reasons.map((reason, i) => (
          <Reveal
            as="li"
            key={i}
            delay={reduceMotion || !seen ? 0 : Math.min(i * 28, 260)}
            className="flex gap-4 border-b border-hairline py-3 last:border-0"
          >
            <span className="mono-num shrink-0 pt-0.5 text-[11px] font-bold text-fg3">
              {String(i + 1).padStart(2, '0')}
            </span>
            <p className="text-[13.5px] leading-relaxed text-fg2">{reason}</p>
          </Reveal>
        ))}
      </ol>
      <div className="mt-4 rounded-lg bg-raised px-4 py-3">
        <p className="text-[12.5px] leading-relaxed text-fg2">{explanation.closing}</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-fg3">{explanation.caveat}</p>
      </div>
    </div>
  );
}

export function EvidenceGroups({ groups }: { groups: EvidenceGroup[] }) {
  const { reduceMotion } = useApp();
  if (!groups.length) {
    return <p className="py-6 text-center text-sm text-fg3">No evidence items for this account.</p>;
  }
  return (
    <div className="space-y-5">
      {groups.map((g, gi) => {
        const Icon = CATEGORY_ICON[g.category] ?? ShieldAlert;
        return (
          <Reveal key={g.category} delay={reduceMotion ? 0 : Math.min(gi * 40, 200)}>
            <div className="mb-2 flex items-center gap-2">
              <Icon size={13} className="text-fg3" aria-hidden />
              <h3 className="font-mono text-2xs font-bold uppercase tracking-[0.12em] text-fg2">
                {g.category}
              </h3>
              <span className="truncate text-[11px] text-fg3">{g.hint}</span>
            </div>
            <ul className="space-y-1.5">
              {g.items.map((item, i) => (
                <li key={i} className="rounded-lg border border-hairline bg-raised/60 px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold">{item.title}</p>
                    <div className="flex items-center gap-2">
                      <span className="mono-num text-[12px] text-fg2">{item.value}</span>
                      <RiskBadge band={item.strength as Band} size="sm" />
                    </div>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-fg3">{item.explanation}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        );
      })}
    </div>
  );
}

/** The signature moment: five individually-normal accounts becoming one case. */
export function AhaMoment({ why, thresholdSignal, networkEvidence, coordination, band }: {
  why: WhyNotIndividual;
  thresholdSignal: number;
  networkEvidence: number;
  coordination: number;
  band: Band;
}) {
  const { reduceMotion } = useApp();
  const { ref, seen } = useInView<HTMLDivElement>();
  const step = (i: number) => ({ delay: reduceMotion || !seen ? 0 : Math.min(80 * i, 240) });

  return (
    <div ref={ref} className="space-y-4">
      <Reveal {...step(0)}>
        <p className="eyebrow">Individual view</p>
        <h3 className="mt-1 text-[15px] font-semibold">
          {why.all_individually_low
            ? `All ${why.accounts.length} accounts look acceptable on their own`
            : 'How each account scores on its own'}
        </h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {why.accounts.map((a, i) => (
            <Reveal
              key={a.account_id}
              delay={reduceMotion || !seen ? 0 : Math.min(50 * i, 220)}
              className="rounded-lg border border-hairline bg-raised/60 px-3 py-2.5 text-center"
            >
              <p className="mono-num text-[11.5px] font-semibold text-fg2">{a.account_id}</p>
              <p className="mono-num mt-1 text-lg font-bold leading-none">{a.return_rate_pct}%</p>
              <div className="mt-2 flex justify-center">
                <RiskBadge band={a.individual_band} score={a.individual_risk} size="sm" />
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-3 rounded-lg bg-low-bg px-3.5 py-2.5 text-[12.5px] leading-relaxed
                      text-low-fg dark:bg-low/10 dark:text-low">
          {why.explanation}
        </p>
      </Reveal>

      <Reveal {...step(1)} className="flex items-center gap-3 px-1">
        <ArrowDown size={15} className="shrink-0 text-fg3" aria-hidden />
        <p className="text-[13px] font-semibold text-fg2">{why.consequence}</p>
      </Reveal>

      <Reveal {...step(2)} className="grid gap-3 sm:grid-cols-3">
        <StepTile label="Threshold signal" value={thresholdSignal}
                  caption={`Seller threshold ${why.threshold_pct}%`} />
        <StepTile label="Network evidence" value={networkEvidence}
                  caption={`${why.accounts.length} linked accounts`} />
        <StepTile label="Coordination risk" value={coordination} band={band} accent
                  caption="Combined evidence" />
      </Reveal>

      <Reveal as="p" {...step(3)}
        className="rounded-lg bg-ink px-4 py-3.5 text-center text-[15px] font-semibold text-white">
        Individually normal. Collectively suspicious.
      </Reveal>
    </div>
  );
}

function StepTile({ label, value, caption, band, accent }: {
  label: string; value: number; caption: string; band?: Band; accent?: boolean;
}) {
  const b: Band = band ?? (value >= 80 ? 'VERY HIGH' : value >= 60 ? 'HIGH'
    : value >= 30 ? 'MODERATE' : 'LOW');
  return (
    <div className={cx('rounded-lg border px-3.5 py-3',
      accent ? 'border-high/45 bg-high-bg/40 dark:bg-high/10' : 'border-hairline bg-raised/60')}>
      <p className="eyebrow">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="mono-num text-xl font-bold">{value.toFixed(1)}</span>
        <span className={cx('font-mono text-2xs font-bold', BAND_STYLE[b].text)}>{b}</span>
      </div>
      <p className="mt-1 text-[11px] text-fg3">{caption}</p>
    </div>
  );
}

export { MapPin };
