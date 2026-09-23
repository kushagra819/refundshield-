import { AnimatePresence, motion } from 'framer-motion';
import {
  CornerDownLeft, FlaskConical, Gauge, LayoutDashboard, Network, PlayCircle,
  ScrollText, Search, Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cx, SCENARIO_LABEL } from '../../lib/format';
import { useApp } from '../../state/AppContext';
import type { ScenarioId } from '../../types/models';

interface Cmd {
  id: string; label: string; group: string; icon: typeof Gauge; run: () => void;
}

export function CommandPalette() {
  const {
    paletteOpen, setPaletteOpen, setScenario, pushToast, reduceMotion, demoMode, setDemoMode,
  } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Cmd[]>(() => {
    const goto = (to: string, label: string, icon: typeof Gauge): Cmd => ({
      id: `go:${to}`, label, group: 'Navigate', icon,
      run: () => { navigate(to); setPaletteOpen(false); },
    });
    const load = (s: ScenarioId): Cmd => ({
      id: `load:${s}`, label: `Load ${SCENARIO_LABEL[s]}`, group: 'Scenarios', icon: FlaskConical,
      run: () => {
        setScenario(s);
        setPaletteOpen(false);
        pushToast({ title: 'Scenario loaded', detail: SCENARIO_LABEL[s], tone: 'success' });
      },
    });
    return [
      goto('/', 'Go to Dashboard', LayoutDashboard),
      goto('/investigations', 'Open Investigations', ScrollText),
      goto('/accounts', 'Open Accounts', Users),
      goto('/network', 'Open Network Explorer', Network),
      goto('/threshold', 'Open Threshold Analysis', Gauge),
      goto('/scenarios', 'Open Scenario Lab', FlaskConical),
      goto('/about', 'Open System & Limitations', Gauge),
      {
        id: 'hero', label: 'Run Hero Investigation', group: 'Demo', icon: PlayCircle,
        run: () => {
          setScenario('coordinated');
          navigate('/scenarios?demo=1');
          setPaletteOpen(false);
        },
      },
      {
        id: 'cluster:C-011', label: 'Open cluster C-011 in Network Explorer',
        group: 'Demo', icon: Network,
        run: () => {
          setScenario('coordinated');
          navigate('/network?cluster=C-011');
          setPaletteOpen(false);
        },
      },
      {
        id: 'demo:toggle',
        label: demoMode ? 'Exit demo mode' : 'Enter demo mode',
        group: 'Demo', icon: PlayCircle,
        run: () => {
          if (!demoMode) { setDemoMode(true); setScenario('coordinated'); navigate('/scenarios'); }
          else setDemoMode(false);
          setPaletteOpen(false);
          pushToast({ title: demoMode ? 'Demo mode off' : 'Demo mode on', tone: 'success' });
        },
      },
      load('coordinated'), load('household'), load('isolated'), load('normal'),
    ];
  }, [navigate, setPaletteOpen, setScenario, pushToast, demoMode, setDemoMode]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(needle)
      || c.group.toLowerCase().includes(needle));
  }, [q, commands]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    if (paletteOpen) {
      setQ('');
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [paletteOpen]);

  useEffect(() => {
    if (!paletteOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPaletteOpen(false);
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % Math.max(1, filtered.length)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length)); }
      if (e.key === 'Enter' && filtered[active]) { e.preventDefault(); filtered[active].run(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, filtered, active, setPaletteOpen]);

  let lastGroup = '';

  return (
    <AnimatePresence>
      {paletteOpen && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]"
             role="dialog" aria-modal="true" aria-label="Command palette">
          <motion.div
            className="absolute inset-0 bg-ink/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setPaletteOpen(false)}
          />
          <motion.div
            className="relative w-full max-w-[560px] overflow-hidden rounded-2xl border border-hairline
                       bg-surface shadow-pop"
            initial={reduceMotion ? false : { opacity: 0, y: -10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.985 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center gap-3 border-b border-hairline px-4">
              <Search size={16} className="shrink-0 text-fg3" aria-hidden />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Type a command…"
                aria-label="Command"
                className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-fg3"
              />
              <kbd className="shrink-0 rounded border border-hairline px-1.5 py-0.5 font-mono
                              text-[10px] text-fg3">ESC</kbd>
            </div>
            <ul className="max-h-[min(56vh,400px)] overflow-y-auto p-1.5" role="listbox">
              {filtered.length === 0 && (
                <li className="px-3 py-8 text-center text-[13px] text-fg3">No matching commands.</li>
              )}
              {filtered.map((c, i) => {
                const header = c.group !== lastGroup ? c.group : null;
                lastGroup = c.group;
                const Icon = c.icon;
                return (
                  <li key={c.id}>
                    {header && <p className="eyebrow px-2.5 pb-1 pt-2.5">{header}</p>}
                    <button
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={c.run}
                      className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition',
                                    i === active ? 'bg-brand-tint dark:bg-raised' : 'hover:bg-raised')}
                    >
                      <Icon size={15} className="shrink-0 text-fg3" aria-hidden />
                      <span className="flex-1 text-[13px]">{c.label}</span>
                      {i === active && (
                        <CornerDownLeft size={12} className="shrink-0 text-fg3" aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
