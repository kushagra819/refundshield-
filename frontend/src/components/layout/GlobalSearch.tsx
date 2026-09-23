import { AnimatePresence, motion } from 'framer-motion';
import { CreditCard, MapPin, Search, Smartphone, Users, Network } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebounced } from '../../hooks';
import { cx } from '../../lib/format';
import { api } from '../../services/api';
import { useApp } from '../../state/AppContext';
import type { SearchResult } from '../../types/models';
import { RiskBadge } from '../risk';

const ICON = {
  account: Users, return: CreditCard, cluster: Network,
  device: Smartphone, address: MapPin,
} as const;

export function GlobalSearch() {
  const { scenario } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q, 200);
  const boxRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    if (debounced.trim().length < 2) { setResults([]); return; }
    api.search(debounced.trim(), scenario)
      .then((r) => { if (alive) { setResults(r.results); setActive(0); } })
      .catch(() => { if (alive) setResults([]); });
    return () => { alive = false; };
  }, [debounced, scenario]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = (r: SearchResult) => {
    navigate(r.route);
    setOpen(false);
    setQ('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % results.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length); }
    if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-[420px]">
      <div className="relative">
        <Search size={15} aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg3" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search accounts, returns, clusters, devices…"
          aria-label="Global search"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="global-search-results"
          className="w-full rounded-lg border border-hairline bg-canvas py-2 pl-9 pr-3 text-[13px]
                     text-fg placeholder:text-fg3 transition focus:border-ring2 focus:bg-surface"
        />
      </div>

      <AnimatePresence>
        {open && q.trim().length >= 2 && (
          <motion.div
            id="global-search-results"
            role="listbox"
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(70vh,420px)] overflow-y-auto
                       rounded-xl border border-hairline bg-surface p-1.5 shadow-pop"
          >
            {results.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-fg3">
                No matches for “{q.trim()}”.
              </p>
            ) : results.map((r, i) => {
              const Icon = ICON[r.kind];
              return (
                <button
                  key={`${r.kind}-${r.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition',
                                i === active ? 'bg-brand-tint dark:bg-raised' : 'hover:bg-raised')}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md
                                   bg-hairline/60 text-fg2"><Icon size={13} aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="mono-num truncate text-[12.5px] font-semibold">{r.id}</span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-fg3">{r.kind}</span>
                    </span>
                    <span className="block truncate text-[11.5px] text-fg3">{r.primary}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {r.badges.map((b) => (
                      <RiskBadge key={b.label} band={b.band} size="sm" />
                    ))}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
