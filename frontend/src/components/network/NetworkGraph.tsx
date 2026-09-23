/** Interactive relationship graph.
 *
 * Hand-built SVG rather than React Flow or Cytoscape. The graph here is a small
 * bipartite layout (accounts on the left, shared entities on the right) where
 * node SHAPE carries meaning. A general-purpose graph library would fight that
 * layout, ship a much larger bundle, and give no benefit at this node count —
 * pan, zoom, fit and selection are a few dozen lines.
 */
import { Crosshair, Maximize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../../lib/format';
import { useApp } from '../../state/AppContext';
import type { GraphEdge, GraphNode } from '../../types/models';

export interface Positioned extends GraphNode { x: number; y: number }

const W = 760;
const H = 440;

const KIND_STYLE: Record<string, { fill: string; stroke: string; label: string }> = {
  account: { fill: 'var(--n-account)', stroke: 'var(--n-account-s)', label: 'Account' },
  device: { fill: 'var(--n-device)', stroke: 'var(--n-device-s)', label: 'Device' },
  address: { fill: 'var(--n-address)', stroke: 'var(--n-address-s)', label: 'Address' },
  category: { fill: 'var(--n-category)', stroke: 'var(--n-category-s)', label: 'Category' },
};

const EDGE_COLOR: Record<string, string> = {
  shared_device: '#2E4059',
  shared_address: '#C1462F',
  category_overlap: '#12705F',
  claim_timing: '#9A6B12',
  behavioural: '#6B7A94',
};

export function layout(nodes: GraphNode[], edges: GraphEdge[]): Positioned[] {
  const accounts = nodes.filter((n) => n.kind === 'account');
  const entities = nodes.filter((n) => n.kind !== 'account');
  const spread = (count: number, i: number, top = 62, bottom = H - 62) =>
    count <= 1 ? (top + bottom) / 2 : top + (i * (bottom - top)) / (count - 1);
  return [
    ...accounts.map((n, i) => ({ ...n, x: 150, y: spread(accounts.length, i) })),
    ...entities.map((n, i) => ({ ...n, x: W - 165, y: spread(entities.length, i) })),
  ];
}

export function NetworkGraph({
  nodes, edges, selectedId, onSelectNode, onSelectEdge, revealStep, highlightIds,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId?: string | null;
  onSelectNode?: (n: GraphNode) => void;
  onSelectEdge?: (e: GraphEdge) => void;
  /** When set, only the first N entity columns are shown (used by the demo reveal). */
  revealStep?: number;
  /** Ids to spotlight — everything else dims. Takes precedence over selection.
   *  Driven by the evidence panel so "shared device" lights up the actual nodes. */
  highlightIds?: string[] | null;
}) {
  const spotlight = highlightIds && highlightIds.length
    ? new Set(highlightIds) : null;
  const { reduceMotion } = useApp();
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const positioned = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const byId = useMemo(
    () => Object.fromEntries(positioned.map((n) => [n.id, n])), [positioned]);

  const visibleEntities = useMemo(() => {
    const ents = positioned.filter((n) => n.kind !== 'account');
    return revealStep === undefined ? ents : ents.slice(0, Math.max(0, revealStep));
  }, [positioned, revealStep]);

  const visibleIds = useMemo(
    () => new Set([...positioned.filter((n) => n.kind === 'account').map((n) => n.id),
                   ...visibleEntities.map((n) => n.id)]),
    [positioned, visibleEntities]);

  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [edges, visibleIds]);

  const reset = useCallback(() => setView({ x: 0, y: 0, k: 1 }), []);
  const zoom = useCallback((f: number) =>
    setView((v) => ({ ...v, k: Math.max(0.55, Math.min(2.4, v.k * f)) })), []);

  useEffect(() => { reset(); }, [nodes.length, reset]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setView((v) => ({
      ...v,
      x: drag.current!.vx + (e.clientX - drag.current!.x),
      y: drag.current!.vy + (e.clientY - drag.current!.y),
    }));
  };
  const onPointerUp = () => { drag.current = null; };

  return (
    <div className="relative">
      <style>{`
        :root{--n-account:#EEF1F6;--n-account-s:#2E4059;--n-device:#E4EAF4;--n-device-s:#2E4059;
              --n-address:#FAE9E4;--n-address-s:#C1462F;--n-category:#E2F0EC;--n-category-s:#12705F}
        .dark{--n-account:#1B2435;--n-account-s:#7E9CC5;--n-device:#1B2740;--n-device-s:#7E9CC5;
              --n-address:#2E1B17;--n-address-s:#E08A70;--n-category:#122B26;--n-category-s:#4FA894}
      `}</style>

      <div className="absolute right-3 top-3 z-10 flex gap-1">
        <GraphBtn label="Zoom in" onClick={() => zoom(1.2)}><ZoomIn size={14} /></GraphBtn>
        <GraphBtn label="Zoom out" onClick={() => zoom(1 / 1.2)}><ZoomOut size={14} /></GraphBtn>
        <GraphBtn label="Fit graph" onClick={reset}><Maximize2 size={14} /></GraphBtn>
        <GraphBtn label="Reset view" onClick={reset}><RotateCcw size={14} /></GraphBtn>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-grab touch-none select-none rounded-lg bg-canvas active:cursor-grabbing"
        style={{ aspectRatio: `${W} / ${H}` }}
        role="img"
        aria-label="Relationship graph of accounts and the attributes they share"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {visibleEdges.map((e, i) => {
            const a = byId[e.source];
            const b = byId[e.target];
            if (!a || !b) return null;
            const color = EDGE_COLOR[e.kind] ?? '#8A97AC';
            const lit = spotlight ? spotlight.has(e.source) && spotlight.has(e.target) : false;
            const dim = spotlight
              ? !lit
              : Boolean(selectedId && selectedId !== e.source && selectedId !== e.target);
            const strong = lit || selectedId === e.source || selectedId === e.target;
            return (
              <line
                key={`${e.source}-${e.target}-${e.kind}-${i}`}
                x1={a.x + 64} y1={a.y} x2={b.x - 70} y2={b.y}
                stroke={color}
                strokeWidth={strong ? 2.4 : 1.3}
                opacity={dim ? 0.1 : lit ? 0.95 : 0.5}
                className="cursor-pointer transition-opacity duration-300"
                onClick={(ev) => { ev.stopPropagation(); onSelectEdge?.(e); }}
              />
            );
          })}

          {positioned.filter((n) => visibleIds.has(n.id)).map((n, i) => {
            const style = KIND_STYLE[n.kind] ?? KIND_STYLE.account;
            const selected = selectedId === n.id;
            const dim = spotlight
              ? !spotlight.has(n.id)
              : Boolean(selectedId && !selected
                && !visibleEdges.some((e) =>
                  (e.source === selectedId && e.target === n.id)
                  || (e.target === selectedId && e.source === n.id)));
            return (
              <g
                key={n.id}
                className="cursor-pointer transition-opacity duration-300"
                opacity={dim ? 0.32 : 1}
                onClick={(ev) => { ev.stopPropagation(); onSelectNode?.(n); }}
                role="button"
                aria-label={`${style.label} ${n.label}`}
              >
                <NodeShape kind={n.kind} x={n.x} y={n.y}
                           fill={style.fill} stroke={style.stroke} selected={!!selected} />
                <text x={n.x} y={n.y + 4} textAnchor="middle"
                      className="pointer-events-none fill-fg font-mono text-[11px] font-semibold">
                  {n.label}
                </text>
                {n.kind === 'account' && n.meta?.return_rate_pct !== undefined && (
                  <text x={n.x} y={n.y + 26} textAnchor="middle"
                        className="pointer-events-none fill-fg3 font-mono text-[9.5px]">
                    {n.meta.return_rate_pct}%
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <GraphLegend />
    </div>
  );
}

function NodeShape({ kind, x, y, fill, stroke, selected }: {
  kind: string; x: number; y: number; fill: string; stroke: string; selected: boolean;
}) {
  const sw = selected ? 2.4 : 1.4;
  if (kind === 'account')
    return <rect x={x - 64} y={y - 15} width={128} height={30} rx={15}
                 fill={fill} stroke={stroke} strokeWidth={sw} />;
  if (kind === 'device')
    return <rect x={x - 70} y={y - 17} width={140} height={34}
                 fill={fill} stroke={stroke} strokeWidth={sw} />;
  if (kind === 'address')
    return <path d={`M${x} ${y - 21}L${x + 78} ${y}L${x} ${y + 21}L${x - 78} ${y}Z`}
                 fill={fill} stroke={stroke} strokeWidth={sw} />;
  return <ellipse cx={x} cy={y} rx={74} ry={18} fill={fill} stroke={stroke} strokeWidth={sw} />;
}

function GraphBtn({ children, label, onClick }: {
  children: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline
                       bg-surface text-fg3 shadow-card transition hover:text-fg">
      {children}
    </button>
  );
}

export function GraphLegend() {
  const nodes = [
    { label: 'Account', shape: 'rounded' }, { label: 'Device', shape: 'square' },
    { label: 'Address', shape: 'diamond' }, { label: 'Category', shape: 'ellipse' },
  ];
  const rels = [
    { label: 'Shared device', color: EDGE_COLOR.shared_device },
    { label: 'Common address', color: EDGE_COLOR.shared_address },
    { label: 'Product overlap', color: EDGE_COLOR.category_overlap },
    { label: 'Similar timing', color: EDGE_COLOR.claim_timing },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow">Nodes</span>
        {nodes.map((n) => (
          <span key={n.label} className="flex items-center gap-1.5 text-[11px] text-fg2">
            <svg width="16" height="12" aria-hidden>
              {n.shape === 'rounded' && <rect x="1" y="2" width="14" height="8" rx="4"
                fill="var(--n-account)" stroke="var(--n-account-s)" strokeWidth="1.2" />}
              {n.shape === 'square' && <rect x="2" y="2" width="12" height="8"
                fill="var(--n-device)" stroke="var(--n-device-s)" strokeWidth="1.2" />}
              {n.shape === 'diamond' && <path d="M8 1L15 6L8 11L1 6Z"
                fill="var(--n-address)" stroke="var(--n-address-s)" strokeWidth="1.2" />}
              {n.shape === 'ellipse' && <ellipse cx="8" cy="6" rx="7" ry="4"
                fill="var(--n-category)" stroke="var(--n-category-s)" strokeWidth="1.2" />}
            </svg>
            {n.label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow">Relationships</span>
        {rels.map((r) => (
          <span key={r.label} className="flex items-center gap-1.5 text-[11px] text-fg2">
            <span className="h-0.5 w-4 rounded" style={{ background: r.color }} aria-hidden />
            {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export { Crosshair };
