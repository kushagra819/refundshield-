"""Render the Coordination Investigation view from REAL engine output.

Interactive: relationship-type filters, clickable nodes and edges. Consumes the
same payloads the API serves, so the React page in Phase 6/7 renders identical
numbers.

    python tools/render_coordination.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import SYNTHETIC_NOTICE
from app.data.generator import generate
from app.domain.models import ScenarioId
from app.engines.queue import run

OUT = Path(__file__).resolve().parents[2] / "docs" / "coordination.html"


def payload(scenario: ScenarioId) -> dict:
    a = run(generate(scenario))
    # Select by NETWORK evidence, not coordination risk. For the household
    # scenario the point of the view is precisely that the strongest relational
    # overlap in the seller's data still scores LOW coordination — picking the
    # highest coordination score would hide the very cluster being argued about.
    c = max(a.clusters, key=lambda x: (x.network_evidence, -len(x.account_ids)))
    best = a.coordination.clusters[c.cluster_id]

    nodes, edges = [], []
    for aid in c.account_ids:
        f = a.features[aid]
        nodes.append({"id": aid, "kind": "account", "label": aid,
                      "rate": round(f.return_rate * 100, 1),
                      "individual": round(a.individual[aid].score, 1),
                      "band": a.individual[aid].band,
                      "threshold": round(a.threshold.account_signals[aid].signal, 1)})
    for dev, members in c.shared_devices.items():
        nodes.append({"id": dev, "kind": "device", "label": dev, "members": members})
        for m in members:
            edges.append({"source": m, "target": dev, "kind": "shared_device",
                          "label": "Shared device",
                          "detail": f"{len(members)} accounts use {dev}."})
    for addr, members in c.shared_addresses.items():
        nodes.append({"id": addr, "kind": "address", "label": addr, "members": members})
        for m in members:
            edges.append({"source": m, "target": addr, "kind": "shared_address",
                          "label": "Common address",
                          "detail": f"{len(members)} accounts deliver to {addr}."})
    for cat in c.shared_categories:
        nodes.append({"id": cat, "kind": "category", "label": cat,
                      "members": c.account_ids})
        for m in c.account_ids:
            edges.append({"source": m, "target": cat, "kind": "category_overlap",
                          "label": "Product overlap",
                          "detail": f"All members order in {cat}."})
    if c.claim_window and c.temporal_overlap >= 0.3:
        lo, hi = c.claim_window
        wid = f"WINDOW {lo.isoformat()}"
        nodes.append({"id": wid, "kind": "timing", "label": "Claim window",
                      "members": c.account_ids})
        for m in c.account_ids:
            edges.append({"source": m, "target": wid, "kind": "claim_timing",
                          "label": "Similar claim timing",
                          "detail": f"Claims fall between {lo.isoformat()} "
                                    f"and {hi.isoformat()}."})

    return {
        "scenario": scenario.value,
        "cluster": {**c.to_dict(), "coordination": best.to_dict()},
        "nodes": nodes, "edges": edges,
        "explanation": a.explain_cluster(best.cluster_id).to_dict(),
        "queue": [r.to_dict() for r in a.queue[:6]],
        "summary": a.summary(),
    }


def main() -> None:
    data = {s.value: payload(s) for s in
            (ScenarioId.COORDINATED, ScenarioId.HOUSEHOLD,
             ScenarioId.ISOLATED, ScenarioId.NORMAL)}

    html = """<!doctype html>
