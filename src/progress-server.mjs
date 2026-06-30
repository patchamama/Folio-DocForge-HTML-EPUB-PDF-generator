#!/usr/bin/env node
// SSE progress server — started by build-from-html-folder.sh
import http from 'node:http';

const PORT = parseInt(process.env.PROGRESS_PORT ?? '7788', 10);
const clients = new Set();
const history  = [];

function broadcast(ev) {
  history.push(ev);
  const msg = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const r of clients) r.write(msg);
}

// ── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d0f17;--surface:#13161f;--surface2:#1a1d29;
  --border:#252836;--border2:#2f3347;
  --text:#e2e8f0;--muted:#5a6482;--muted2:#8892a4;
  --accent:#6366f1;--accent2:#818cf8;
  --green:#10b981;--green2:#34d399;
  --red:#ef4444;--blue2:#60a5fa;--yellow:#f59e0b;
  --r:0.75rem;
}
html{font-size:14px}
body{font-family:'Inter','Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:1.5rem 2rem 3rem;line-height:1.5}
.wrap{max-width:880px;margin:0 auto}
.header{display:flex;align-items:center;gap:.75rem;margin-bottom:1.75rem}
.header h1{font-size:1.25rem;font-weight:700;letter-spacing:-.01em}
.badge{padding:.2rem .65rem;border-radius:9999px;font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;background:var(--surface2);border:1px solid var(--border2);color:var(--muted2)}
.badge.running{border-color:rgba(99,102,241,.4);color:var(--accent2);background:rgba(99,102,241,.08)}
.badge.done{border-color:rgba(16,185,129,.4);color:var(--green2);background:rgba(16,185,129,.08)}
.pbar-wrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:1.25rem 1.5rem;margin-bottom:1.25rem}
.pbar-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.625rem}
.pbar-title{font-size:.72rem;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em}
.pbar-counts{font-size:.8rem;font-weight:600;font-variant-numeric:tabular-nums}
.pbar-track{height:6px;background:var(--border2);border-radius:9999px;overflow:hidden}
.pbar-fill{height:100%;border-radius:9999px;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .4s cubic-bezier(.4,0,.2,1);width:0%}
.pbar-fill.done{background:linear-gradient(90deg,var(--green),var(--green2))}
.banner{border-radius:var(--r);padding:1.25rem 1.5rem;margin-bottom:1.25rem;display:none;background:linear-gradient(135deg,rgba(16,185,129,.08),rgba(16,185,129,.03));border:1px solid rgba(16,185,129,.25)}
.banner.show{display:flex;align-items:center;gap:1rem}
.banner-icon{font-size:2rem;line-height:1}
.banner-text h2{font-size:1rem;font-weight:700;color:var(--green2);margin-bottom:.2rem}
.banner-text p{font-size:.78rem;color:var(--muted2)}
.phases{display:flex;flex-direction:column;gap:.875rem}
.phase{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.phase-hdr{padding:.65rem 1.25rem;display:flex;align-items:center;gap:.5rem;font-size:.72rem;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em;background:var(--surface2);border-bottom:1px solid var(--border)}
.task{display:flex;align-items:center;gap:.75rem;padding:.5rem 1.25rem;border-bottom:1px solid var(--border);transition:background .15s}
.task:last-child{border-bottom:none}
.task.running{background:rgba(59,130,246,.04)}
.task.failed{background:rgba(239,68,68,.04)}
.task-icon{width:1rem;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.75rem}
.task-label{flex:1;font-size:.78rem}
.task.pending .task-label{color:var(--muted)}
.task.done .task-label{color:var(--muted2)}
.task.failed .task-label{color:var(--red)}
.task-time{font-size:.68rem;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
@keyframes spin{to{transform:rotate(360deg)}}
.spin{width:11px;height:11px;border:1.5px solid var(--border2);border-top-color:var(--blue2);border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
.log-wrap{margin-top:1.25rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.log-hdr{padding:.5rem 1.25rem;font-size:.68rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;background:var(--surface2);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.log-hdr button{font-size:.65rem;color:var(--muted);background:none;border:1px solid var(--border2);border-radius:.3rem;padding:.1rem .4rem;cursor:pointer}
.log-hdr button:hover{color:var(--text);border-color:var(--muted)}
.log-body{font-family:'JetBrains Mono','Fira Code',monospace;font-size:.68rem;color:var(--muted);max-height:220px;overflow-y:auto;padding:.75rem 1.25rem;line-height:1.7}
.log-body::-webkit-scrollbar{width:4px}
.log-body::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
.ts{color:var(--border2);user-select:none}
.ok{color:var(--green)}.err{color:var(--red)}.run{color:var(--blue2)}.warn{color:var(--yellow)}
`;

// ── Frontend script (no template literals to avoid nesting issues) ───────────
const SCRIPT = `
var $=function(id){return document.getElementById(id);};
var badge=$('badge'),pbar=$('pbar'),counts=$('counts'),phases=$('phases'),log=$('log'),banner=$('banner'),bannerP=$('banner-p');
var state={phases:[],tasks:{},startTs:Date.now()};
var timers={};

function fmt(ms){
  if(ms<1000)return ms+'ms';
  if(ms<60000)return (ms/1000).toFixed(1)+'s';
  return Math.floor(ms/60000)+'m'+String(Math.floor((ms%60000)/1000)).padStart(2,'0')+'s';
}

function progress(){
  var all=Object.values(state.tasks);
  var done=all.filter(function(t){return t.status==='done'||t.status==='failed'||t.status==='skip';}).length;
  var pct=all.length?Math.round(done/all.length*100):0;
  pbar.style.width=pct+'%';
  counts.textContent=done+' / '+all.length+' tasks';
  if(pct===100)pbar.classList.add('done');
}

function icon(s){
  if(s==='done')   return '<span style="color:var(--green)">&#x2713;</span>';
  if(s==='failed') return '<span style="color:var(--red)">&#x2717;</span>';
  if(s==='skip')   return '<span style="color:var(--muted)">&#x2014;</span>';
  if(s==='running')return '<span class="spin"></span>';
  return '<span style="color:var(--border2)">&#x25CB;</span>';
}

function esc(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderAll(){
  phases.innerHTML='';
  for(var i=0;i<state.phases.length;i++){
    var ph=state.phases[i];
    var tasks=ph.tasks.map(function(id){return state.tasks[id];}).filter(Boolean);
    var d=document.createElement('div');
    d.className='phase';
    var html='<div class="phase-hdr"><span style="margin-right:.35rem">'+esc(ph.icon)+'</span>'+esc(ph.label)+'</div>';
    for(var j=0;j<tasks.length;j++){
      var t=tasks[j];
      var cid=t.id.replace(/[^a-zA-Z0-9_-]/g,'_');
      html+='<div class="task '+t.status+'" id="t-'+cid+'">'
        +'<span class="task-icon">'+icon(t.status)+'</span>'
        +'<span class="task-label">'+esc(t.label)+'</span>'
        +'<span class="task-time" id="tt-'+cid+'">'+(t.elapsed||'')+'</span>'
        +'</div>';
    }
    d.innerHTML=html;
    phases.appendChild(d);
  }
}

function cid(id){return id.replace(/[^a-zA-Z0-9_-]/g,'_');}

function patch(id){
  var t=state.tasks[id];if(!t)return;
  var row=$('t-'+cid(id));
  if(!row){renderAll();return;}
  row.className='task '+t.status;
  row.querySelector('.task-icon').innerHTML=icon(t.status);
  row.querySelector('.task-label').textContent=t.label;
  var tt=$('tt-'+cid(id));
  if(tt)tt.textContent=t.elapsed||'';
}

function startTimer(id){
  stopTimer(id);
  timers[id]=setInterval(function(){
    var t=state.tasks[id];
    if(!t||t.status!=='running'){stopTimer(id);return;}
    var el=$('tt-'+cid(id));
    if(el)el.textContent=fmt(Date.now()-t.startMs);
  },200);
}
function stopTimer(id){if(timers[id]){clearInterval(timers[id]);delete timers[id];}}

function addLog(msg,cls){
  var ts=new Date().toLocaleTimeString('en',{hour12:false});
  var d=document.createElement('div');
  d.innerHTML='<span class="ts">['+ts+']</span> <span class="'+(cls||'')+'">'+esc(msg)+'</span>';
  log.appendChild(d);
  log.scrollTop=log.scrollHeight;
}

document.querySelector('.log-hdr button').addEventListener('click',function(){log.innerHTML='';});

function handle(ev){
  if(ev.type==='task_plan'){
    var ph=null;
    for(var i=0;i<state.phases.length;i++){if(state.phases[i].id===ev.phase_id){ph=state.phases[i];break;}}
    if(!ph){ph={id:ev.phase_id,icon:ev.phase_icon||'\\uD83D\\uDCC1',label:ev.phase_label||ev.phase_id,tasks:[]};state.phases.push(ph);}
    if(ph.tasks.indexOf(ev.id)===-1)ph.tasks.push(ev.id);
    if(!state.tasks[ev.id])state.tasks[ev.id]={id:ev.id,label:ev.label||ev.id,status:'pending',elapsed:'',phaseId:ev.phase_id};
    renderAll();progress();return;
  }
  if(ev.type==='task_start'){
    var t=state.tasks[ev.id];
    if(t){t.status='running';t.startMs=Date.now();t.elapsed='';}
    patch(ev.id);startTimer(ev.id);
    badge.textContent='Building\\u2026';badge.className='badge running';
    addLog('\\u25B6 '+(ev.label||ev.id),'run');return;
  }
  if(ev.type==='task_done'){
    var t=state.tasks[ev.id];
    if(t){t.status='done';t.elapsed=fmt(Date.now()-(t.startMs||Date.now()));}
    stopTimer(ev.id);patch(ev.id);progress();
    addLog('\\u2713 '+(ev.label||ev.id)+(t?' \\u00B7 '+t.elapsed:''),'ok');return;
  }
  if(ev.type==='task_fail'){
    var t=state.tasks[ev.id];
    if(t){t.status='failed';t.elapsed=fmt(Date.now()-(t.startMs||Date.now()));}
    stopTimer(ev.id);patch(ev.id);progress();
    addLog('\\u2717 '+(ev.label||ev.id)+(ev.detail?' \\u2014 '+ev.detail:''),'err');return;
  }
  if(ev.type==='task_skip'){
    var t=state.tasks[ev.id];if(t){t.status='skip';t.elapsed='';}
    stopTimer(ev.id);patch(ev.id);progress();
    addLog('\\u2014 '+(ev.label||ev.id)+' (skipped)');return;
  }
  if(ev.type==='log'){
    var cls=ev.level==='ok'?'ok':ev.level==='error'?'err':ev.level==='warn'?'warn':'';
    addLog(ev.message||'',cls);return;
  }
  if(ev.type==='complete'){
    badge.textContent='Complete \\u2713';badge.className='badge done';
    banner.classList.add('show');
    var elapsed=fmt(Date.now()-state.startTs);
    bannerP.textContent='Completed in '+elapsed+(ev.ready_dir?' \\u2014 results in: '+ev.ready_dir:'');
    pbar.style.width='100%';pbar.classList.add('done');
    addLog('\\uD83C\\uDF89 Build complete in '+elapsed,'ok');return;
  }
}

(function connect(){
  var es=new EventSource('/events');
  es.onopen=function(){badge.textContent='Building\\u2026';badge.className='badge running';};
  es.onmessage=function(e){try{handle(JSON.parse(e.data));}catch(err){}};
  es.onerror=function(){
    badge.textContent='Reconnecting\\u2026';badge.className='badge';
    es.close();setTimeout(connect,2000);
  };
})();
`;

// ── HTML ─────────────────────────────────────────────────────────────────────
const HTML = '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
  + '<meta charset="UTF-8">\n'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
  + '<title>Build Progress</title>\n'
  + '<style>' + CSS + '</style>\n'
  + '</head>\n<body>\n'
  + '<div class="wrap">\n'
  + '  <div class="header"><h1>📚 Build Progress</h1>'
  + '<span class="badge" id="badge">Connecting…</span></div>\n'
  + '  <div class="banner" id="banner">'
  + '<div class="banner-icon">🎉</div>'
  + '<div class="banner-text"><h2>Build complete</h2><p id="banner-p"></p></div></div>\n'
  + '  <div class="pbar-wrap">'
  + '<div class="pbar-top"><span class="pbar-title">Overall progress</span>'
  + '<span class="pbar-counts" id="counts">— / — tasks</span></div>'
  + '<div class="pbar-track"><div class="pbar-fill" id="pbar"></div></div></div>\n'
  + '  <div class="phases" id="phases"></div>\n'
  + '  <div class="log-wrap">'
  + '<div class="log-hdr">Build log <button>clear</button></div>'
  + '<div class="log-body" id="log"></div></div>\n'
  + '</div>\n'
  + '<script>' + SCRIPT + '</script>\n'
  + '</body>\n</html>';

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(':ok\n\n');
    for (const ev of history) res.write('data: ' + JSON.stringify(ev) + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'POST' && req.url === '/event') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try   { broadcast(JSON.parse(body)); res.writeHead(200); res.end('ok'); }
      catch { res.writeHead(400);          res.end('bad json'); }
    });
    return;
  }
  if (req.url === '/shutdown') {
    res.writeHead(200); res.end('bye');
    clients.forEach(c => c.end());
    setTimeout(() => { server.close(); process.exit(0); }, 300);
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write('PROGRESS_SERVER_READY:' + PORT + '\n');
});
