import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, FlaskConical } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx, SCENARIO_LABEL, SCENARIO_SHORT } from '../../lib/format';
import { useApp } from '../../state/AppContext';
import type { ScenarioId } from '../../types/models';

const ORDER: ScenarioId[] = ['coordinated', 'household', 'isolated', 'normal'];

export function ScenarioMenu() {
  const { scenario, setScenario, pushToast } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const choose = (s: ScenarioId) => {
    setOpen(false);
    if (s === scenario) return;
    setScenario(s);
    pushToast({ title: 'Scenario loaded', detail: SCENARIO_LABEL[s], tone: 'success' });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-hairline px-2.5 py-1.5
                   text-xs font-medium text-fg2 transition hover:border-ring2 hover:bg-raised"
      >
        <FlaskConical size={13} className="text-fg3" aria-hidden />
        <span className="hidden sm:inline">{SCENARIO_SHORT[scenario]}</span>
        <ChevronDown size={13} className={cx('text-fg3 transition-transform', open && 'rotate-180')}
                     aria-hidden />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-2 w-[260px] rounded-xl border border-hairline
                       bg-surface p-1.5 shadow-pop"
          >
            <li className="px-2.5 pb-1.5 pt-1">
              <p className="eyebrow">Synthetic demonstration scenario</p>
            </li>
            {ORDER.map((s) => (
              <li key={s}>
                <button
                  role="option"
                  aria-selected={s === scenario}
                  onClick={() => choose(s)}
                  className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition',
                                s === scenario ? 'bg-brand-tint dark:bg-raised' : 'hover:bg-raised')}
                >
                  <Check size={13} aria-hidden
                         className={cx('shrink-0', s === scenario ? 'text-ring2' : 'opacity-0')} />
                  <span className="min-w-0 text-[12.5px] font-medium">{SCENARIO_LABEL[s]}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
