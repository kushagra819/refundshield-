import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';
import type { ScenarioId } from '../types/models';

type Theme = 'light' | 'dark';
export interface Toast { id: number; title: string; detail?: string; tone?: 'info' | 'success' | 'warn' }

/** One investigator action, recorded locally so the case has an audit trail.
 *  Frontend-only: the backend holds the authoritative case status. */
export interface LogEntry {
  id: number;
  at: string;            // ISO timestamp
  subject: string;       // return id / cluster id / page
  action: string;
  detail?: string;
}

interface AppState {
  scenario: ScenarioId;
  setScenario: (s: ScenarioId) => void;
  theme: Theme;
  toggleTheme: () => void;
  reduceMotion: boolean;
  setReduceMotion: (v: boolean) => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  demoMode: boolean;
  setDemoMode: (v: boolean) => void;
  log: LogEntry[];
  logEvent: (e: Omit<LogEntry, 'id' | 'at'>) => void;
  clearLog: (subject?: string) => void;
}

const Ctx = createContext<AppState | null>(null);
const KEY_THEME = 'refundshield.theme';
const KEY_SCENARIO = 'refundshield.scenario';
const KEY_LOG = 'refundshield.log';

function readStored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

function readLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(KEY_LOG);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LogEntry[]).slice(-60) : [];
  } catch {
    return [];
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenarioRaw] = useState<ScenarioId>(
    () => readStored<ScenarioId>(KEY_SCENARIO, 'coordinated'));
  const [theme, setTheme] = useState<Theme>(() => readStored<Theme>(KEY_THEME, 'light'));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [demoMode, setDemoModeRaw] = useState(false);
  const [log, setLog] = useState<LogEntry[]>(() => readLog());
  const [reduceMotion, setReduceMotionRaw] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    try { localStorage.setItem(KEY_THEME, theme); } catch { /* private mode */ }
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);

  useEffect(() => {
    try { localStorage.setItem(KEY_SCENARIO, scenario); } catch { /* private mode */ }
  }, [scenario]);

  useEffect(() => {
    try { localStorage.setItem(KEY_LOG, JSON.stringify(log.slice(-60))); }
    catch { /* private mode or quota */ }
  }, [log]);

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    window.setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 4200);
  }, []);

  const dismissToast = useCallback(
    (id: number) => setToasts((p) => p.filter((x) => x.id !== id)), []);

  const logEvent = useCallback((e: Omit<LogEntry, 'id' | 'at'>) => {
    setLog((prev) => [...prev.slice(-59), {
      ...e, id: Date.now() + Math.random(), at: new Date().toISOString(),
    }]);
  }, []);

  const clearLog = useCallback((subject?: string) => {
    setLog((prev) => (subject ? prev.filter((e) => e.subject !== subject) : []));
  }, []);

  const setScenario = useCallback((s: ScenarioId) => setScenarioRaw(s), []);
  const setDemoMode = useCallback((v: boolean) => setDemoModeRaw(v), []);
  const toggleTheme = useCallback(
    () => setTheme((t) => (t === 'light' ? 'dark' : 'light')), []);

  const value = useMemo<AppState>(() => ({
    scenario, setScenario, theme, toggleTheme,
    reduceMotion, setReduceMotion: setReduceMotionRaw,
    toasts, pushToast, dismissToast, paletteOpen, setPaletteOpen,
    demoMode, setDemoMode, log, logEvent, clearLog,
  }), [scenario, setScenario, theme, toggleTheme, reduceMotion,
       toasts, pushToast, dismissToast, paletteOpen,
       demoMode, setDemoMode, log, logEvent, clearLog]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}
