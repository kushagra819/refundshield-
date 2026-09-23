import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, RotateCw, SearchX, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { cx } from '../../lib/format';
import { useApp } from '../../state/AppContext';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card p-5" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-32" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cx('h-3', i % 2 ? 'w-4/5' : 'w-full')} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 8 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden" aria-busy="true" aria-label="Loading table">
      <div className="border-b border-hairline bg-raised px-5 py-3">
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="divide-y divide-hairline">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="ml-auto h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry, title = 'Unable to load this view' }: {
  message?: string; onRetry?: () => void; title?: string;
}) {
  return (
    <div className="card flex flex-col items-center gap-4 px-6 py-14 text-center" role="alert">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-high-bg text-high-fg
                       dark:bg-high/15 dark:text-high">
        <AlertTriangle size={20} aria-hidden />
      </span>
      <div>
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <p className="mt-1.5 max-w-sm text-sm text-fg3">
          {message ?? 'The RefundShield API did not respond as expected.'}
        </p>
      </div>
      <div className="flex gap-2">
        {onRetry && (
          <button className="btn btn-primary" onClick={onRetry}>
            <RotateCw size={14} aria-hidden /> Retry
          </button>
        )}
        <Link className="btn" to="/">Back to dashboard</Link>
      </div>
    </div>
  );
}

export function EmptyState({ title, message, actionLabel, onAction }: {
  title: string; message?: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-hairline/60 text-fg3">
        <SearchX size={20} aria-hidden />
      </span>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {message && <p className="mt-1 max-w-sm text-sm text-fg3">{message}</p>}
      </div>
      {actionLabel && onAction && (
        <button className="btn mt-1" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  );
}

export function ToastHost() {
  const { toasts, dismissToast, reduceMotion } = useApp();
  const icon = { info: Info, success: CheckCircle2, warn: AlertTriangle };
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-80 flex-col gap-2"
         role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = icon[t.tone ?? 'info'];
          return (
            <motion.div
              key={t.id}
              layout={!reduceMotion}
              initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 16, scale: 0.97 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-hairline
                         bg-surface p-3.5 shadow-pop"
            >
              <span className={cx('mt-0.5 shrink-0',
                t.tone === 'success' ? 'text-low' : t.tone === 'warn' ? 'text-high' : 'text-ring2')}>
                <Icon size={16} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold leading-snug">{t.title}</p>
                {t.detail && <p className="mt-0.5 text-xs leading-snug text-fg3">{t.detail}</p>}
              </div>
              <button className="shrink-0 rounded p-0.5 text-fg3 hover:text-fg"
                      onClick={() => dismissToast(t.id)} aria-label="Dismiss notification">
                <X size={14} aria-hidden />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function PageTransition({ children }: { children: ReactNode }) {
  // CSS, not JS: the page must be readable even if animations never run.
  return <div className="animate-fade-up">{children}</div>;
}

export function PageHeader({ eyebrow, title, subtitle, action }: {
  eyebrow?: string; title: string; subtitle?: string; action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1.5 text-[26px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-fg3">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
