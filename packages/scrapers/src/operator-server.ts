/* eslint-disable no-console */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runSingleSource, OPERATOR_SOURCES, type OperatorSourceResult } from './operator/index.js';
import { killEngineChrome } from './operator/chrome-path.js';

/**
 * Consola web del operador PlacaPe. Servidor Node nativo. El operador abre la UI,
 * pega la placa, corre el motor con **barra de progreso (SSE) y botón Cancelar**,
 * pega el historial SPRL (manual) y marca el pedido listo (→ n8n/Supabase).
 *
 * Uso:  CAPTCHA_API_KEY=... [OPERATOR_OUT_BASE=...] npx tsx packages/scrapers/src/operator-server.ts
 */
const PORT = Number(process.env.OPERATOR_PORT ?? 3010);
const KEY = process.env.CAPTCHA_API_KEY ?? '';
const PROVIDER = process.env.CAPTCHA_PROVIDER ?? 'capsolver';
const N8N_WEBHOOK = process.env.N8N_WEBHOOK_URL ?? '';
const OUT_BASE = process.env.OPERATOR_OUT_BASE ?? 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes/operador';
if (!KEY) { console.error('Falta CAPTCHA_API_KEY (CapSolver) en el entorno.'); process.exit(1); }

const plateDir = (plate: string) => join(OUT_BASE, plate.toUpperCase().replace(/[^A-Z0-9]/g, ''));
const baseOpts = (plate: string, source?: string) => ({
  outDir: plateDir(plate), captchaProvider: PROVIDER, captchaApiKey: KEY,
  ...(source && source !== 'sunarp' ? { headless: true } : {}),
});

// Pesos (segundos estimados) para que la barra avance de forma realista por fuente.
const WEIGHT: Record<string, number> = { sunarp: 25, historial: 240, superbid: 80 };
const weightOf = (id: string) => WEIGHT[id] ?? 30;

