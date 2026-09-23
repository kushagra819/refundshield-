import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft, Gauge, Info, LayoutDashboard, Menu, Moon, Network, Presentation,
  ScrollText, Search, ShieldCheck, Sun, Users, X, FlaskConical,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cx, SCENARIO_SHORT } from '../../lib/format';
import { useApp } from '../../state/AppContext';
import { ToastHost } from '../feedback';
import { CommandPalette } from '../command/CommandPalette';
import { GlobalSearch } from './GlobalSearch';
import { NotificationPanel } from './NotificationPanel';
import { ScenarioMenu } from './ScenarioMenu';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/investigations', label: 'Investigations', icon: ScrollText },
  { to: '/accounts', label: 'Accounts', icon: Users },
  { to: '/network', label: 'Network', icon: Network },
  { to: '/threshold', label: 'Threshold Analysis', icon: Gauge },
  { to: '/scenarios', label: 'Scenarios', icon: FlaskConical },
  { to: '/about', label: 'System', icon: Info },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { theme, toggleTheme, scenario, setPaletteOpen, reduceMotion } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  useEffect(() => { setDrawer(false); }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  const width = collapsed ? 68 : 232;

  return (
    <div className="flex h-full bg-canvas">
      {/* ---------------- sidebar (desktop) ---------------- */}
      <motion.aside
        animate={{ width }}
        initial={false}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-30 hidden shrink-0 flex-col border-r border-hairline bg-surface lg:flex"
      >
        <Brand collapsed={collapsed} />
        <nav className="flex-1 space-y-0.5 px-3 py-3" aria-label="Primary">
          {NAV.map((item) => <NavItem key={item.to} {...item} collapsed={collapsed} />)}
        </nav>
        <SidebarFooter collapsed={collapsed} scenario={scenario} />
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-3 top-[72px] flex h-6 w-6 items-center justify-center rounded-full
                     border border-hairline bg-surface text-fg3 shadow-card transition hover:text-fg"
        >
          <ChevronLeft size={13} className={cx('transition-transform duration-200',
                                                collapsed && 'rotate-180')} aria-hidden />
        </button>
      </motion.aside>

      {/* ---------------- drawer (mobile / tablet) ---------------- */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-ink/45 lg:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDrawer(false)} aria-hidden
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-hairline
                         bg-surface lg:hidden"
              initial={reduceMotion ? false : { x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              role="dialog" aria-label="Navigation"
            >
              <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
                <Brand collapsed={false} bare />
                <button className="rounded p-1 text-fg3 hover:text-fg" onClick={() => setDrawer(false)}
                        aria-label="Close navigation"><X size={17} aria-hidden /></button>
              </div>
              <nav className="flex-1 space-y-0.5 px-3 py-3" aria-label="Primary">
                {NAV.map((item) => <NavItem key={item.to} {...item} collapsed={false} />)}
              </nav>
              <SidebarFooter collapsed={false} scenario={scenario} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ---------------- main ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b
                           border-hairline bg-surface/90 px-4 backdrop-blur-md sm:px-5">
          <button className="rounded-lg p-2 text-fg3 hover:bg-raised hover:text-fg lg:hidden"
                  onClick={() => setDrawer(true)} aria-label="Open navigation">
            <Menu size={18} aria-hidden />
          </button>

          <GlobalSearch />

          <div className="ml-auto flex items-center gap-1.5">
            <ScenarioMenu />
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-lg border border-hairline px-2.5 py-1.5
                         text-xs text-fg3 transition hover:border-ring2 hover:text-fg2 md:flex"
              aria-label="Open command palette"
            >
              <Search size={13} aria-hidden />
              <kbd className="font-mono text-[10px]">Ctrl K</kbd>
            </button>
            <DemoModeButton />
            <NotificationPanel />
            <button onClick={toggleTheme} className="rounded-lg p-2 text-fg3 transition hover:bg-raised hover:text-fg"
                    aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}>
              {theme === 'light' ? <Moon size={17} aria-hidden /> : <Sun size={17} aria-hidden />}
            </button>
            <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand
                            font-mono text-[11px] font-bold text-white" aria-label="Investigator profile">
              IN
            </div>
          </div>
        </header>

        <DemoStrip />

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>

      <CommandPalette />
      <ToastHost />
    </div>
  );
}

const DEMO_STEPS = [
  { to: '/scenarios', label: 'Scenario Lab' },
  { to: '/threshold', label: 'Threshold + slider' },
  { to: '/investigations', label: 'Queue' },
  { to: '/network?cluster=C-011', label: 'Network C-011' },
];

/** A quiet step-strip, visible only in demo mode. Navigation aid, not a slideshow. */
function DemoStrip() {
  const { demoMode } = useApp();
  const location = useLocation();
  if (!demoMode) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline
                    bg-raised/70 px-4 py-1.5 sm:px-5">
      <span className="eyebrow">Demo flow</span>
      {DEMO_STEPS.map((s, i) => {
        const active = location.pathname + location.search === s.to
          || location.pathname === s.to;
        return (
          <NavLink key={s.to} to={s.to}
            className={cx('rounded-full px-2.5 py-1 text-[11px] font-medium transition',
              active ? 'bg-ink text-white' : 'text-fg3 hover:bg-surface hover:text-fg2')}>
            <span className="mono-num mr-1 opacity-60">{i + 1}</span>{s.label}
          </NavLink>
        );
      })}
      <span className="ml-auto hidden text-[10.5px] text-fg3 md:inline">
        Scores and data are unchanged — demo mode only sets scenario and navigation.
      </span>
    </div>
  );
}

