"""Render the Threshold Analysis view from REAL engine output.

Produces a standalone, screenshot-ready HTML page. This is the Phase 3
deliverable for the threshold view; the React page in Phase 7 will consume the
same `ThresholdEvasionResult` contract, so the numbers shown here are exactly
what the API will serve.

    python tools/render_threshold_chart.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import SYNTHETIC_NOTICE
from app.data.generator import RING_ACCOUNTS, generate
from app.domain.models import SCENARIO_META, ScenarioId
from app.engines import threshold_engine as te
from app.engines.features import build_features

OUT = Path(__file__).resolve().parents[2] / "docs" / "threshold_analysis.html"

PALETTE = {
    "ink": "#111726", "ink2": "#39435A", "muted": "#7C8699", "faint": "#AEB6C4",
    "paper": "#F7F8FA", "surf": "#FFFFFF", "surf2": "#EDEFF4", "line": "#D8DDE6",
    "slate": "#2E4059", "rust": "#C1462F", "rustbg": "#F9E9E4",
    "teal": "#1C6A5E", "tealbg": "#E2EFEC",
}


def chart_svg(result: te.ThresholdEvasionResult, width: int = 560, height: int = 260) -> str:
    bins = [b for b in result.bins if b.lower <= 0.30]
    peak = max([b.count for b in bins] + [1])
    pad_l, pad_b, pad_t = 34, 30, 14
    plot_w, plot_h = width - pad_l - 12, height - pad_b - pad_t
    bw = plot_w / len(bins)
    base_y = pad_t + plot_h

    parts: list[str] = []
    # expected-trend line across the window
    trend: list[str] = []
    for i, b in enumerate(bins):
        x = pad_l + i * bw
        h = b.count / peak * plot_h
        fill = {"window": PALETTE["rust"], "reference": "#B9C2D0",
                "guard": "#D5DAE3"}.get(b.role, "#C7CEDA")
        parts.append(
            f'<rect x="{x + bw * 0.12:.1f}" y="{base_y - h:.1f}" '
            f'width="{bw * 0.76:.1f}" height="{h:.1f}" fill="{fill}"/>'
        )
        if b.expected is not None:
            ey = base_y - (b.expected / peak * plot_h)
            trend.append(f'{x + bw * 0.5:.1f},{ey:.1f}')
            parts.append(
                f'<rect x="{x + bw * 0.12:.1f}" y="{ey:.1f}" width="{bw * 0.76:.1f}" '
                f'height="{max(0.0, base_y - ey):.1f}" fill="none" '
                f'stroke="{PALETTE["slate"]}" stroke-width="1.2" stroke-dasharray="3 2"/>'
            )
        if i % 5 == 0:
            parts.append(
                f'<text x="{x + bw * 0.5:.1f}" y="{base_y + 14:.0f}" font-size="9" '
                f'fill="{PALETTE["muted"]}" text-anchor="middle" '
                f'font-family="Consolas,monospace">{b.lower * 100:.0f}%</text>'
            )

    # threshold marker
    idx = next((i for i, b in enumerate(bins)
                if abs(b.lower - result.threshold) < 1e-9), None)
    if idx is not None:
        tx = pad_l + idx * bw
        parts.append(
            f'<line x1="{tx:.1f}" y1="{pad_t - 6:.0f}" x2="{tx:.1f}" y2="{base_y + 4:.0f}" '
            f'stroke="{PALETTE["rust"]}" stroke-width="1.6" stroke-dasharray="5 4"/>'
        )
        parts.append(
            f'<text x="{tx - 5:.1f}" y="{pad_t - 1:.0f}" font-size="9" font-weight="700" '
            f'fill="{PALETTE["rust"]}" text-anchor="end" '
            f'font-family="Consolas,monospace">THRESHOLD {result.threshold * 100:.0f}%</text>'
        )

    parts.append(
        f'<line x1="{pad_l}" y1="{base_y}" x2="{pad_l + plot_w:.0f}" y2="{base_y}" '
        f'stroke="{PALETTE["ink2"]}" stroke-width="1.2"/>'
    )
    parts.append(
        f'<text x="{pad_l}" y="{height - 4}" font-size="9" fill="{PALETTE["faint"]}" '
        f'font-family="Segoe UI,sans-serif">Reliable accounts by return rate '
        f'(n = {result.eligible_accounts})</text>'
    )
    return (f'<svg viewBox="0 0 {width} {height}" role="img" '
            f'aria-label="Return-rate distribution with threshold marker">'
            + "".join(parts) + "</svg>")


def panel(scenario: ScenarioId, result: te.ThresholdEvasionResult) -> str:
    meta = SCENARIO_META[scenario]
    elevated = result.bunching_score >= 60
    accent = PALETTE["rust"] if elevated else PALETTE["line"]
    chip_bg = PALETTE["rustbg"] if elevated else PALETTE["tealbg"]
    chip_fg = PALETTE["rust"] if elevated else PALETTE["teal"]
    title = ("Possible threshold evasion" if elevated
             else "No excess concentration below threshold")
    return f"""
    <section class="panel" style="border-color:{accent};border-width:{2 if elevated else 1}px">
      <div class="phead">
        <div>
          <div class="eyebrow" style="color:{chip_fg}">{meta['name']}</div>
          <h3>{title}</h3>
        </div>
        <div class="chip" style="background:{chip_bg};color:{chip_fg}">
          {result.signal_band} &middot; {result.bunching_score:.0f}/100
        </div>
      </div>
      {chart_svg(result)}
      <dl class="stats">
        <div><dt>Observed in window</dt><dd>{result.observed_count}</dd></div>
        <div><dt>Expected (local trend)</dt><dd>{result.expected_count:.2f}</dd></div>
        <div><dt>Excess</dt><dd style="color:{chip_fg}">{result.excess_count:+.2f}</dd></div>
        <div><dt>p-value</dt><dd>{result.p_value:.4f}</dd></div>
      </dl>
      <p class="explain">{result.explanation}</p>
    </section>"""


def main() -> None:
    results: dict[ScenarioId, te.ThresholdEvasionResult] = {}
    for s in ScenarioId:
        feats, _ = build_features(generate(s))
        results[s] = te.analyse(feats)

    hero = results[ScenarioId.COORDINATED]
    feats, _ = build_features(generate(ScenarioId.COORDINATED))
    rows = "".join(
        f"<tr><td class='mono'>{a}</td>"
        f"<td class='mono num'>{feats[a].return_rate * 100:.1f}%</td>"
        f"<td><span class='pill low'>LOW</span></td>"
        f"<td class='mono num'>{hero.account_signals[a].signal:.0f}</td></tr>"
        for a in RING_ACCOUNTS
    )

    order = [ScenarioId.NORMAL, ScenarioId.COORDINATED,
             ScenarioId.HOUSEHOLD, ScenarioId.ISOLATED]
    panels = "".join(panel(s, results[s]) for s in order)

    html = f"""<!doctype html>
