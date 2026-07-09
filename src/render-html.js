// Single-file, self-contained HTML report for debugging a run.
//
// Unlike flow_report.md (great for git/sharing, weak for navigating a long
// run), this export is built for jumping around: a sticky turn index, an
// "errors only" filter, deep-link anchors (#turn-N) so back/forward returns you
// to the exact turn, and an in-page modal for full text — clicking a truncated
// block never opens a new tab. No server, no CDN: everything is inlined.
//
// renderHtml(flow, { sidecars }) where `sidecars` maps a block's `.sidecar`
// path (e.g. "sidecar/3_req_request.txt") to its raw full text.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(ts) {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function fmtDate(ts) {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Escape a JSON string for safe inlining inside <script>: neutralize `<` (so
// `</script>` can't break out) and the raw line separators U+2028/U+2029 which
// are illegal in JS string literals. The regex is built from escape sequences
// so no literal separator ever appears in this source file.
function jsonForScript(obj) {
  const unsafe = new RegExp('[<\\u2028\\u2029]', 'g');
  return JSON.stringify(obj).replace(unsafe, c =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

// One text block → inline HTML. Truncated blocks get a button that opens the
// full text (from the embedded SIDECARS map) in the modal.
function blockHtml(b, label) {
  if (!b) return '';
  const preview = esc(b.preview || '');
  let out = `<div class="blk"><div class="blk-h">${esc(label)}</div><pre class="prev">${preview}</pre>`;
  if (b.sidecar) {
    out += `<button class="full-btn" data-sc="${esc(b.sidecar)}" data-title="${esc(label)}">📄 View full text (${b.fullLen.toLocaleString()} chars)</button>`;
  }
  out += '</div>';
  return out;
}

function actionSummary(turn) {
  const acts = (turn.actions || []).map(a => {
    const icon = a.kind === 'tool' ? '🛠️' : '💻';
    const what = a.kind === 'tool' ? (a.what.tool || 'tool') : String(a.what.command || '').split(/\s+/).slice(0, 2).join(' ');
    return `${icon} ${what}`.trim();
  });
  let s = acts.length ? acts.join(' · ') : '💬 no action';
  if (s.length > 60) s = s.slice(0, 57) + '…';
  return s;
}

function turnHtml(turn) {
  const P = [];
  const cls = turn.hasError ? 'turn err' : 'turn';
  P.push(`<section id="turn-${turn.index}" class="${cls}" data-err="${turn.hasError ? 1 : 0}">`);
  const icon = turn.hasError ? '❌' : '🔄';
  const ctx = turn.request.contextWindow ? ` · 🪟 ${turn.request.contextWindow.percent}%` : '';
  P.push(`<h3>${icon} Turn ${turn.index}
    <span class="meta">${fmtTime(turn.tsStart)} – ${fmtTime(turn.tsEnd)} · +${Math.round(turn.durationMs / 1000)}s · ${turn.request.tokensIn}→${turn.request.tokensOut} tok${ctx}</span>
    <a class="top" href="#top">↑ index</a></h3>`);

  if (turn.request && (turn.request.text?.preview || turn.request.text?.sidecar)) {
    P.push(`<div class="sub-meta">Tokens in ${turn.request.tokensIn} · cache R/W ${turn.request.cacheReads}/${turn.request.cacheWrites} · $${turn.request.cost.toFixed(4)}${turn.request.contextWindow ? ` · ctx ${esc(turn.request.contextWindow.raw)}` : ''}</div>`);
    P.push(blockHtml(turn.request.text, '✉️ API Request Prompt'));
  }
  if (turn.reasoning) P.push(blockHtml(turn.reasoning, '🧠 AI Reasoning'));
  for (const s of (turn.texts || [])) P.push(blockHtml(s, `💬 Agent · ${fmtTime(s.ts)}`));

  for (const a of turn.actions) {
    const what = a.kind === 'tool' ? `${a.what.tool} ${a.what.path || ''}`.trim() : a.what.command;
    const icon2 = a.kind === 'tool' ? '🛠️' : '💻';
    P.push(`<div class="action">`);
    P.push(`<div class="act-h">${icon2} <b>${esc(a.kind)}:</b> <code>${esc(what)}</code> <span class="meta">${fmtTime(a.ts)}</span></div>`);
    if (a.why) P.push(`<div class="why">🎯 ${esc(a.why)}</div>`);
    if (a.output) {
      const delta = ((a.output.ts - a.ts) / 1000).toFixed(2);
      const errAlert = a.output.isError ? ` <span class="err-tag">⚠️ Error</span>` : '';
      P.push(`<div class="out-h">📥 Output · ${fmtTime(a.output.ts)} · +${delta}s${errAlert}</div>`);
      P.push(blockHtml(a.output, '📄 Output'));
    }
    P.push('</div>');
  }

  if (turn.taskProgress && turn.taskProgress.items.length) {
    P.push('<div class="prog">📋 Progress<ul>');
    for (const it of turn.taskProgress.items) P.push(`<li>${it.done ? '☑' : '☐'} ${esc(it.text)}</li>`);
    P.push('</ul></div>');
  }
  if (turn.checkpoint) P.push(`<div class="ckpt">💾 checkpoint <code>${esc(turn.checkpoint.hash)}</code></div>`);
  P.push('</section>');
  return P.join('\n');
}

const STYLE = `
/* Midnight (default). Themes swap these tokens via :root[data-theme="..."];
   the switcher in the sidebar sets that attribute and persists it (shared
   localStorage key 'analyzerTheme' with the live dashboard). */
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--fg:#c9d1d9;--muted:#8b949e;--accent:#58a6ff;--err:#f85149;--errbg:#2d1416;--code:var(--code);--hover:var(--hover);--btn:#21262d;--btn-hover:#2b333d}
:root[data-theme="dev"]{--bg:#05070c;--panel:#0b0f1a;--border:#2a3550;--fg:#ffffff;--muted:#b6c2d4;--accent:#7dd3fc;--err:#fb7185;--errbg:#2a1015;--code:#000000;--hover:#141c2b;--btn:#141c2b;--btn-hover:#1e2940}
:root[data-theme="light"]{--bg:#f6f8fa;--panel:#ffffff;--border:#d0d7de;--fg:#1f2328;--muted:#656d76;--accent:#0969da;--err:#cf222e;--errbg:#ffebe9;--code:#f6f8fa;--hover:#eaeef2;--btn:#f3f4f6;--btn-hover:#e7e9ec}
:root[data-theme="claude"]{--bg:#f0eee6;--panel:#faf9f5;--border:#e3ddd0;--fg:#2b2a27;--muted:#6b6658;--accent:#d97757;--err:#be123c;--errbg:#f7e6e2;--code:#f3f0e7;--hover:#ece7db;--btn:#efeae0;--btn-hover:#e4ddce}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}
.layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
aside{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;border-right:1px solid var(--border);background:var(--panel);padding:14px}
aside h1{font-size:15px;margin:0 0 10px}
.tot{font-size:12px;color:var(--muted);margin-bottom:12px}
.tot b{color:var(--fg)}
.filter{display:flex;align-items:center;gap:6px;margin-bottom:10px;font-size:13px;cursor:pointer;user-select:none}
.nav a{display:block;padding:5px 8px;border-radius:6px;color:var(--fg);text-decoration:none;font-size:13px;border-left:3px solid transparent}
.nav a:hover{background:var(--hover)}
.nav a.err{color:var(--err)}
.nav a.active{background:var(--hover);border-left-color:var(--accent)}
.nav small{color:var(--muted)}
main{padding:20px 28px;max-width:1000px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:18px}
.card table{border-collapse:collapse;width:100%}
.card td{padding:4px 8px;border-bottom:1px solid var(--border);font-size:13px}
.card td:first-child{color:var(--muted);white-space:nowrap;width:170px}
.turn{border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;scroll-margin-top:12px}
.turn.err{border-color:var(--err);background:var(--errbg)}
.turn h3{margin:0 0 8px;font-size:15px;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.meta{color:var(--muted);font-weight:400;font-size:12px}
.top{margin-left:auto;font-size:12px;color:var(--accent);text-decoration:none}
.sub-meta{color:var(--muted);font-size:12px;margin-bottom:6px}
.blk{margin:8px 0}
.blk-h{font-size:12px;color:var(--muted);margin-bottom:3px}
pre.prev{background:var(--code);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin:0;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
.full-btn{margin-top:4px;background:var(--btn);color:var(--accent);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
.full-btn:hover{background:var(--btn-hover)}
.action{border-left:2px solid var(--border);padding-left:10px;margin:10px 0}
.act-h code{background:var(--code);padding:1px 5px;border-radius:4px}
.why{color:var(--muted);font-size:13px;margin:2px 0}
.out-h{font-size:12px;color:var(--muted);margin-top:4px}
.err-tag{color:var(--err);font-weight:600}
.prog ul,.prog{font-size:13px;color:var(--muted)}
.ckpt{font-size:12px;color:var(--muted);margin-top:6px}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:50}
.modal.on{display:flex;align-items:center;justify-content:center}
.modal-box{background:var(--panel);border:1px solid var(--border);border-radius:10px;width:min(900px,92vw);max-height:86vh;display:flex;flex-direction:column}
.modal-top{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)}
.modal-top b{font-size:13px}
.modal-x{background:none;border:none;color:var(--fg);font-size:20px;cursor:pointer}
.modal pre{margin:0;padding:14px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,Consolas,monospace}
.hide{display:none!important}
details.mmd{margin-bottom:18px}
details.mmd pre{background:var(--code);border:1px solid var(--border);border-radius:6px;padding:10px;overflow:auto}
.theme-sw{display:flex;gap:4px;margin-bottom:12px}
.theme-sw button{flex:1;background:var(--btn);border:1px solid var(--border);color:var(--muted);border-radius:6px;padding:5px 0;cursor:pointer;font-size:14px;line-height:1}
.theme-sw button:hover{background:var(--btn-hover);color:var(--fg)}
.theme-sw button.active{color:var(--fg);border-color:var(--accent)}
`;

const SCRIPT = `
const SC = window.__SIDECARS__ || {};
const modal = document.getElementById('modal');
const mbody = document.getElementById('modal-body');
const mtitle = document.getElementById('modal-title');
function openModal(key, title){
  mbody.textContent = SC[key] != null ? SC[key] : '(full text unavailable)';
  mtitle.textContent = title || 'Full text';
  modal.classList.add('on');
}
function closeModal(){ modal.classList.remove('on'); }
document.querySelectorAll('.full-btn').forEach(b=>{
  b.addEventListener('click',()=>openModal(b.dataset.sc, b.dataset.title));
});
document.getElementById('modal-x').addEventListener('click',closeModal);
modal.addEventListener('click',e=>{ if(e.target===modal) closeModal(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });

const filter = document.getElementById('f-err');
filter.addEventListener('change',()=>{
  const on = filter.checked;
  document.querySelectorAll('section.turn').forEach(s=>{
    s.classList.toggle('hide', on && s.dataset.err!=='1');
  });
  document.querySelectorAll('.nav a').forEach(a=>{
    if(a.dataset.err!==undefined) a.classList.toggle('hide', on && a.dataset.err!=='1');
  });
});

const links = [...document.querySelectorAll('.nav a[href^="#turn-"]')];
const byId = {};
links.forEach(a=>byId[a.getAttribute('href').slice(1)]=a);
const obs = new IntersectionObserver(es=>{
  es.forEach(e=>{ if(e.isIntersecting){
    links.forEach(l=>l.classList.remove('active'));
    const a = byId[e.target.id]; if(a) a.classList.add('active');
  }});
},{rootMargin:'-10% 0px -80% 0px'});
document.querySelectorAll('section.turn').forEach(s=>obs.observe(s));

// Theme switcher — shares the 'analyzerTheme' localStorage key with the dashboard.
const THEMES = ['midnight','dev','light','claude'];
function applyTheme(n){
  if(!THEMES.includes(n)) n='midnight';
  document.documentElement.setAttribute('data-theme', n);
  try{ localStorage.setItem('analyzerTheme', n); }catch(e){}
  document.querySelectorAll('.theme-sw button').forEach(b=>b.classList.toggle('active', b.dataset.t===n));
}
(function(){ let s='midnight'; try{ s=localStorage.getItem('analyzerTheme')||'midnight'; }catch(e){} applyTheme(s); })();
document.querySelectorAll('.theme-sw button').forEach(b=>b.addEventListener('click',()=>applyTheme(b.dataset.t)));
`;

export function renderHtml(flow, { sidecars = {} } = {}) {
  const t = flow.totals;
  const first = flow.turns[0], last = flow.turns[flow.turns.length - 1];

  const nav = flow.turns.map(turn =>
    `<a href="#turn-${turn.index}" data-err="${turn.hasError ? 1 : 0}" class="${turn.hasError ? 'err' : ''}">${turn.hasError ? '❌' : '🔄'} Turn ${turn.index} <small>+${Math.round(turn.durationMs / 1000)}s</small><br><small>${esc(actionSummary(turn))}</small></a>`
  ).join('\n');

  const meta = [
    ['Task', esc(flow.taskId)],
    ['Prompt', `<code>${esc(flow.prompt.replace(/\r?\n/g, ' ').slice(0, 300))}</code>`],
    flow.model ? ['Model', `${esc(flow.model.modelId)} (${esc(flow.model.mode)})`] : null,
    ['Execution', `${fmtDate(first ? first.tsStart : null)} – ${fmtDate(last ? last.tsEnd : null)} · ${Math.round(t.durationMs / 1000)}s`],
    ['Resource', `${t.turns} turns · ${t.events} events`],
    ['Tokens', `in ${t.tokensIn.toLocaleString()} · out ${t.tokensOut.toLocaleString()}`],
    ['Cache R/W', `${t.cacheReads.toLocaleString()} / ${t.cacheWrites.toLocaleString()}`],
    ['Cost', `$${t.cost.toFixed(4)}`]
  ].filter(Boolean).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

  const turnsHtml = flow.turns.map(turnHtml).join('\n');

  const completion = flow.completion && (flow.completion.preview || flow.completion.sidecar)
    ? blockHtml(flow.completion, '🏁 Completion Result')
    : '<p class="meta">No completion recorded.</p>';

  const scJson = jsonForScript(sidecars);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flow Report · ${esc(flow.taskId)}</title>
<style>${STYLE}</style>
<script>(function(){try{var t=localStorage.getItem('analyzerTheme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}})();</script></head>
<body><a id="top"></a>
<div class="layout">
<aside>
  <h1>📊 Turn Index</h1>
  <div class="theme-sw" role="group" aria-label="Color theme">
    <button data-t="midnight" title="Midnight (dark)">🌙</button>
    <button data-t="dev" title="Dev high-contrast">▤</button>
    <button data-t="light" title="Light">☀</button>
    <button data-t="claude" title="Claude cream">✦</button>
  </div>
  <div class="tot"><b>${t.turns}</b> turns · <b>${flow.turns.filter(x => x.hasError).length}</b> ❌ · $${t.cost.toFixed(4)}</div>
  <label class="filter"><input type="checkbox" id="f-err"> Errors only</label>
  <nav class="nav">${nav}</nav>
</aside>
<main>
  <div class="card"><table>${meta}</table></div>
  <details class="mmd"><summary>🗺️ Flow diagram (Mermaid source)</summary><pre>${esc(flow.mermaid || '')}</pre></details>
  ${turnsHtml}
  <div class="card" id="completion">${completion}</div>
</main>
</div>
<div class="modal" id="modal"><div class="modal-box">
  <div class="modal-top"><b id="modal-title">Full text</b><button class="modal-x" id="modal-x">×</button></div>
  <pre id="modal-body"></pre>
</div></div>
<script>window.__SIDECARS__=${scJson};</script>
<script>${SCRIPT}</script>
</body></html>`;
}