<meta charset="utf-8">
<title>RefundShield — Coordination Investigation</title>
<style>
 *{box-sizing:border-box}
 :root{--ink:#111726;--ink2:#39435A;--muted:#7C8699;--faint:#AEB6C4;--paper:#F7F8FA;
  --surf:#fff;--surf2:#EDEFF4;--line:#D8DDE6;--slate:#2E4059;--rust:#C1462F;
  --rustbg:#F9E9E4;--teal:#1C6A5E;--tealbg:#E2EFEC;--amber:#8A6318;--amberbg:#F5EEDD}
 body{margin:0;background:var(--paper);color:var(--ink);font:14px 'Segoe UI',system-ui,sans-serif}
 .wrap{max-width:1280px;margin:0 auto;padding:24px 22px 44px}
 header{border-bottom:2px solid var(--ink);padding-bottom:14px;margin-bottom:18px}
 .bar{width:44px;height:5px;background:var(--rust);margin-bottom:10px}
 h1{margin:0;font-size:25px;letter-spacing:-.02em}
 .sub{color:var(--muted);margin-top:5px}
 .tabs{display:flex;gap:6px;margin-top:14px;flex-wrap:wrap}
 .tab{font:600 12px 'Segoe UI';padding:7px 13px;border:1px solid var(--line);
   background:var(--surf);border-radius:3px;cursor:pointer;color:var(--ink2)}
 .tab.on{background:var(--ink);color:#fff;border-color:var(--ink)}
 .cols{display:grid;grid-template-columns:1.15fr .85fr;gap:16px;align-items:start}
 @media(max-width:1080px){.cols{grid-template-columns:1fr}}
 .card{background:var(--surf);border:1px solid var(--line);border-radius:3px;
   padding:16px 18px;margin-bottom:16px}
 .card.alert{border-color:var(--rust);border-width:2px}
 .eyebrow{font:700 10px Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;
   color:var(--muted)}
 h2{font-size:16px;margin:5px 0 12px}
 .chip{font:700 11px Consolas,monospace;padding:4px 10px;border-radius:20px;white-space:nowrap}
 .hi{background:var(--rustbg);color:var(--rust)} .lo{background:var(--tealbg);color:var(--teal)}
 .mid{background:var(--amberbg);color:var(--amber)}
 .row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
 table{border-collapse:collapse;width:100%;font-size:13px}
 th{font:700 10px Consolas,monospace;letter-spacing:.06em;text-transform:uppercase;
   color:var(--muted);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
 td{padding:7px 8px;border-bottom:1px solid var(--surf2)}
 .mono{font-family:Consolas,monospace} .num{text-align:right}
 .bd{display:grid;grid-template-columns:1fr auto 66px;gap:8px;align-items:center;
   padding:7px 0;border-bottom:1px solid var(--surf2);font-size:13px}
 .meter{width:100%;height:7px;background:var(--surf2);border-radius:1px;overflow:hidden}
 .meter i{display:block;height:100%;background:var(--slate)}
 .meter i.r{background:var(--rust)}
 .total{display:grid;grid-template-columns:1fr 66px;gap:8px;align-items:center;
   margin-top:10px;padding-top:10px;border-top:2px solid var(--ink);font-weight:700}
 ol{margin:0;padding-left:20px} ol li{margin-bottom:7px;line-height:1.5;font-size:13px}
 .note{background:var(--surf2);padding:11px 14px;border-radius:3px;font-size:12px;
   color:var(--ink2);line-height:1.55;margin-top:12px}
 .filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
 .f{font:600 11px 'Segoe UI';padding:5px 10px;border:1px solid var(--line);
   background:var(--surf);border-radius:14px;cursor:pointer;color:var(--ink2)}
 .f.on{background:var(--slate);color:#fff;border-color:var(--slate)}
 svg{display:block;width:100%;height:auto;background:var(--surf)}
 .ndlabel{font:600 10px Consolas,monospace;fill:var(--ink2)}
 .inspect{min-height:54px;background:var(--surf2);border-radius:3px;padding:10px 13px;
   font-size:12.5px;color:var(--ink2);margin-top:10px;line-height:1.5}
 .action{background:var(--ink);color:#fff;padding:14px 18px;border-radius:3px;margin-top:14px}
 .action b{font-size:15px} .action p{margin:6px 0 0;font-size:12px;color:#9AA5B8}
 footer{margin-top:22px;padding-top:13px;border-top:1px solid var(--line);
   font-size:11px;color:var(--muted)}
</style>
<div class="wrap">
<header>
  <div class="bar"></div>
  <h1>Coordination Investigation</h1>
  <div class="sub">Three independent evidence streams combined into one investigation priority.</div>
  <div class="tabs" id="tabs"></div>
</header>
<div class="cols">
  <div>
    <div class="card" id="clusterCard"></div>
    <div class="card">
      <div class="eyebrow">Relationship graph</div>
      <h2>Why these accounts are connected</h2>
      <div class="filters" id="filters"></div>
      <svg id="graph" viewBox="0 0 640 400"></svg>
      <div class="inspect" id="inspect">Click a node or an edge to see the evidence behind it.</div>
      <div class="note"><b>Connections provide context.</b> Behavioural evidence is required
        to strengthen investigation priority. No single shared attribute proves fraud.</div>
    </div>
  </div>
  <div>
    <div class="card" id="breakdownCard"></div>
    <div class="card" id="membersCard"></div>
    <div class="card" id="whyCard"></div>
    <div class="card" id="queueCard"></div>
  </div>
</div>
<footer id="foot"></footer>
</div>
<script>
const DATA = __DATA__;
const ORDER = ["coordinated","household","isolated","normal"];
const NAMES = {coordinated:"Coordinated Threshold Evasion",household:"Legitimate Shared Household",
  isolated:"Isolated Abuse",normal:"Normal Customers"};
const KINDS = {shared_device:"Device",shared_address:"Address",
  category_overlap:"Product",claim_timing:"Timing"};
const FILL = {account:"#EDEFF4",device:"#E6EBF3",address:"#F9E9E4",
  category:"#E2EFEC",timing:"#F5EEDD"};
const STROKE = {account:"#2E4059",device:"#2E4059",address:"#C1462F",
  category:"#1C6A5E",timing:"#8A6318"};
let current = "coordinated", filter = "all";

function cls(b){return b==="HIGH"||b==="VERY HIGH"?"hi":b==="MODERATE"?"mid":"lo";}

function tabs(){
  document.getElementById("tabs").innerHTML = ORDER.map(k =>
    `<button class="tab${k===current?" on":""}" data-k="${k}">${NAMES[k]}</button>`).join("");
  document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
    current = b.dataset.k; filter = "all"; render();
  });
}

function render(){
  const d = DATA[current], c = d.cluster, co = c.coordination, bd = co.breakdown;
  tabs();

  document.getElementById("clusterCard").className = "card" + (
    ["HIGH","VERY HIGH"].includes(co.band) ? " alert" : "");
  document.getElementById("clusterCard").innerHTML = `
    <div class="row">
      <div><div class="eyebrow">Cluster ${c.cluster_id} &middot; ${c.size} accounts</div>
        <h2>${d.explanation.headline}</h2></div>
      <span class="chip ${cls(co.band)}">${co.band} &middot; ${co.coordination_risk}/100</span>
    </div>
    <table><tr><th>Evidence categories</th><th>Investigation priority</th>
      <th>Return-rate range</th><th>Benign factor</th></tr>
      <tr><td class="mono">${co.evidence_categories.join(", ")||"—"}</td>
      <td class="mono"><b>${co.investigation_priority}</b></td>
      <td class="mono">${c.return_rate_range[0]}%–${c.return_rate_range[1]}%</td>
      <td class="mono">${co.breakdown.benign_factor}</td></tr></table>`;

  const meter = (v,r)=>`<div class="meter"><i class="${r?'r':''}" style="width:${v}%"></i></div>`;
  document.getElementById("breakdownCard").innerHTML = `
    <div class="eyebrow">Coordination score breakdown</div>
    <h2>How the score is built</h2>
    <div class="bd"><span>Individual risk context</span>${meter(bd.individual_risk_context)}
      <span class="mono num">${bd.individual_risk_context}</span></div>
    <div class="bd"><span>Threshold-evasion signal</span>${meter(bd.threshold_evasion_signal,1)}
      <span class="mono num">${bd.threshold_evasion_signal}</span></div>
    <div class="bd"><span>Network evidence</span>${meter(bd.network_evidence,1)}
      <span class="mono num">${bd.network_evidence}</span></div>
    <div class="bd" style="color:var(--muted)"><span>&times; benign-household factor</span>
      <span></span><span class="mono num">${bd.benign_factor}</span></div>
    <div class="total"><span>Coordination risk</span>
      <span class="mono num">${bd.coordination_risk}</span></div>
    <div class="note">Weights — network ${bd.weights.network}, threshold ${bd.weights.threshold},
      individual ${bd.weights.individual}. ${bd.notice}</div>`;

  document.getElementById("membersCard").innerHTML = `
    <div class="eyebrow">Individual accounts</div>
    <h2>Each account on its own</h2>
    <table><tr><th>Account</th><th class="num">Return rate</th><th>Individual</th>
      <th class="num">Threshold</th></tr>
    ${d.nodes.filter(n=>n.kind==="account").map(n=>`<tr>
      <td class="mono">${n.id}</td><td class="mono num">${n.rate}%</td>
      <td><span class="chip ${cls(n.band)}">${n.band}</span></td>
      <td class="mono num">${n.threshold}</td></tr>`).join("")}</table>`;

  document.getElementById("whyCard").innerHTML = `
    <div class="eyebrow">Why prioritised</div>
    <h2>Evidence behind the score</h2>
    <ol>${d.explanation.reasons.map(r=>`<li>${r}</li>`).join("")}</ol>
    <div class="note">${d.explanation.closing}</div>
    <div class="action"><b>${co.recommended_action}</b>
      <p>${co.action_note}</p></div>`;

  document.getElementById("queueCard").innerHTML = `
    <div class="eyebrow">Investigation queue &middot; top ${d.queue.length}</div>
    <h2>What to open first</h2>
    <table><tr><th>P</th><th>Return</th><th>Account</th><th class="num">Ind</th>
      <th class="num">Coord</th><th>Reasons</th></tr>
    ${d.queue.map(r=>`<tr><td class="mono">${r.priority_label}</td>
      <td class="mono">${r.return_id}</td><td class="mono">${r.account_id}</td>
      <td class="mono num">${r.individual_risk}</td>
      <td class="mono num"><b>${r.coordination_risk}</b></td>
      <td style="font-size:11.5px">${r.primary_reasons.join(" &middot; ")}</td></tr>`).join("")}
    </table>`;

  const kinds = [...new Set(d.edges.map(e=>e.kind))];
  document.getElementById("filters").innerHTML =
    [`<button class="f${filter==="all"?" on":""}" data-f="all">All relationships</button>`]
    .concat(kinds.map(k=>`<button class="f${filter===k?" on":""}" data-f="${k}">${KINDS[k]||k}</button>`))
    .join("");
  document.querySelectorAll(".f").forEach(b=>b.onclick=()=>{filter=b.dataset.f;render();});

  drawGraph(d);
  document.getElementById("foot").textContent =
    `${d.summary.total_return_requests} return requests · ${d.summary.clusters_found} clusters · `
    + `threshold signal ${d.summary.threshold_signal}/100 (${d.summary.threshold_band}) · `
    + "Synthetic demonstration environment — no real customer data.";
}

function drawGraph(d){
  const svg = document.getElementById("graph");
  const edges = filter==="all" ? d.edges : d.edges.filter(e=>e.kind===filter);
  const accounts = d.nodes.filter(n=>n.kind==="account");
  const keep = new Set(edges.flatMap(e=>[e.source,e.target]));
  const ents = d.nodes.filter(n=>n.kind!=="account" && keep.has(n.id));
  const W=640,H=400,pos={};
  accounts.forEach((n,i)=>{pos[n.id]=[70, 58 + i*(284/Math.max(1,accounts.length-1||1))];});
  ents.forEach((n,i)=>{pos[n.id]=[470, 58 + i*(284/Math.max(1,ents.length-1||1))];});

  const shape=(n,x,y)=>{
    if(n.kind==="account") return `<rect x="${x-52}" y="${y-13}" width="104" height="26" rx="13"
      fill="${FILL.account}" stroke="${STROKE.account}" stroke-width="1.3"/>`;
    if(n.kind==="device") return `<rect x="${x-56}" y="${y-14}" width="112" height="28"
      fill="${FILL.device}" stroke="${STROKE.device}" stroke-width="1.3"/>`;
    if(n.kind==="address") return `<path d="M${x} ${y-17}L${x+62} ${y}L${x} ${y+17}L${x-62} ${y}Z"
      fill="${FILL.address}" stroke="${STROKE.address}" stroke-width="1.5"/>`;
    if(n.kind==="category") return `<ellipse cx="${x}" cy="${y}" rx="60" ry="15"
      fill="${FILL.category}" stroke="${STROKE.category}" stroke-width="1.3"/>`;
    return `<rect x="${x-58}" y="${y-14}" width="116" height="28" rx="4"
      fill="${FILL.timing}" stroke="${STROKE.timing}" stroke-width="1.3"/>`;
  };

  svg.innerHTML =
    edges.map((e,i)=>{
      const [x1,y1]=pos[e.source]||[0,0], [x2,y2]=pos[e.target]||[0,0];
      return `<line x1="${x1+52}" y1="${y1}" x2="${x2-56}" y2="${y2}"
        stroke="${STROKE[d.nodes.find(n=>n.id===e.target)?.kind]||'#D8DDE6'}"
        stroke-width="1.2" opacity=".5" style="cursor:pointer" data-e="${i}"/>`;
    }).join("")
    + [...accounts,...ents].map(n=>{
      const [x,y]=pos[n.id];
      const sub = n.kind==="account" ? `<text x="${x}" y="${y+24}" text-anchor="middle"
        class="ndlabel" style="fill:#7C8699">${n.rate}% · ${n.band}</text>` : "";
      return `<g style="cursor:pointer" data-n="${n.id}">${shape(n,x,y)}
        <text x="${x}" y="${y+4}" text-anchor="middle" class="ndlabel">${n.label}</text>${sub}</g>`;
    }).join("");

  svg.querySelectorAll("[data-e]").forEach(el=>el.onclick=()=>{
    const e=edges[+el.dataset.e];
    document.getElementById("inspect").innerHTML =
      `<b>${e.label}</b> — ${e.detail} <br><span style="color:var(--muted)">`
      + `A relationship is context, not proof.</span>`;
  });
  svg.querySelectorAll("[data-n]").forEach(el=>el.onclick=()=>{
    const n=d.nodes.find(x=>x.id===el.dataset.n);
    document.getElementById("inspect").innerHTML = n.kind==="account"
      ? `<b>${n.id}</b> — return rate ${n.rate}%, individual risk ${n.individual}/100 `
        + `(${n.band}), threshold signal ${n.threshold}/100.`
      : `<b>${n.label}</b> — shared by ${(n.members||[]).length} accounts: `
        + `${(n.members||[]).join(", ")}.`;
  });
}
render();
</script>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html.replace("__DATA__", json.dumps(data)), encoding="utf-8")

    for k, v in data.items():
        co = v["cluster"]["coordination"]
        print(f'{k:<13} {v["cluster"]["cluster_id"]} n={v["cluster"]["size"]} '
              f'coord={co["coordination_risk"]:5.1f} {co["band"]:<9} '
              f'priority={co["investigation_priority"]}')
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