<meta charset="utf-8">
<title>RefundShield — Threshold Analysis</title>
<style>
  *{{box-sizing:border-box}}
  body{{margin:0;background:{PALETTE['paper']};color:{PALETTE['ink']};
       font-family:'Segoe UI',system-ui,sans-serif;font-size:14px}}
  .wrap{{max-width:1180px;margin:0 auto;padding:26px 22px 40px}}
  header{{border-bottom:2px solid {PALETTE['ink']};padding-bottom:14px;margin-bottom:20px}}
  .bar{{width:44px;height:5px;background:{PALETTE['rust']};margin-bottom:10px}}
  h1{{margin:0;font-size:26px;letter-spacing:-.02em}}
  .sub{{color:{PALETTE['muted']};margin-top:6px}}
  .tags{{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}}
  .tag{{font-family:Consolas,monospace;font-size:10px;letter-spacing:.1em;
        padding:3px 8px;border-radius:2px;background:{PALETTE['surf2']};
        color:{PALETTE['slate']};text-transform:uppercase}}
  .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:16px}}
  .panel{{background:{PALETTE['surf']};border:1px solid {PALETTE['line']};
          border-radius:3px;padding:16px 18px}}
  .phead{{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}}
  .eyebrow{{font-family:Consolas,monospace;font-size:10px;letter-spacing:.12em;
            text-transform:uppercase;font-weight:700}}
  h3{{margin:4px 0 10px;font-size:15px}}
  .chip{{font-family:Consolas,monospace;font-size:11px;font-weight:700;
         padding:4px 10px;border-radius:20px;white-space:nowrap}}
  .stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:10px 0 0;
          padding:10px 0;border-top:1px solid {PALETTE['line']}}}
  .stats div{{margin:0}} .stats dt{{font-size:10px;color:{PALETTE['muted']};
    text-transform:uppercase;letter-spacing:.06em}}
  .stats dd{{margin:3px 0 0;font-family:Consolas,monospace;font-size:15px;font-weight:700}}
  .explain{{font-size:12px;color:{PALETTE['ink2']};line-height:1.5;margin:10px 0 0}}
  .hero{{background:{PALETTE['surf']};border:1px solid {PALETTE['line']};
         border-left:4px solid {PALETTE['rust']};padding:16px 18px;margin-bottom:16px}}
  table{{border-collapse:collapse;width:100%;max-width:520px;margin-top:8px}}
  th{{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:{PALETTE['muted']};
      text-align:left;padding:6px 10px;border-bottom:1px solid {PALETTE['line']}}}
  td{{padding:7px 10px;border-bottom:1px solid {PALETTE['surf2']}}}
  .mono{{font-family:Consolas,monospace}} .num{{text-align:right}}
  .pill{{font-family:Consolas,monospace;font-size:10px;font-weight:700;padding:2px 8px;
         border-radius:10px}}
  .low{{background:{PALETTE['tealbg']};color:{PALETTE['teal']}}}
  .note{{background:{PALETTE['surf2']};padding:12px 16px;border-radius:3px;
         font-size:12px;color:{PALETTE['ink2']};line-height:1.55;margin-top:16px}}
  .note b{{color:{PALETTE['ink']}}}
  footer{{margin-top:22px;padding-top:14px;border-top:1px solid {PALETTE['line']};
          font-size:11px;color:{PALETTE['muted']}}}