interface Job {
  id: string; plate: string; sources: string[];
  results: OperatorSourceResult[]; percent: number; current: string; step: string;
  done: boolean; cancelled: boolean; error?: string;
}
const jobs = new Map<string, Job>();
const newId = () => `j${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Última línea del log de la fuente (sin timestamp) → texto de "paso" en la barra. */
async function lastLogLine(plate: string, id: string): Promise<string> {
  try {
    const txt = await readFile(join(plateDir(plate), `${id}.log`), 'utf8');
    const lines = txt.trim().split('\n');
    return (lines[lines.length - 1] ?? '').replace(/^\S+\s/, '').slice(0, 90);
  } catch { return ''; }
}

async function runJob(job: Job): Promise<void> {
  const total = job.sources.reduce((s, id) => s + weightOf(id), 0) || 1;
  let doneW = 0;
  for (const src of job.sources) {
    if (job.cancelled) break;
    job.current = src;
    const t0 = Date.now();
    const tick = setInterval(() => {
      const cur = Math.min((Date.now() - t0) / 1000, weightOf(src));
      job.percent = Math.min(99, Math.round(((doneW + cur) / total) * 100));
      void lastLogLine(job.plate, src).then((l) => { if (l) job.step = l; });
    }, 700);
    let result: OperatorSourceResult;
    try {
      result = await runSingleSource(job.plate, src, baseOpts(job.plate, src));
    } catch (e) {
      result = { source: src.toUpperCase(), label: src, category: 'OTRO', status: 'ERROR', summary: (e as Error).message, ms: Date.now() - t0 };
    }
    clearInterval(tick);
    doneW += weightOf(src);
    job.results.push(result);
    job.percent = Math.round((doneW / total) * 100);
  }
  job.step = '';
  job.done = true;
  if (!job.cancelled) {
    job.percent = 100;
    try {
      await mkdir(plateDir(job.plate), { recursive: true });
      await writeFile(join(plateDir(job.plate), 'reporte.json'),
        JSON.stringify({ plate: job.plate, generatedAt: new Date().toISOString(), results: job.results }, null, 2), 'utf8');
    } catch { /* noop */ }
  }
}

function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}
const sendJson = (res: import('node:http').ServerResponse, code: number, obj: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(HTML);
    }
    if (path === '/api/sources' && req.method === 'GET') return sendJson(res, 200, OPERATOR_SOURCES);

    // Inicia un job y devuelve su id (el progreso se sigue por SSE).
    if (path === '/api/run' && req.method === 'POST') {
      const body = await readBody(req);
      const plate = String(body.placa ?? '').trim();
      if (!plate) return sendJson(res, 400, { error: 'falta placa' });
      const sources = Array.isArray(body.sources) && body.sources.length ? (body.sources as string[]) : ['sunarp'];
      const job: Job = { id: newId(), plate, sources, results: [], percent: 0, current: sources[0], step: 'iniciando…', done: false, cancelled: false };
      jobs.set(job.id, job);
      console.log(`[operador] run ${plate} (${sources.join(',')}) job=${job.id}`);
      void runJob(job).catch((e) => { job.error = (e as Error).message; job.done = true; });
      return sendJson(res, 200, { jobId: job.id });
    }

    // Progreso en vivo (Server-Sent Events).
    if (path.startsWith('/api/progress/') && req.method === 'GET') {
      const job = jobs.get(path.split('/').pop() ?? '');
      if (!job) return sendJson(res, 404, { error: 'job no encontrado' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const send = () => res.write(`data: ${JSON.stringify({ percent: job.percent, current: job.current, step: job.step, results: job.results, done: job.done, cancelled: job.cancelled, error: job.error })}\n\n`);
      send();
      const iv = setInterval(() => {
        send();
        if (job.done) { clearInterval(iv); res.end(); setTimeout(() => jobs.delete(job.id), 60000); }
      }, 700);
      req.on('close', () => clearInterval(iv));
      return;
    }

    // Cancela un job: marca cancelado y mata el Chrome del motor → la fuente en curso aborta.
    if (path.startsWith('/api/cancel/') && req.method === 'POST') {
      const job = jobs.get(path.split('/').pop() ?? '');
      if (job && !job.done) { job.cancelled = true; killEngineChrome(); console.log(`[operador] cancel job=${job.id}`); }
      return sendJson(res, 200, { cancelled: true });
    }

    if (path === '/api/retry' && req.method === 'POST') {
      const body = await readBody(req);
      const plate = String(body.placa ?? '').trim();
      const source = String(body.source ?? '').trim();
      if (!plate || !source) return sendJson(res, 400, { error: 'falta placa o source' });
      console.log(`[operador] retry ${plate} · ${source}`);
      const result = await runSingleSource(plate, source, baseOpts(plate, source));
      return sendJson(res, 200, result);
    }

    if (path === '/api/send' && req.method === 'POST') {
      const body = await readBody(req);
      const payload = {
        plate: body.placa, whatsapp: body.whatsapp, email: body.email,
        sprl: body.sprl, precioCompra: body.precioCompra, results: body.results, at: new Date().toISOString(),
      };
      let sent = false;
      if (N8N_WEBHOOK) {
        try {
          const r = await fetch(N8N_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          sent = r.ok;
          console.log(`[operador] enviado a n8n (${r.status})`);
        } catch (e) { console.warn('[operador] n8n falló:', (e as Error).message); }
      } else {
        console.log('[operador] N8N_WEBHOOK_URL no configurado → pedido marcado listo localmente');
      }
      return sendJson(res, 200, { sent, n8n: !!N8N_WEBHOOK });
    }

    if (path.startsWith('/log/') && req.method === 'GET') {
      const parts = path.split('/').filter(Boolean);
      const plate = (parts[1] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const id = (parts[2] ?? '').replace(/[^a-z0-9-]/gi, '');
      if (!plate || !id) return sendJson(res, 404, { error: 'no encontrado' });
      try {
        const buf = await readFile(join(OUT_BASE, plate, `${id}.log`));
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(buf);
      } catch { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('(sin log todavía)'); }
    }

    if (path.startsWith('/shot/') && req.method === 'GET') {
      const parts = path.split('/').filter(Boolean);
      const plate = (parts[1] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const file = (parts[2] ?? '').replace(/[^A-Za-z0-9._-]/g, '');
      if (!plate || !file.endsWith('.png')) return sendJson(res, 404, { error: 'no encontrado' });
      try {
        const buf = await readFile(join(OUT_BASE, plate, file));
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(buf);
      } catch { return sendJson(res, 404, { error: 'screenshot no encontrado' }); }
    }

    sendJson(res, 404, { error: 'ruta no encontrada' });
  } catch (e) {
    console.error('[operador] error:', (e as Error).message);
    sendJson(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`\n🛠  Consola del operador PlacaPe → http://localhost:${PORT}`);
  console.log(`   CapSolver: ${PROVIDER} · entrega n8n: ${N8N_WEBHOOK ? 'configurada' : 'sin webhook (modo local)'}\n`);
});

const HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Consola del operador · PlacaPe</title>
<style>
  :root{--azul:#1E3A8A;--teal:#0C6F64;--bg:#F1F5F9;--card:#fff;--bd:#E2E8F0;--mut:#64748B;--ok:#15803D;--err:#B91C1C;--warn:#B45309}
  *{box-sizing:border-box} body{margin:0;font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:#0F172A}
  header{background:var(--azul);color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px}
  header b{font-size:18px} header span{opacity:.8;font-size:13px}
  main{max-width:1040px;margin:0 auto;padding:20px}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  input,textarea{font:inherit;padding:10px 12px;border:1px solid var(--bd);border-radius:10px;background:#fff}
  input#placa{font:600 18px ui-monospace,monospace;letter-spacing:2px;text-transform:uppercase;width:160px}
  button{font:600 14px inherit;padding:10px 16px;border:0;border-radius:10px;background:var(--azul);color:#fff;cursor:pointer}
  button.sec{background:#fff;color:var(--azul);border:1px solid var(--bd)}
  button.ok{background:var(--teal)} button.danger{background:#fff;color:var(--err);border:1px solid #FCA5A5} button:disabled{opacity:.5;cursor:not-allowed}
  .src{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--mut);margin-right:8px}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;margin-top:16px}
  .card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px}
  .card h3{margin:0 0 6px;font-size:15px} .badge{font:700 11px ui-monospace,monospace;padding:2px 8px;border-radius:999px}
  .b-ENCONTRADO{background:#DCFCE7;color:var(--ok)} .b-SIN_REGISTRO{background:#E2E8F0;color:#475569}
  .b-ERROR{background:#FEE2E2;color:var(--err)} .b-REQUIERE_DNI{background:#FEF3C7;color:var(--warn)}
  .sum{font-size:13px;color:#334155;margin:6px 0} .meta{font-size:12px;color:var(--mut)}
  .card img{width:100%;border:1px solid var(--bd);border-radius:8px;margin-top:8px;cursor:zoom-in}
  .panel{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px;margin-top:18px}
  .panel h2{margin:0 0 10px;font-size:16px} textarea{width:100%;min-height:90px;font:13px ui-monospace,monospace}
  #log{font:12px ui-monospace,monospace;background:#0F172A;color:#cbd5e1;border-radius:10px;padding:10px;max-height:160px;overflow:auto;margin-top:14px;white-space:pre-wrap}
  label{display:block;font-size:12px;color:var(--mut);margin:8px 0 3px}
  .card.wide{grid-column:1/-1}
  .flag-banner{background:#FEE2E2;color:#B91C1C;font-weight:700;padding:8px 12px;border-radius:8px;margin:8px 0}
  .ok-banner{background:#DCFCE7;color:#15803D;font-weight:600;padding:8px 12px;border-radius:8px;margin:8px 0}
  .tl{margin:10px 0;border-left:3px solid var(--bd);padding-left:14px}
  .tl-i{margin:0 0 12px}
  .tl-d{font:700 12px ui-monospace,monospace;color:var(--azul)}
  .tl-b{font-size:13px;color:#334155}
  .tl-p{color:#0C6F64;font-weight:700}
  .tl-o{font-size:12px;color:var(--mut);margin-top:2px}
  .barwrap{height:12px;background:#E2E8F0;border-radius:999px;overflow:hidden;margin-top:10px}
  #bar{height:100%;width:0;background:linear-gradient(90deg,var(--teal),var(--azul));transition:width .4s ease}
  #prog .row{justify-content:space-between;align-items:center}
  #step{font-size:13px;color:var(--mut)} #pct{font:700 15px ui-monospace,monospace;color:var(--azul)}
</style></head><body>
<header><b>🛠 Consola del operador · PlacaPe</b><span>scraping · VPS Perú</span></header>
<main>
  <div class="row">
    <input id="placa" placeholder="ABC123" maxlength="8">
    <button id="go" onclick="run()">Generar reporte</button>
    <button class="sec" onclick="toggleSrc()">Fuentes ▾</button>
  </div>
  <div id="srcbox" class="row" style="display:none;margin-top:10px"></div>

  <div class="panel" id="prog" style="display:none">
    <div class="row">
      <b id="step">…</b>
      <div class="row"><span id="pct">0%</span><button class="danger" onclick="cancelRun()">Cancelar</button></div>
    </div>
    <div class="barwrap"><div id="bar"></div></div>
  </div>

  <div id="cards" class="cards"></div>

  <div class="panel" id="sprlPanel" style="display:none">
    <h2>Historial de propietarios (SPRL · manual)</h2>
    <div class="meta">Pega aquí el JSON de asientos descifrado (snippet de consola del SPRL). Es el dato premium.</div>
    <textarea id="sprl" placeholder='{"asientos":[...]}'></textarea>
    <label>Precio de compra del último propietario (Síguelo Plus · manual · gratis)</label>
    <input id="precio" placeholder="ej. US$ 18,881 (CONTADO)" style="width:100%">
    <h2 style="margin-top:14px">Entrega</h2>
    <div class="row">
      <div><label>WhatsApp</label><input id="wa" placeholder="9XXXXXXXX"></div>
      <div><label>Correo</label><input id="mail" placeholder="cliente@correo.com"></div>
      <div style="align-self:flex-end"><button class="ok" onclick="send()">Marcar listo y enviar</button></div>
    </div>
  </div>
  <div id="log"></div>
</main>
<script>
var SOURCES=[], LAST=null, ES=null, JOB=null;
function log(m){var l=document.getElementById('log');l.textContent+= (new Date().toLocaleTimeString())+'  '+m+'\\n';l.scrollTop=l.scrollHeight;}
function plate(){return document.getElementById('placa').value.toUpperCase().replace(/[^A-Z0-9]/g,'');}
fetch('/api/sources').then(function(r){return r.json()}).then(function(s){SOURCES=s;var b=document.getElementById('srcbox');
  b.innerHTML=s.map(function(x){return '<label class="src"><input type="checkbox" '+(x.default?'checked':'')+' value="'+x.id+'"> '+x.label+'</label>'}).join('');});
function toggleSrc(){var b=document.getElementById('srcbox');b.style.display=b.style.display==='none'?'flex':'none';}
function chosen(){var c=[].slice.call(document.querySelectorAll('#srcbox input:checked'));return c.map(function(i){return i.value})}
function badge(s){return '<span class="badge b-'+s+'">'+s+'</span>'}
function esc(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function flagBanner(f){if(!f)return'';var b=[];if(f.aseguradora)b.push('ASEGURADORA');if(f.remate)b.push('CASA DE REMATE');if(f.financiera)b.push('FINANCIERA');if(f.gravamen)b.push('GRAVAMEN');if(f.embargo)b.push('EMBARGO');
  if(!b.length)return '<div class="ok-banner">✓ Sin banderas — no pasó por aseguradora ni remate</div>';
  return '<div class="flag-banner">🚩 REVISAR: '+b.join(' · ')+'</div>';}
function timelineHtml(r){if(!r.data||!r.data.timeline)return'';
  return flagBanner(r.data.flags)+'<div class="tl">'+r.data.timeline.map(function(a){
    return '<div class="tl-i"><div class="tl-d">'+esc((a.fechaPresentacion||'').slice(0,10))+'</div>'+
    '<div class="tl-b"><b>'+esc(a.acto||a.tipo||'')+'</b>'+(a.precio?' · <span class="tl-p">'+esc(a.precio)+'</span>':'')+
    (a.formaPago?' · '+esc(a.formaPago):'')+'<div class="tl-o">'+esc((a.participantes||'').slice(0,100))+'</div></div></div>';
  }).join('')+'</div>';}
function srcId(code){return code.toLowerCase().replace(/_/g,'-');}
function card(r){
  var actions='<div style="margin-top:8px"><button class="sec" onclick="retry(\\''+r.source+'\\')">Reintentar</button> <a href="/log/'+plate()+'/'+srcId(r.source)+'" target="_blank" style="font-size:13px;color:#0C6F64;margin-left:8px">ver log</a></div>';
  if(r.source==='HISTORIAL'&&r.data&&r.data.timeline){
    return '<div class="card wide" id="c-'+r.source+'"><h3>'+r.label+' '+badge(r.status)+'</h3><div class="sum">'+esc(r.summary||'')+'</div>'+
    timelineHtml(r)+'<div class="meta">'+(r.ms/1000).toFixed(1)+'s · sede '+esc((r.data.sede||''))+'</div>'+actions+'</div>';}
  var img=r.screenshot?'<img src="/shot/'+plate()+'/'+r.source.toLowerCase().replace(/_/g,"-")+'.png?t='+Date.now()+'" onclick="window.open(this.src)">':'';
  return '<div class="card" id="c-'+r.source+'"><h3>'+r.label+' '+badge(r.status)+'</h3><div class="sum">'+esc(r.summary||'')+'</div>'+
  '<div class="meta">'+(r.ms/1000).toFixed(1)+'s</div>'+img+actions+'</div>';}
function renderCards(results){if(!results)return;document.getElementById('cards').innerHTML=results.map(card).join('');
  results.forEach(function(r){var im=document.querySelector('#c-'+r.source+' img'); if(im){im.src='/shot/'+plate()+'/'+srcId(r.source)+'.png?t='+Date.now();}});}
function showProg(on){document.getElementById('prog').style.display=on?'block':'none';}
function setBar(pct,txt){document.getElementById('bar').style.width=pct+'%';document.getElementById('pct').textContent=pct+'%';document.getElementById('step').textContent=txt||'';}
function run(){var p=plate();if(!p){alert('Pon una placa');return;}
  var go=document.getElementById('go');go.disabled=true;go.textContent='Corriendo…';
  document.getElementById('cards').innerHTML='';document.getElementById('sprlPanel').style.display='none';LAST=null;
  showProg(true);setBar(0,'iniciando…');log('▶ generando '+p+' …');
  fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({placa:p,sources:chosen()})})
   .then(function(r){return r.json()}).then(function(o){
     if(!o.jobId){throw new Error(o.error||'sin jobId');}
     JOB=o.jobId; ES=new EventSource('/api/progress/'+JOB);
     ES.onmessage=function(ev){var s=JSON.parse(ev.data);
       setBar(s.percent, esc(s.current||'')+(s.step?' · '+esc(s.step):''));
       renderCards(s.results);
       if(s.done){ES.close();ES=null;finish(s);}
     };
     ES.onerror=function(){/* el SSE cierra al terminar; si no terminó, reintenta el navegador */};
   }).catch(function(e){log('✖ '+e);endRun();});}
function finish(s){endRun();
  if(s.error){log('✖ '+s.error);return;}
  if(s.cancelled){log('⏹ cancelado por el operador');renderCards(s.results);return;}
  LAST={results:s.results};renderCards(s.results);
  document.getElementById('sprlPanel').style.display='block';
  var ok=s.results.filter(function(x){return x.status==='ENCONTRADO'||x.status==='SIN_REGISTRO'}).length;
  log('✔ '+ok+'/'+s.results.length+' fuentes respondieron');}
function endRun(){var go=document.getElementById('go');go.disabled=false;go.textContent='Generar reporte';showProg(false);if(ES){ES.close();ES=null;}}
function cancelRun(){if(!JOB)return;log('⏹ cancelando…');fetch('/api/cancel/'+JOB,{method:'POST'});}
function retry(code){var id=srcId(code);log('↻ reintentando '+code+' …');
  fetch('/api/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({placa:plate(),source:id})})
   .then(function(r){return r.json()}).then(function(res){var el=document.getElementById('c-'+res.source);
     if(el){el.outerHTML=card(res);var im=document.querySelector('#c-'+res.source+' img');if(im){im.src='/shot/'+plate()+'/'+srcId(res.source)+'.png?t='+Date.now();}}
     log('↻ '+res.source+' → '+res.status);}).catch(function(e){log('✖ '+e)});}
function send(){if(!LAST){alert('Genera el reporte primero');return;}
  var body={placa:plate(),whatsapp:document.getElementById('wa').value,email:document.getElementById('mail').value,sprl:document.getElementById('sprl').value,precioCompra:document.getElementById('precio').value,results:LAST.results};
  log('✉ marcando listo / enviando …');
  fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
   .then(function(r){return r.json()}).then(function(x){log(x.sent?'✉ enviado por n8n':'✓ marcado listo (n8n sin configurar)');}).catch(function(e){log('✖ '+e)});}
document.getElementById('placa').addEventListener('keydown',function(e){if(e.key==='Enter')run();});
</script></body></html>`;
