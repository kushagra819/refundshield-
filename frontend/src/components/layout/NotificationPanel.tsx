import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Boxes, Gauge, ScrollText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks';
import { BAND_STYLE, cx } from '../../lib/format';
import { api } from '../../services/api';
import { useApp } from '../../state/AppContext';
import type { ActivityEvent } from '../../types/models';

const ICON = { cluster: Boxes, threshold: Gauge, return: ScrollText } as const;

/** Where an event takes you. Derived from the event kind and subject, both of
 *  which the API supplies — nothing here is invented. */
function routeFor(e: ActivityEvent): string {
  if (e.kind === 'cluster') return `/network?cluster=${encodeURIComponent(e.subject)}`;
  if (e.kind === 'threshold') return '/threshold';
  return `/investigations/${encodeURIComponent(e.subject)}`;
}

export function NotificationPanel() {
  const { scenario } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data, loading } = useAsync(() => api.activity(scenario, 8), [scenario]);
  const events = data?.events ?? [];
  const urgent = events.filter((e) => e.band === 'HIGH' || e.band === 'VERY HIGH').length;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const go = (e: ActivityEvent) => {
    setOpen(false);
    navigate(routeFor(e));
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={urgent > 0 ? `Notifications, ${urgent} high priority` : 'Notifications'}
        className="relative rounded-lg p-2 text-fg3 transition hover:bg-raised hover:text-fg"
      >
        <Bell size={17} aria-hidden />
        {urgent > 0 && (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-high" aria-hidden />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Recent signals"
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-2 w-[330px] overflow-hidden rounded-xl
                       border border-hairline bg-surface shadow-pop"
          >
            <div className="flex items-center justify-between border-b border-hairline px-3.5 py-2.5">
              <p className="eyebrow">Recent signals</p>
              <span className="rounded-full bg-moderate-bg px-2 py-0.5 font-mono text-[9.5px]
                               font-bold uppercase tracking-wider text-moderate-fg
                               dark:bg-moderate/15 dark:text-moderate">Synthetic</span>
            </div>

            <ul className="max-h-[340px] overflow-y-auto p-1.5">
              {loading && (
                <li className="px-2 py-6 text-center text-[12px] text-fg3">Loading signals…</li>
              )}
              {!loading && events.length === 0 && (
                <li className="px-2 py-6 text-center text-[12px] text-fg3">
                  No signals in this scenario.
                </li>
              )}
              {events.map((e, i) => {
                const Icon = ICON[e.kind] ?? Boxes;
                return (
                  <li key={`${e.kind}-${e.subject}-${i}`}>
                    <button
                      onClick={() => go(e)}
                      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left
                                 transition hover:bg-raised"
                    >
                      <span className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                                          BAND_STYLE[e.band].dot)} aria-hidden />
                      <Icon size={13} className="mt-0.5 shrink-0 text-fg3" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-medium leading-snug">{e.title}</span>
                        <span className="mono-num block truncate text-[11px] text-fg3">{e.subject}</span>
                        <span className="block truncate text-[11px] text-fg3">{e.detail}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="border-t border-hairline px-3.5 py-2 text-[10.5px] text-fg3">
              Derived from the current scenario analysis. Select one to open it.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
