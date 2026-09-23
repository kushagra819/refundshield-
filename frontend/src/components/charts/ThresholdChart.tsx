import {
  Bar, BarChart, CartesianGrid, Cell, Line, ComposedChart, ReferenceArea,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ThresholdBin } from '../../types/models';

/*
 * Recharts' entrance animation is deliberately OFF.
 *
 * It grows bars from zero height using requestAnimationFrame, and if rAF is
 * throttled or suspended the bars stay at zero — a chart that silently reports
 * nothing while the axis says otherwise. We hit exactly that: every bar flat at
 * 0 against a y-axis scaled to 8. The panel still animates in as a whole via
 * the CSS reveal, so the entrance is preserved; only the misreporting is gone.
 */
const CHART_ENTRANCE_ANIMATION = false;

const ROLE_FILL: Record<string, string> = {
  window: '#C1462F',
  reference: '#9FADC2',
  guard: '#CBD3DF',
  other: '#B7C0CE',
};

interface Row {
  label: string;
  lower: number;
  observed: number;
  expected: number | null;
  role: string;
}

function toRows(bins: ThresholdBin[]): Row[] {
  return bins.map((b) => ({
    label: `${b.lower_pct}%`,
    lower: b.lower_pct,
    observed: b.count,
    expected: b.expected,
    role: b.role,
  }));
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const diff = r.expected === null ? null : r.observed - r.expected;
  return (
    <div className="rounded-lg border border-hairline bg-surface px-3 py-2 shadow-pop">
      <p className="mono-num text-[11px] font-bold">
        {r.lower}%–{(r.lower + 1).toFixed(0)}% return rate
      </p>
      <dl className="mt-1.5 space-y-0.5 text-[11px]">
        <div className="flex gap-4 justify-between">
          <dt className="text-fg3">Observed</dt>
          <dd className="mono-num font-semibold">{r.observed}</dd>
        </div>
        {r.expected !== null && (
          <>
            <div className="flex gap-4 justify-between">
              <dt className="text-fg3">Expected</dt>
              <dd className="mono-num font-semibold">{r.expected.toFixed(2)}</dd>
            </div>
            <div className="flex gap-4 justify-between">
              <dt className="text-fg3">Difference</dt>
              <dd className={`mono-num font-semibold ${diff! > 0 ? 'text-high-fg dark:text-high' : 'text-fg2'}`}>
                {diff! > 0 ? '+' : ''}{diff!.toFixed(2)}
              </dd>
            </div>
          </>
        )}
      </dl>
      {r.role === 'window' && (
        <p className="mt-1.5 border-t border-hairline pt-1.5 text-[10px] text-high-fg dark:text-high">
          Inside the near-threshold review band
        </p>
      )}
      {r.role === 'reference' && (
        <p className="mt-1.5 border-t border-hairline pt-1.5 text-[10px] text-fg3">
          Reference region — used to fit the expected trend
        </p>
      )}
    </div>
  );
}

export function ThresholdChart({ bins, thresholdPct, windowPct, height = 300, onSelectBin }: {
  bins: ThresholdBin[]; thresholdPct: number; windowPct: [number, number]; height?: number;
  onSelectBin?: (bin: ThresholdBin) => void;
}) {
  const rows = toRows(bins);
  if (!rows.length) return null;

  const pick = (label: string) => {
    const bin = bins.find((b) => `${b.lower_pct}%` === label);
    if (bin) onSelectBin?.(bin);
  };

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 16, right: 12, bottom: 4, left: -18 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="currentColor"
                         className="text-hairline" vertical={false} />
          <ReferenceArea x1={`${windowPct[0]}%`} x2={`${windowPct[1] - 1}%`}
                         fill="#C1462F" fillOpacity={0.07} />
          <XAxis dataKey="label" tickLine={false} axisLine={false}
                 tick={{ fontSize: 10.5, fontFamily: 'JetBrains Mono', fill: 'currentColor' }}
                 className="text-fg3" interval={0} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={44}
                 tick={{ fontSize: 10.5, fontFamily: 'JetBrains Mono', fill: 'currentColor' }}
                 className="text-fg3"
                 label={{ value: 'Accounts', angle: -90, position: 'insideLeft',
                          offset: 22, style: { fontSize: 10, fill: 'currentColor' } }} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(46,64,89,0.06)' }} />
          <Bar dataKey="observed" radius={[3, 3, 0, 0]} maxBarSize={34}
               isAnimationActive={CHART_ENTRANCE_ANIMATION}
               onClick={(d: unknown) => {
                 const label = (d as { payload?: Row })?.payload?.label;
                 if (label) pick(label);
               }}
               style={onSelectBin ? { cursor: 'pointer' } : undefined}>
            {rows.map((r) => (
              <Cell key={r.label} fill={ROLE_FILL[r.role] ?? ROLE_FILL.other} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="expected" stroke="#2E4059" strokeWidth={1.8}
                strokeDasharray="4 3" dot={{ r: 2.5, fill: '#2E4059' }} connectNulls
                isAnimationActive={CHART_ENTRANCE_ANIMATION} />
          <ReferenceLine x={`${thresholdPct}%`} stroke="#C1462F" strokeWidth={1.8}
                         strokeDasharray="5 4"
                         label={{ value: `THRESHOLD ${thresholdPct}%`, position: 'top',
                                  fontSize: 10, fontFamily: 'JetBrains Mono',
                                  fill: '#C1462F', fontWeight: 700 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Small distribution histogram used on the dashboard. */
export function RiskDistribution({ data, color = '#2E4059', height = 150 }: {
  data: { label: string; value: number }[]; color?: string; height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="currentColor"
                         className="text-hairline" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false}
                 tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: 'currentColor' }}
                 className="text-fg3" />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={30}
                 tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: 'currentColor' }}
                 className="text-fg3" />
          <Tooltip
            cursor={{ fill: 'rgba(46,64,89,0.06)' }}
            contentStyle={{ borderRadius: 8, border: '1px solid rgb(var(--c-hairline))',
                            background: 'rgb(var(--c-surface))', fontSize: 11 }}
          />
          <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} maxBarSize={40}
               isAnimationActive={CHART_ENTRANCE_ANIMATION} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
