export const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>orch dashboard</title>
<style>
:root { --background: #fafafa; --surface: #ffffff; --primary: #2563eb; --accent: #dc2626; --ok: #16a34a; --warn: #d97706; --text: #0f172a; --muted: #64748b; --border: #e2e8f0; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--background); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; display: flex; min-height: 100vh; }
nav { width: 248px; flex-shrink: 0; background: var(--surface); border-right: 1px solid var(--border); padding: 16px 12px; position: sticky; top: 0; height: 100vh; }
nav h1 { font-size: 16px; margin: 4px 8px 16px; }
nav button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 8px 12px; border-radius: 8px; font-size: 14px; color: var(--text); cursor: pointer; }
nav button:hover { background: var(--background); }
nav button.active { background: #eff6ff; color: var(--primary); font-weight: 600; }
nav .root { margin: 16px 8px 0; font-size: 12px; color: var(--muted); word-break: break-all; }
main { flex: 1; padding: 24px 32px; max-width: 1080px; }
main h2 { font-size: 20px; margin: 0 0 4px; }
.sub { color: var(--muted); margin: 0 0 24px; }
section { display: none; }
section.active { display: block; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
.card h3 { font-size: 14px; margin: 0 0 12px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: var(--muted); font-weight: 600; padding: 8px; border-bottom: 1px solid var(--border); }
td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.tag { display: inline-block; border: 1px solid var(--border); border-radius: 6px; padding: 1px 8px; font-size: 12px; margin-right: 4px; }
.st-approved, .st-executing, .st-pass { color: var(--ok); }
.st-denied, .st-fail { color: var(--accent); }
.st-pending, .st-needs_approval, .st-needs_clarification { color: var(--warn); }
.empty { color: var(--muted); padding: 12px 0; }
.delta-up { color: var(--ok); } .delta-dn { color: var(--accent); } .delta-flat { color: var(--muted); }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 900px) { .row2 { grid-template-columns: 1fr; } nav { width: 200px; } }
.bar-label { font-size: 12px; fill: var(--muted); }
</style>
</head>
<body>
<nav>
<h1>orch dashboard</h1>
<button data-s="overview" class="active">Overview</button>
<button data-s="tasks">Tasks</button>
<button data-s="approvals">Approvals</button>
<button data-s="verification">Verification</button>
<button data-s="benchmarks">Benchmarks</button>
<div class="root" id="root"></div>
</nav>
<main>
<section id="s-overview" class="active"><h2>Overview</h2><p class="sub" id="ov-sub"></p>
<div class="row2">
<div class="card"><h3>Activity, last 30 days</h3><div id="ch-activity"></div></div>
<div class="card"><h3>Gate frequency</h3><div id="ch-gates"></div></div>
</div>
<div class="card"><h3>Tasks by status</h3><div id="ov-status"></div></div>
</section>
<section id="s-tasks"><h2>Tasks</h2><p class="sub">Most recent first. Bound means begin_execution authorized an exact action.</p>
<div class="card"><div id="t-tasks"></div></div>
</section>
<section id="s-approvals"><h2>Approvals</h2><p class="sub">Confirmation requests and terminal decisions.</p>
<div class="row2">
<div class="card"><h3>Decisions</h3><div id="ch-donut"></div></div>
<div class="card"><h3>Median decision time</h3><div id="ap-med"></div></div>
</div>
<div class="card"><div id="t-conf"></div></div>
</section>
<section id="s-verification"><h2>Verification</h2><p class="sub">Persisted verification runs, most recent first.</p>
<div class="card"><div id="t-ver"></div></div>
</section>
<section id="s-benchmarks"><h2>Benchmarks</h2><p class="sub">Last 7 days vs prior 7 days.</p>
<div class="card"><h3>Current vs previous</h3><div id="ch-bench"></div></div>
<div class="card"><h3>Deltas</h3><div id="t-delta"></div></div>
</section>
</main>
<script>
'use strict';
var NS = 'http://www.w3.org/2000/svg';
function el(n, attrs, parent) { var e = document.createElementNS(NS, n); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
// All dynamic values rendered into innerHTML pass through esc() above (XSS-safe by construction).
function get(p) { return fetch(p).then(function (r) { if (!r.ok) throw new Error(p); return r.json(); }); }
function fmtMs(ms) { if (ms == null) return 'n/a'; if (ms < 1000) return ms + ' ms'; if (ms < 60000) return (ms / 1000).toFixed(1) + ' s'; return (ms / 60000).toFixed(1) + ' min'; }
function fmtPct(x) { return x == null ? 'n/a' : (x * 100).toFixed(0) + '%'; }

document.querySelectorAll('nav button').forEach(function (b) {
  b.addEventListener('click', function () {
    document.querySelectorAll('nav button').forEach(function (x) { x.classList.remove('active'); });
    document.querySelectorAll('main section').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active');
    document.getElementById('s-' + b.dataset.s).classList.add('active');
  });
});

function bars(host, days) {
  host.innerHTML = '';
  var max = 1, i;
  for (i = 0; i < days.length; i++) max = Math.max(max, days[i].events);
  var W = 520, H = 140, svg = el('svg', { width: '100%', viewBox: '0 0 ' + W + ' ' + H }, host);
  var bw = W / days.length;
  for (i = 0; i < days.length; i++) {
    var h = Math.max(2, (days[i].events / max) * (H - 24));
    var r = el('rect', { x: (i * bw + 1).toFixed(1), y: (H - 18 - h).toFixed(1), width: Math.max(1, bw - 2).toFixed(1), height: h.toFixed(1), rx: 2, fill: days[i].events ? '#2563eb' : '#e2e8f0' }, svg);
    r.appendChild(document.createElementNS(NS, 'title')).textContent = days[i].day + ': ' + days[i].events + ' events, ' + days[i].tasks + ' tasks';
  }
}

function hbars(host, pairs, color) {
  host.innerHTML = '';
  if (!pairs.length) { host.innerHTML = '<div class="empty">No data yet.</div>'; return; }
  var max = pairs[0][1];
  var W = 460, svg = el('svg', { width: '100%', viewBox: '0 0 ' + W + ' ' + (pairs.length * 28 + 4) }, host);
  pairs.forEach(function (p, i) {
    var y = i * 28 + 4;
    el('text', { x: 0, y: y + 13, class: 'bar-label' }, svg).textContent = p[0];
    var w = Math.max(3, (p[1] / max) * (W - 170));
    el('rect', { x: 120, y: y, width: w.toFixed(1), height: 16, rx: 3, fill: color || '#2563eb' }, svg);
    el('text', { x: 126 + w, y: y + 13, class: 'bar-label' }, svg).textContent = p[1];
  });
}

function donut(host, parts) {
  host.innerHTML = '';
  var total = parts.reduce(function (a, p) { return a + p[1]; }, 0);
  if (!total) { host.innerHTML = '<div class="empty">No decisions yet.</div>'; return; }
  var svg = el('svg', { width: 180, height: 180, viewBox: '0 0 180 180' }, host);
  var cx = 90, cy = 90, r = 64, acc = 0;
  parts.forEach(function (p) {
    var frac = p[1] / total, a0 = acc * Math.PI * 2 - Math.PI / 2, a1 = (acc + frac) * Math.PI * 2 - Math.PI / 2;
    acc += frac;
    var large = frac > 0.5 ? 1 : 0;
    var d = 'M' + cx + ' ' + cy + ' L' + (cx + r * Math.cos(a0)).toFixed(1) + ' ' + (cy + r * Math.sin(a0)).toFixed(1) +
      ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + (cx + r * Math.cos(a1)).toFixed(1) + ' ' + (cy + r * Math.sin(a1)).toFixed(1) + ' Z';
    el('path', { d: d, fill: p[2], stroke: '#fff', 'stroke-width': 2 }, svg);
  });
  var legend = document.createElement('div');
  legend.style.marginTop = '8px';
  legend.innerHTML = parts.map(function (p) { return '<div><span class="tag" style="border-left: 8px solid ' + p[2] + '">' + esc(p[0]) + '</span> ' + p[1] + '</div>'; }).join('');
  host.appendChild(legend);
}

function table(host, head, rows) {
  if (!rows.length) { host.innerHTML = '<div class="empty">No rows yet.</div>'; return; }
  var h = '<table><thead><tr>' + head.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
  h += rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('');
  host.innerHTML = h + '</tbody></table>';
}
function statusTag(s) { return '<span class="st-' + esc(s) + '">' + esc(s) + '</span>'; }

function benchBars(host, cur, prev) {
  host.innerHTML = '';
  var rows = [
    ['tasks', cur.tasks, prev.tasks, false],
    ['approval %', cur.approvalRate == null ? 0 : cur.approvalRate * 100, prev.approvalRate == null ? 0 : prev.approvalRate * 100, false],
    ['verify pass %', cur.verifyPassRate == null ? 0 : cur.verifyPassRate * 100, prev.verifyPassRate == null ? 0 : prev.verifyPassRate * 100, false],
    ['gate hits', cur.gateHits, prev.gateHits, false]
  ];
  var max = 1;
  rows.forEach(function (r) { max = Math.max(max, r[1], r[2]); });
  var W = 560, svg = el('svg', { width: '100%', viewBox: '0 0 ' + W + ' ' + (rows.length * 44 + 20) }, host);
  rows.forEach(function (r, i) {
    var y = i * 44 + 10;
    el('text', { x: 0, y: y + 13, class: 'bar-label' }, svg).textContent = r[0];
    var w1 = Math.max(3, (r[1] / max) * (W - 220)), w2 = Math.max(3, (r[2] / max) * (W - 220));
    el('rect', { x: 140, y: y, width: w1.toFixed(1), height: 14, rx: 3, fill: '#2563eb' }, svg);
    el('text', { x: 146 + w1, y: y + 12, class: 'bar-label' }, svg).textContent = 'now ' + (+r[1].toFixed(1));
    el('rect', { x: 140, y: y + 18, width: w2.toFixed(1), height: 14, rx: 3, fill: '#94a3b8' }, svg);
    el('text', { x: 146 + w2, y: y + 30, class: 'bar-label' }, svg).textContent = 'prev ' + (+r[2].toFixed(1));
  });
}
function deltaRow(label, c, p, invert) {
  var cls = 'delta-flat', txt = 'n/a';
  if (c != null && p != null) {
    var d = c - p;
    if (Math.abs(d) < 1e-9) { txt = 'no change'; }
    else { var good = invert ? d < 0 : d > 0; cls = good ? 'delta-up' : 'delta-dn'; txt = (d > 0 ? '+' : '') + d.toFixed(2); }
  } else if (c != null) { txt = String(c.toFixed ? +c.toFixed(2) : c) + ' (no baseline)'; }
  return '<tr><td>' + esc(label) + '</td><td>' + (c == null ? 'n/a' : esc(String(c))) + '</td><td>' + (p == null ? 'n/a' : esc(String(p))) + '</td><td class="' + cls + '">' + esc(txt) + '</td></tr>';
}

get('/api/overview').then(function (ov) {
  var n = Object.values(ov.tasksByStatus).reduce(function (a, b) { return a + b; }, 0);
  document.getElementById('ov-sub').textContent = n + ' tasks, ' + ov.events + ' events recorded.';
  var st = Object.entries(ov.tasksByStatus);
  document.getElementById('ov-status').innerHTML = st.length ? st.map(function (p) { return '<span class="tag">' + statusTag(p[0]) + ' ' + p[1] + '</span>'; }).join('') : '<div class="empty">No tasks yet.</div>';
  hbars(document.getElementById('ch-gates'), Object.entries(ov.gateFreq).sort(function (a, b) { return b[1] - a[1]; }));
});
get('/api/activity?days=30').then(function (a) { bars(document.getElementById('ch-activity'), a); });
get('/api/tasks').then(function (t) {
  table(document.getElementById('t-tasks'), ['id', 'goal / prompt', 'status', 'created', 'bound'],
    t.map(function (r) { return ['<span class="mono">' + esc(r.id) + '</span>', esc(r.goal || r.prompt), statusTag(r.status), esc(String(r.createdAt).slice(0, 16).replace('T', ' ')), r.bound ? 'yes' : 'no']; }));
});
get('/api/confirmations').then(function (c) {
  var ap = c.filter(function (r) { return r.status === 'approved'; }).length;
  var dn = c.filter(function (r) { return r.status === 'denied'; }).length;
  var pd = c.filter(function (r) { return r.status === 'pending'; }).length;
  donut(document.getElementById('ch-donut'), [['approved', ap, '#16a34a'], ['denied', dn, '#dc2626'], ['pending', pd, '#d97706']]);
  var dms = c.filter(function (r) { return r.decisionMs != null; }).map(function (r) { return r.decisionMs; }).sort(function (a, b) { return a - b; });
  document.getElementById('ap-med').innerHTML = dms.length ? '<div style="font-size:24px">' + esc(fmtMs(dms[Math.floor(dms.length / 2)])) + '</div><div class="empty">' + dms.length + ' decided</div>' : '<div class="empty">No decisions yet.</div>';
  table(document.getElementById('t-conf'), ['fingerprint', 'task', 'gates', 'status', 'decided in'],
    c.map(function (r) { return ['<span class="mono">' + esc(r.fingerprint) + '</span>', '<span class="mono">' + esc(String(r.taskId).slice(0, 10)) + '</span>', r.gates.map(function (g) { return '<span class="tag">' + esc(g) + '</span>'; }).join(''), statusTag(r.status), esc(fmtMs(r.decisionMs))]; }));
});
get('/api/verifications').then(function (v) {
  table(document.getElementById('t-ver'), ['when', 'task', 'result', 'checks', 'findings'],
    v.map(function (r) {
      var checks = (r.checks || []).map(function (c) { return esc(c.name || '') + ':' + esc(c.status || ''); }).join(', ');
      return [esc(String(r.createdAt).slice(0, 16).replace('T', ' ')), '<span class="mono">' + esc(String(r.taskId || '').slice(0, 10)) + '</span>',
        r.ok == null ? 'n/a' : (r.ok ? '<span class="st-pass">pass</span>' : '<span class="st-fail">fail</span>'), esc(checks), esc(String((r.findings || []).length))];
    }));
});
get('/api/benchmark').then(function (b) {
  benchBars(document.getElementById('ch-bench'), b.current, b.previous);
  document.getElementById('t-delta').innerHTML = '<table><thead><tr><th>metric</th><th>current</th><th>previous</th><th>delta</th></tr></thead><tbody>' +
    deltaRow('tasks started', b.current.tasks, b.previous.tasks, false) +
    deltaRow('approval rate', b.current.approvalRate, b.previous.approvalRate, false) +
    deltaRow('median decision ms', b.current.medianDecisionMs, b.previous.medianDecisionMs, true) +
    deltaRow('verify pass rate', b.current.verifyPassRate, b.previous.verifyPassRate, false) +
    deltaRow('gate hits', b.current.gateHits, b.previous.gateHits, true) + '</tbody></table>';
});
</script>
</body>
</html>`;