</style>
<div class="wrap">
  <header>
    <div class="bar"></div>
    <h1>Threshold Evasion Analysis</h1>
    <div class="sub">Does this seller's population contain more accounts parked just
      below the decision threshold than the surrounding distribution can explain?</div>
    <div class="tags">
      <span class="tag">Illustrative threshold {hero.threshold * 100:.0f}%</span>
      <span class="tag">Synthetic demonstration data</span>
      <span class="tag">Window {hero.window[0] * 100:.0f}%&ndash;{hero.window[1] * 100:.0f}%</span>
      <span class="tag">Baseline: local trend fit</span>
    </div>
  </header>

  <div class="hero">
    <div class="eyebrow" style="color:{PALETTE['rust']}">Individual view vs threshold view</div>
    <h3 style="margin-bottom:2px">Every ring account is acceptable on its own</h3>
    <table>
      <tr><th>Account</th><th class="num">Return rate</th><th>Individual risk</th>
          <th class="num">Threshold signal</th></tr>
      {rows}
    </table>
    <p class="explain" style="max-width:70ch">
      Each account sits below the seller's {hero.threshold * 100:.0f}% threshold and scores
      LOW individually. The threshold signal is not derived from any one account's rate — it
      comes from the fact that <b>{hero.observed_count} reliable accounts</b> occupy a window
      where the surrounding distribution predicts <b>{hero.expected_count:.2f}</b>.
    </p>
  </div>

  <div class="grid">{panels}</div>

  <div class="note">
    <b>Why it matters.</b> An unusual concentration immediately below a decision threshold
    can indicate that behaviour is adapting to the decision boundary rather than occurring
    naturally. RefundShield does not flag accounts merely because they are close to
    {hero.threshold * 100:.0f}%: it looks for excess concentration of reliable account return
    rates immediately below the threshold relative to the surrounding population. This
    threshold-evasion signal is later combined with cross-account relationships and
    behavioural similarity to identify coordinated risk.
    <br><br>
    <b>Important.</b> {hero.caveat} {hero.notice}
  </div>

  <footer>{SYNTHETIC_NOTICE} &middot; RefundShield &middot; CX0507 &middot; The Anomaly Syndicate</footer>
</div>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")

    summary = {s.value: {k: v for k, v in results[s].to_dict().items()
                         if k in ("observed_count", "expected_count", "excess_count",
                                  "p_value", "bunching_score", "signal_band")}
               for s in ScenarioId}
    print(json.dumps(summary, indent=2))
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
