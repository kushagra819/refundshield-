import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

export interface SweepPoint { pct: number; signal: number }

/**
 * Signal-vs-threshold sweep.
 *
 * Every point is a real API call to /threshold-analysis with a different
 * `threshold` override — the engine recomputes the whole estimate each time.
 * The shape is the argument: the signal is not "high near the line", it peaks
 * where the accounts are actually parked and collapses either side.
 *
 * Entrance animation is off for the same reason as ThresholdChart: a throttled
 * rAF leaves the line at zero, which would silently misreport the result.
 */
export function ThresholdSweep({ points, activePct, policyPct, height = 150 }: {
  points: SweepPoint[]; activePct: number; policyPct: number; height?: number;
}) {
  if (points.length === 0) return null;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 10, right: 12, bottom: 2, left: -22 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="currentColor"
                         className="text-hairline" vertical={false} />
          <XAxis dataKey="pct" tickLine={false} axisLine={false}
                 tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: 'currentColor' }}
                 className="text-fg3" tickFormatter={(v: number) => `${v}%`} />
          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={34}
                 tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: 'currentColor' }}
                 className="text-fg3" />
          <Tooltip
            cursor={{ stroke: 'rgba(46,64,89,0.25)' }}
            contentStyle={{
              borderRadius: 8, border: '1px solid rgb(var(--c-hairline))',
              background: 'rgb(var(--c-surface))', fontSize: 11,
            }}
            formatter={(v: number) => [v.toFixed(1), 'Signal']}
            labelFormatter={(l: number) => `Threshold ${l}%`}
          />
          <ReferenceLine x={policyPct} stroke="#9FADC2" strokeDasharray="3 3"
                         label={{ value: 'policy', position: 'insideTopLeft',
                                  fontSize: 9, fill: '#9FADC2' }} />
          <ReferenceLine x={activePct} stroke="#C1462F" strokeWidth={1.6} />
          <Line type="monotone" dataKey="signal" stroke="#C1462F" strokeWidth={2}
                dot={{ r: 2.5, fill: '#C1462F' }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
