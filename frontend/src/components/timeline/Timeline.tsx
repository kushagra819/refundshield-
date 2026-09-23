import { FileText, UserPlus } from 'lucide-react';
import { useInView } from '../../hooks';
import { cx, shortDate } from '../../lib/format';
import { useApp } from '../../state/AppContext';
import { Reveal } from '../feedback/Reveal';
import type { TimelineResponse } from '../../types/models';

/** Every entry is a real record from the dataset — no synthesised events. */
export function Timeline({ data, limit }: { data: TimelineResponse; limit?: number }) {
  const { reduceMotion } = useApp();
  const { ref, seen } = useInView<HTMLDivElement>();

  if (!data.events.length) {
    return <p className="py-6 text-center text-sm text-fg3">No recorded activity for this group.</p>;
  }

  const events = limit ? data.events.slice(-limit) : data.events;
  const claims = new Set(events.filter((e) => e.kind === 'claim').map((e) => e.date));

  return (
    <div ref={ref}>
      {data.claim_window && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-high-bg px-3.5 py-2.5
                        dark:bg-high/10">
          <span className="font-mono text-2xs font-bold uppercase tracking-wider
                           text-high-fg dark:text-high">Activity window</span>
          <span className="mono-num text-[12.5px] font-semibold text-fg">
            {data.claim_window.start} → {data.claim_window.end}
          </span>
          <span className="text-[11.5px] text-fg3">
            ({data.claim_window.span_days} days · {data.claim_count} claims)
          </span>
        </div>
      )}

      <ol className="relative space-y-0 pl-1">
        <span className="absolute left-[9px] top-2 bottom-2 w-px bg-hairline" aria-hidden />
        {events.map((e, i) => {
          const Icon = e.kind === 'claim' ? FileText : UserPlus;
          const inWindow = e.kind === 'claim' && claims.has(e.date);
          return (
            <Reveal
              as="li"
              key={`${e.date}-${e.return_id ?? e.account_id}-${i}`}
              delay={reduceMotion || !seen ? 0 : Math.min(i * 18, 240)}
              className="relative flex gap-3.5 py-2.5"
            >
              <span className={cx(
                'relative z-10 mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border',
                inWindow
                  ? 'border-high/50 bg-high-bg text-high-fg dark:bg-high/20 dark:text-high'
                  : 'border-hairline bg-surface text-fg3')}>
                <Icon size={10} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <span className="mono-num text-[11px] font-semibold text-fg3">
                    {shortDate(e.date)}
                  </span>
                  <span className="text-[13px] font-medium">{e.label}</span>
                  <span className="mono-num text-[11px] text-fg3">{e.account_id}</span>
                </div>
                <p className="mono-num mt-0.5 truncate text-[11.5px] text-fg3">{e.detail}</p>
              </div>
            </Reveal>
          );
        })}
      </ol>
    </div>
  );
}
