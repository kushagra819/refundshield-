import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cx } from '../../lib/format';
import { EmptyState } from '../feedback';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  sortable?: boolean;
  value?: (row: T) => string | number;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  rows, columns, rowKey, onRowClick, pageSize = 12, emptyTitle = 'Nothing to show',
  emptyMessage, onClearFilters, initialSort, caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  emptyTitle?: string;
  emptyMessage?: string;
  onClearFilters?: () => void;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  caption?: string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.value!(a);
      const bv = col.value!(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = sorted.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'desc' }));

  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState title={emptyTitle} message={emptyMessage}
                    actionLabel={onClearFilters ? 'Clear filters' : undefined}
                    onAction={onClearFilters} />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-hairline bg-raised">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  style={c.width ? { width: c.width } : undefined}
                  className={cx('px-4 py-2.5 font-mono text-2xs font-bold uppercase tracking-wider text-fg3',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')}
                  aria-sort={sort?.key === c.key
                    ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.sortable ? (
                    <button
                      onClick={() => toggleSort(c.key)}
                      className={cx('inline-flex items-center gap-1 transition hover:text-fg2',
                                    c.align === 'right' && 'flex-row-reverse')}
                    >
                      {c.header}
                      {sort?.key === c.key
                        ? (sort.dir === 'asc'
                            ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)
                        : <span className="w-[11px]" aria-hidden />}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr
                key={rowKey(row)}
                className={cx('border-b border-hairline last:border-0 transition-colors duration-150',
                  onRowClick && 'table-row')}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? 'button' : undefined}
                onKeyDown={onRowClick ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row); }
                } : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key}
                      className={cx('px-4 py-3',
                        c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : '')}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-2.5">
          <p className="text-xs text-fg3">
            <span className="mono-num">{current * pageSize + 1}</span>–
            <span className="mono-num">{Math.min(sorted.length, (current + 1) * pageSize)}</span>
            {' of '}<span className="mono-num">{sorted.length}</span>
          </p>
          <div className="flex items-center gap-1">
            <button className="btn px-2 py-1" onClick={() => setPage(Math.max(0, current - 1))}
                    disabled={current === 0} aria-label="Previous page">
              <ChevronLeft size={14} aria-hidden />
            </button>
            <span className="mono-num px-2 text-xs text-fg3">{current + 1} / {pages}</span>
            <button className="btn px-2 py-1" onClick={() => setPage(Math.min(pages - 1, current + 1))}
                    disabled={current >= pages - 1} aria-label="Next page">
              <ChevronRight size={14} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FilterChip({ label, active, onClick }: {
  label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx('rounded-full border px-3 py-1.5 text-xs font-medium transition duration-150',
        active
          ? 'border-transparent bg-ink text-white'
          : 'border-hairline bg-surface text-fg2 hover:border-ring2 hover:bg-raised')}
    >
      {label}
    </button>
  );
}