/** Puts the app into its strongest demonstration state. It changes only
 *  frontend context — scenario selection and navigation — and never touches
 *  backend data or the computed scores. */
function DemoModeButton() {
  const { demoMode, setDemoMode, setScenario, pushToast, logEvent } = useApp();
  const navigate = useNavigate();

  const toggle = () => {
    if (demoMode) {
      setDemoMode(false);
      pushToast({ title: 'Demo mode off' });
      return;
    }
    setDemoMode(true);
    setScenario('coordinated');
    logEvent({ subject: 'session', action: 'Demo mode enabled' });
    pushToast({
      title: 'Demo mode on',
      detail: 'Coordinated scenario loaded · hero cluster C-011 ready',
      tone: 'success',
    });
    navigate('/scenarios');
  };

  return (
    <button
      onClick={toggle}
      aria-pressed={demoMode}
      title={demoMode ? 'Exit demo mode' : 'Enter demo mode'}
      className={cx('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
        demoMode
          ? 'border-transparent bg-ink text-white'
          : 'border-hairline text-fg2 hover:border-ring2 hover:bg-raised')}
    >
      <Presentation size={13} aria-hidden />
      <span className="hidden lg:inline">{demoMode ? 'Exit demo' : 'Demo'}</span>
    </button>
  );
}

function Brand({ collapsed, bare }: { collapsed: boolean; bare?: boolean }) {
  return (
    <div className={cx('flex items-center gap-2.5 px-4', bare ? '' : 'h-14 border-b border-hairline')}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-white">
        <ShieldCheck size={17} aria-hidden />
      </span>
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-bold leading-tight tracking-tight">RefundShield</p>
          <p className="truncate text-[10px] leading-tight text-fg3">Return abuse intelligence</p>
        </div>
      )}
    </div>
  );
}

function NavItem({ to, label, icon: Icon, end, collapsed }: {
  to: string; label: string; icon: typeof Gauge; end?: boolean; collapsed: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) => cx(
        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
        isActive ? 'text-fg' : 'text-fg3 hover:bg-raised hover:text-fg2',
      )}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="nav-active"
              className="absolute inset-0 -z-10 rounded-lg bg-brand-tint dark:bg-raised"
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          {isActive && (
            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-ink
                             dark:bg-ring2" aria-hidden />
          )}
          <Icon size={16.5} className="shrink-0" aria-hidden />
          {!collapsed && <span className="truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );
}

function SidebarFooter({ collapsed, scenario }: { collapsed: boolean; scenario: string }) {
  return (
    <div className="space-y-2 border-t border-hairline px-3 py-3">
      <div className={cx('flex items-center gap-2 rounded-lg bg-moderate-bg px-2.5 py-2 dark:bg-moderate/10',
                         collapsed && 'justify-center')}>
        <FlaskConical size={13} className="shrink-0 text-moderate-fg dark:text-moderate" aria-hidden />
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate font-mono text-[9.5px] font-bold uppercase tracking-wider
                          text-moderate-fg dark:text-moderate">Synthetic environment</p>
            <p className="truncate text-[10px] text-fg3">{SCENARIO_SHORT[scenario]}</p>
          </div>
        )}
      </div>
      <div className={cx('flex items-center gap-2 px-2.5', collapsed && 'justify-center')}>
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-low opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-low" />
        </span>
        {!collapsed && <span className="text-[10.5px] text-fg3">API connected</span>}
      </div>
    </div>
  );
}
