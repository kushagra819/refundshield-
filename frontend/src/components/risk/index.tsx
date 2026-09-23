import type { ReactNode } from 'react';
import { useCountUp } from '../../hooks';
import { BAND_STYLE, PRIORITY_STYLE, cx, score1 } from '../../lib/format';
import type { Band, Priority } from '../../types/models';
import { useApp } from '../../state/AppContext';
import { Reveal } from '../feedback/Reveal';

/** Risk is always colour + text. Never colour alone. */
export function RiskBadge({ band, score, size = 'md', className }: {
  band: Band; score?: number; size?: 'sm' | 'md'; className?: string;
}) {
  const s = BAND_STYLE[band];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full font-mono font-bold tracking-wide',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-2xs',
        s.chip, className,
      )}
    >
      <span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden />
      {score !== undefined && <span className="tabular-nums">{score1(score)}</span>}
      <span>{band}</span>
    </span>
  );
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span className={cx(
      'inline-flex items-center rounded-full px-2.5 py-1 font-mono text-2xs font-bold tracking-wide',
      PRIORITY_STYLE[priority], className,
    )}>
      {priority}
    </span>
  );
}

/** A single evidence-stream score with an animated bar. */
export function ScoreCard({ label, score, band, hint, accent = false, delay = 0 }: {
  label: string; score: number; band: Band; hint?: string; accent?: boolean; delay?: number;
}) {
  const { reduceMotion } = useApp();
  const shown = useCountUp(score, 850, 1);
  const s = BAND_STYLE[band];
  return (
    <Reveal delay={reduceMotion ? 0 : delay * 1000}
            className={cx('card p-4', accent && 'ring-1 ring-high/40')}>
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">{label}</p>
        {hint && <Tooltip text={hint} />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="mono-num text-2xl font-bold tracking-tight">{shown.toFixed(1)}</span>
        <span className="text-xs text-fg3">/ 100</span>
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-hairline/70">
        <div
          className={cx('h-full rounded-full transition-[width] duration-700 ease-swift', s.bar)}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
      <div className="mt-2.5"><RiskBadge band={band} size="sm" /></div>
    </Reveal>
  );
}

/** The big coordination dial. Deliberately not a spinner: it draws once and rests. */
export function ScoreRing({ score, band, label, size = 168 }: {
  score: number; band: Band; label: string; size?: number;
}) {
  const { reduceMotion } = useApp();
  const shown = useCountUp(score, 1100, 1);
  const r = size / 2 - 14;
  const circ = 2 * Math.PI * r;
  const pctOf = Math.max(0, Math.min(100, score)) / 100;
  const stroke = { LOW: '#12705F', MODERATE: '#9A6B12', HIGH: '#C1462F', 'VERY HIGH': '#98231A' }[band];

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke="currentColor" className="text-hairline" strokeWidth={9} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke}
          strokeWidth={9} strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pctOf)}
          style={{ transition: reduceMotion ? undefined : 'stroke-dashoffset 1.1s cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="mono-num text-[2.1rem] font-bold leading-none tracking-tight">
          {shown.toFixed(1)}
        </span>
        <span className={cx('mt-1.5 font-mono text-2xs font-bold tracking-widest',
                            BAND_STYLE[band].text)}>{band}</span>
        <span className="mt-0.5 text-[11px] text-fg3">{label}</span>
      </div>
    </div>
  );
}

export function MeterRow({ label, score, band, hint, weight }: {
  label: string; score: number; band: Band; hint?: string; weight?: string;
}) {
  const { reduceMotion } = useApp();
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate text-sm text-fg2">{label}</span>
        {weight && <span className="mono-num shrink-0 text-[10px] text-fg3">{weight}</span>}
        {hint && <Tooltip text={hint} />}
      </div>
      <span className="mono-num shrink-0 text-sm font-bold">{score1(score)}</span>
      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-hairline/70">
        <div
          className={cx('h-full rounded-full transition-[width] duration-700 ease-swift',
                        BAND_STYLE[band].bar)}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
    </div>
  );
}

export function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex shrink-0" tabIndex={0} role="note" aria-label={text}>
      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-hairline
                       text-[9px] font-bold text-fg3 transition-colors group-hover:border-ring2
                       group-hover:text-fg2 group-focus:border-ring2">?</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-60 -translate-x-1/2
                       rounded-lg bg-ink px-3 py-2 text-[11.5px] leading-snug text-white opacity-0
                       shadow-pop transition-opacity duration-150 group-hover:opacity-100
                       group-focus:opacity-100">
        {text}
      </span>
    </span>
  );
}

export function Panel({ title, eyebrow, action, children, className, alert }: {
  title?: ReactNode; eyebrow?: string; action?: ReactNode;
  children: ReactNode; className?: string; alert?: boolean;
}) {
  return (
    <section className={cx('card p-5', alert && 'ring-1 ring-high/45', className)}>
      {(title || eyebrow || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2 className="mt-1 text-[15px] font-semibold tracking-tight">{title}</h2>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
