# RefundShield — Frontend

Investigator workstation for coordinated return-abuse triage.
**Every number on every screen comes from the API.** Nothing is hard-coded.

## Stack

| Concern | Choice |
|---|---|
| Framework | React 18 + TypeScript 5 + Vite 6 |
| Styling | Tailwind CSS 3 with CSS-variable design tokens (light + dark) |
| Animation | Framer Motion for interactive surfaces; CSS keyframes for content reveals |
| Charts | Recharts |
| Graph | Hand-built SVG (see note below) |
| Icons | Lucide React — no emoji |
| Tests | Vitest + Testing Library + jsdom |

**Why not React Flow or Cytoscape for the graph.** The relationship view is a small
bipartite layout — accounts on the left, shared entities on the right — where node
*shape* carries meaning (rounded = account, square = device, diamond = address,
ellipse = category). A general-purpose graph library fights that layout, ships
several hundred KB, and buys nothing at this node count. Pan, zoom, fit, reset and
selection are a few dozen lines of SVG.

## Running

```bash
npm install
cp .env.example .env      # optional; blank uses the Vite proxy
npm run dev               # http://localhost:5173, proxies /api to :8000
npm run build && npm run preview
npm test
```

The backend must be running:

```bash
cd ../backend && uvicorn app.main:app --port 8000
```

`VITE_API_BASE_URL` is the only environment variable. Leave it blank in development
and the Vite proxy forwards `/api` to the backend.

## Structure

```
src/
├── components/
│   ├── layout/      AppShell, GlobalSearch, ScenarioMenu
│   ├── command/     CommandPalette (Ctrl/Cmd-K)
│   ├── risk/        RiskBadge, ScoreCard, ScoreRing, MeterRow, Panel, Tooltip
│   ├── evidence/    WhyPrioritised, EvidenceGroups, AhaMoment
│   ├── network/     NetworkGraph + legend
│   ├── charts/      ThresholdChart, RiskDistribution
│   ├── tables/      DataTable (sort, filter, paginate), FilterChip
│   ├── timeline/    Timeline
│   └── feedback/    Skeletons, ErrorState, EmptyState, ToastHost, Reveal
├── pages/           Dashboard, Investigations, InvestigationDetail, Accounts,
│                    AccountDetail, NetworkExplorer, ThresholdAnalysis,
│                    Scenarios, About
├── services/api.ts  the ONLY place fetch() is called
├── types/models.ts  types mirroring the API responses
├── hooks/           useAsync, useCountUp, useInView, useDebounced
├── state/           scenario, theme, toasts, reduced motion
└── lib/format.ts    risk colour + text tokens, formatters
```

## The bug worth knowing about

Three separate features shipped content that was **invisible unless an animation
completed**, and all three broke the same way when `requestAnimationFrame` stalled:

| Symptom | Cause |
|---|---|
| Two whole pages blank | Framer Motion held the page at `opacity: 0` |
| Counters stuck at 26 / 49.0 instead of 31 / 65.3 | rAF loop stopped mid-count |
| Every chart bar flat at zero against a y-axis scaled to 8 | Recharts grew bars from height 0 |

rAF is suspended in background tabs, throttled on low-power devices, and does not
advance under automated capture. So the rule now enforced across the app is:

> **Nothing that carries information may start at `opacity: 0` or height `0`
> waiting on JavaScript.**

- `Reveal` uses a CSS keyframe with `animation-fill-mode: both`, so the resting
  state is visible and the animation is purely additive. Its delay is capped at
  260 ms, because an element is invisible for the whole of its delay.
- `useCountUp` runs a rAF loop *and* a `setTimeout` safety net that always settles
  on the true value.
- Chart entrance animation is off; the panel still animates in via the CSS reveal.

## Accessibility

Keyboard navigation throughout; visible focus rings via `:focus-visible`; ARIA
labels on icon-only controls; `role="combobox"/"listbox"/"option"` on both search
surfaces; semantic buttons; table headers carry `aria-sort`. Risk is **always
colour *and* text** — `LOW`, `MODERATE`, `HIGH`, `VERY HIGH` are printed, never
implied by hue. `prefers-reduced-motion` is honoured at the CSS level and mirrored
into app state so JS-driven values jump straight to their final figure.

## Responsive

Desktop is the demo target. Below `lg` the sidebar becomes a drawer; tables scroll
horizontally inside their card; the graph keeps its aspect ratio and stays
pannable; multi-column grids collapse to one column.
