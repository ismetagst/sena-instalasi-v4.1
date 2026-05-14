/**
 * SENA INSTALASI v4.1 — Server (rewrite bersih)
 * Auth pakai token di URL — tidak ada cookie, works di semua host.
 *
 * /admin/login          → form login
 * /dashboard?t=TOKEN    → dashboard (token wajib)
 * /api/...?t=TOKEN      → semua API (token wajib)
 * /                     → index.html
 * /tamu                 → tamu.html
 *
 * ENV: PORT, ADMIN_USER (default: admin), ADMIN_PASS (default: admin)
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT       = process.env.PORT       || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';
const ORIGIN     = process.env.ALLOWED_ORIGIN || '*';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js'  : 'application/javascript',
  '.json': 'application/json',
  '.css' : 'text/css',
  '.png' : 'image/png',
};

/* ── AUTH TOKENS (in-memory) ── */
const tokens = {}; // token → { user, expires }

function newToken(user) {
  const t = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  tokens[t] = { user, expires: Date.now() + 8 * 3600 * 1000 };
  return t;
}
function checkToken(t) {
  if (!t || !tokens[t]) return null;
  if (Date.now() > tokens[t].expires) { delete tokens[t]; return null; }
  return tokens[t];
}

/* ── DATABASE ── */
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE  = path.join(DATA_DIR, 'db.json');

function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE))  fs.writeFileSync(DB_FILE, JSON.stringify({ activeEventId: null, events: [] }, null, 2));
}
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch { return { activeEventId: null, events: [] }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

function addMessage(title, body, sid) {
  const db = loadDB();
  const ev = db.events.find(e => e.id === db.activeEventId);
  if (!ev) return;
  ev.messages.push({ id: uid('msg'), name: title, body, sid, ts: Date.now() });
  saveDB(db);
}

/* ── PARSE BODY ── */
function body(req) {
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => s += c);
    req.on('end', () => {
      try { resolve(Object.fromEntries(new URLSearchParams(s))); } catch { resolve({}); }
    });
  });
}

function html(res, str) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(str);
}
function redirect(res, to) {
  res.writeHead(302, { Location: to });
  res.end();
}
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

/* ── HTTP SERVER ── */
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);

  const parsed  = new URL(req.url, 'http://localhost');
  const urlPath = parsed.pathname;
  const token   = parsed.searchParams.get('t') || '';
  const session = checkToken(token);
  const method  = req.method;

  /* LOGIN */
  if (urlPath === '/admin/login') {
    if (method === 'POST') {
      const b = await body(req);
      if (b.user === ADMIN_USER && b.pass === ADMIN_PASS) {
        const t = newToken(b.user);
        return redirect(res, '/dashboard?t=' + t);
      }
      return html(res, loginPage('Username atau password salah.'));
    }
    return html(res, loginPage(''));
  }

  /* DASHBOARD */
  if (urlPath === '/dashboard') {
    if (!session) return redirect(res, '/admin/login');
    return html(res, dashPage(loadDB(), token));
  }

  /* API — semua butuh token */
  if (urlPath.startsWith('/api/')) {
    if (!session) { res.writeHead(401); return res.end('Unauthorized'); }

    const db = loadDB();

    if (urlPath === '/api/event/new' && method === 'POST') {
      const b = await body(req);
      if (!b.name) { return redirect(res, '/dashboard?t=' + token + '&err=Isi+nama+acara'); }
      const ev = { id: uid('evt'), name: b.name, date: b.date || '', createdAt: Date.now(), messages: [] };
      db.events.unshift(ev);
      db.activeEventId = ev.id;
      saveDB(db);
      return redirect(res, '/dashboard?t=' + token);
    }

    if (urlPath === '/api/event/activate' && method === 'POST') {
      const b = await body(req);
      if (db.events.find(e => e.id === b.id)) { db.activeEventId = b.id; saveDB(db); }
      return redirect(res, '/dashboard?t=' + token);
    }

    if (urlPath === '/api/event/delete' && method === 'POST') {
      const b = await body(req);
      db.events = db.events.filter(e => e.id !== b.id);
      if (db.activeEventId === b.id) db.activeEventId = db.events[0]?.id || null;
      saveDB(db);
      return redirect(res, '/dashboard?t=' + token);
    }

    if (urlPath === '/api/msg/delete' && method === 'POST') {
      const b   = await body(req);
      const ev  = db.events.find(e => e.id === b.eid);
      if (ev) { ev.messages = ev.messages.filter(m => m.id !== b.mid); saveDB(db); }
      return redirect(res, '/dashboard?t=' + token);
    }

    if (urlPath === '/api/msg/delete-bulk' && method === 'POST') {
      const b    = await body(req);
      const ids  = (b.ids || '').split(',').filter(Boolean);
      const ev   = db.events.find(e => e.id === b.eid);
      if (ev) { ev.messages = ev.messages.filter(m => !ids.includes(m.id)); saveDB(db); }
      return redirect(res, '/dashboard?t=' + token);
    }

    if (urlPath === '/api/db') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(loadDB(), null, 2));
    }

    res.writeHead(404); return res.end('not found');
  }

  /* STATIC FILES */
  let fp = urlPath;
  if (fp === '/' || fp === '/layar') fp = '/index.html';
  if (fp === '/tamu')               fp = '/tamu.html';

  fs.readFile(path.join(__dirname, fp), (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
    res.end(data);
  });
});

/* ── LOGIN PAGE ── */
function loginPage(err) {
  return `<!DOCTYPE html><html lang="id"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>sena admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Georgia,serif;background:#0a0a0a;min-height:100vh;display:flex;align-items:center;justify-content:center;}
.box{width:300px;}
.mark{font-size:15px;opacity:.22;text-align:center;margin-bottom:24px;color:#fff;}
h1{font-size:14px;font-weight:400;color:rgba(255,255,255,.55);letter-spacing:.12em;text-align:center;margin-bottom:28px;}
label{display:block;font-size:10px;letter-spacing:.18em;color:rgba(255,255,255,.3);text-transform:uppercase;margin-bottom:7px;}
input{width:100%;background:rgba(255,255,255,.06);border:.5px solid rgba(255,255,255,.15);color:rgba(255,255,255,.85);font-family:Georgia,serif;font-size:15px;padding:11px 13px;border-radius:6px;outline:none;margin-bottom:18px;}
input:focus{border-color:rgba(255,255,255,.4);}
button{width:100%;padding:12px;background:rgba(255,255,255,.9);color:#0a0a0a;border:none;border-radius:6px;font-size:13px;letter-spacing:.1em;cursor:pointer;font-family:Georgia,serif;}
button:hover{background:#fff;}
.err{font-size:12px;color:rgba(255,120,100,.8);text-align:center;margin-top:14px;}
</style></head><body>
<div class="box">
  <div class="mark">(◕ᴗ◕✿)</div>
  <h1>sena admin</h1>
  <form method="POST" action="/admin/login">
    <label>username</label>
    <input name="user" type="text" autocomplete="username" placeholder="admin" required autofocus/>
    <label>password</label>
    <input name="pass" type="password" autocomplete="current-password" placeholder="••••••" required/>
    <button type="submit">masuk</button>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}
  </form>
</div></body></html>`;
}

/* ── DASHBOARD PAGE ── */
function dashPage(db, token) {
  const T        = esc(token);
  const events   = db.events || [];
  const activeId = db.activeEventId || '';
  const active   = events.find(e => e.id === activeId);
  const msgs     = active ? active.messages : [];

  const sidebarItems = events.length === 0
    ? `<div class="no-events">belum ada event.<br>Buat di atas.</div>`
    : events.map(e => `
      <div class="ev-item ${e.id === activeId ? 'active' : ''}">
        <form method="POST" action="/api/event/activate?t=${T}" style="flex:1;min-width:0;">
          <input type="hidden" name="id" value="${esc(e.id)}"/>
          <button type="submit" class="ev-name-btn">
            <div class="ev-name">${esc(e.name)}</div>
            <div class="ev-meta">${esc(e.date) || '—'} · ${e.messages.length} pesan</div>
          </button>
        </form>
        <form method="POST" action="/api/event/delete?t=${T}" onsubmit="return confirm('Hapus event ini?')">
          <input type="hidden" name="id" value="${esc(e.id)}"/>
          <button type="submit" class="ev-del">hapus</button>
        </form>
      </div>`).join('');

  const msgRows = msgs.length === 0
    ? `<tr><td colspan="5" class="empty">${active ? 'belum ada pesan.' : 'pilih atau buat event dulu.'}</td></tr>`
    : msgs.map((m, i) => `
      <tr id="row-${esc(m.id)}">
        <td><input type="checkbox" class="chk" value="${esc(m.id)}"/></td>
        <td class="num">${i + 1}</td>
        <td class="name">${esc(m.name)}</td>
        <td class="bc">${esc(m.body)}</td>
        <td class="ts">${fmtTs(m.ts)}</td>
        <td>
          <form method="POST" action="/api/msg/delete?t=${T}" onsubmit="return confirm('Hapus pesan ini?')" style="display:inline">
            <input type="hidden" name="eid" value="${esc(activeId)}"/>
            <input type="hidden" name="mid" value="${esc(m.id)}"/>
            <button type="submit" class="del-btn">hapus</button>
          </form>
        </td>
      </tr>`).join('');

  return `<!DOCTYPE html><html lang="id"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>sena dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Georgia,serif;background:#0a0a0a;color:rgba(255,255,255,.7);min-height:100vh;display:flex;flex-direction:column;}
a{color:inherit;text-decoration:none;}
/* topbar */
.topbar{display:flex;align-items:center;gap:12px;padding:14px 22px;border-bottom:.5px solid rgba(255,255,255,.07);flex-shrink:0;}
.topbar h1{font-size:15px;font-weight:400;color:rgba(255,255,255,.8);letter-spacing:.08em;flex:1;}
.tbtn{font-size:10px;color:rgba(255,255,255,.28);border:.5px solid rgba(255,255,255,.1);padding:4px 12px;border-radius:12px;cursor:pointer;background:none;font-family:Georgia,serif;letter-spacing:.08em;}
.tbtn:hover{color:rgba(255,255,255,.6);border-color:rgba(255,255,255,.25);}
.tbtn.red{color:rgba(255,80,80,.4);border-color:rgba(255,80,80,.15);}
.tbtn.red:hover{color:rgba(255,80,80,.75);}
/* layout */
.layout{display:flex;flex:1;min-height:0;overflow:hidden;}
/* sidebar */
.sidebar{width:250px;flex-shrink:0;border-right:.5px solid rgba(255,255,255,.07);padding:18px 14px;overflow-y:auto;display:flex;flex-direction:column;gap:0;}
.sidebar h2{font-size:9px;letter-spacing:.18em;color:rgba(255,255,255,.22);text-transform:uppercase;margin-bottom:10px;}
.new-form{display:flex;flex-direction:column;gap:7px;margin-bottom:18px;}
.new-form input{background:rgba(255,255,255,.05);border:.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.8);font-family:Georgia,serif;font-size:13px;padding:8px 10px;border-radius:5px;outline:none;width:100%;}
.new-form input:focus{border-color:rgba(255,255,255,.3);}
.new-form input::placeholder{color:rgba(255,255,255,.2);}
.btn-create{background:rgba(255,255,255,.88);color:#0a0a0a;border:none;border-radius:5px;padding:9px;font-size:12px;letter-spacing:.08em;cursor:pointer;font-family:Georgia,serif;width:100%;}
.btn-create:hover{background:#fff;}
.divider{height:.5px;background:rgba(255,255,255,.07);margin-bottom:14px;}
.no-events{font-size:12px;color:rgba(255,255,255,.18);font-style:italic;line-height:1.6;padding:4px;}
.ev-item{display:flex;align-items:stretch;border-radius:6px;margin-bottom:5px;border:.5px solid rgba(255,255,255,.05);overflow:hidden;}
.ev-item.active{border-color:rgba(255,255,255,.18);background:rgba(255,255,255,.05);}
.ev-name-btn{background:none;border:none;cursor:pointer;text-align:left;padding:9px 8px;flex:1;min-width:0;font-family:Georgia,serif;}
.ev-name-btn:hover{background:rgba(255,255,255,.03);}
.ev-name{font-size:13px;color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ev-meta{font-size:10px;color:rgba(255,255,255,.22);margin-top:2px;}
.ev-del{background:none;border:none;border-left:.5px solid rgba(255,255,255,.07);color:rgba(255,80,80,.28);font-size:10px;cursor:pointer;padding:0 10px;font-family:Georgia,serif;flex-shrink:0;}
.ev-del:hover{color:rgba(255,80,80,.7);background:rgba(255,80,80,.08);}
/* main */
.main{flex:1;padding:18px 22px;overflow-y:auto;}
.main-hdr{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;}
.main-hdr h2{font-size:14px;font-weight:400;color:rgba(255,255,255,.75);flex:1;}
.badge-active{font-size:9px;background:rgba(74,222,128,.1);border:.5px solid rgba(74,222,128,.25);color:rgba(74,222,128,.7);padding:3px 10px;border-radius:12px;letter-spacing:.1em;}
.msg-count{font-size:11px;color:rgba(255,255,255,.2);}
/* bulk bar */
.bulk-bar{display:none;align-items:center;gap:10px;padding:8px 12px;background:rgba(255,255,255,.04);border:.5px solid rgba(255,255,255,.08);border-radius:6px;margin-bottom:12px;}
.bulk-bar.show{display:flex;}
.bulk-count{font-size:12px;color:rgba(255,255,255,.45);flex:1;}
.btn-bulk-del{background:rgba(255,80,80,.12);border:.5px solid rgba(255,80,80,.28);color:rgba(255,80,80,.75);font-size:11px;padding:5px 14px;border-radius:5px;cursor:pointer;font-family:Georgia,serif;}
.btn-bulk-del:hover{background:rgba(255,80,80,.22);}
.btn-cancel{background:none;border:none;color:rgba(255,255,255,.25);font-size:11px;cursor:pointer;font-family:Georgia,serif;}
/* table */
table{width:100%;border-collapse:collapse;font-size:13px;}
th{text-align:left;font-size:9px;letter-spacing:.15em;color:rgba(255,255,255,.22);text-transform:uppercase;padding:7px 10px;border-bottom:.5px solid rgba(255,255,255,.07);}
th:first-child,td:first-child{width:30px;padding-left:10px;}
td{padding:11px 10px;border-bottom:.5px solid rgba(255,255,255,.04);vertical-align:top;}
td.num{color:rgba(255,255,255,.2);width:30px;}
td.name strong{color:rgba(255,255,255,.75);}
td.bc{color:rgba(255,255,255,.42);font-style:italic;max-width:320px;line-height:1.6;}
td.ts{font-size:11px;color:rgba(255,255,255,.2);white-space:nowrap;}
td.empty{color:rgba(255,255,255,.18);font-style:italic;text-align:center;padding:32px;}
tr:hover td{background:rgba(255,255,255,.015);}
tr.selected td{background:rgba(255,200,80,.04);}
.del-btn{background:none;border:none;color:rgba(255,80,80,.28);font-size:11px;cursor:pointer;font-family:Georgia,serif;padding:2px 8px;border-radius:4px;}
.del-btn:hover{color:rgba(255,80,80,.7);background:rgba(255,80,80,.08);}
input[type=checkbox]{accent-color:#4ade80;width:14px;height:14px;cursor:pointer;}
</style></head>
<body>

<div class="topbar">
  <h1>(◕ᴗ◕✿) dashboard</h1>
  <a href="/dashboard?t=${T}" class="tbtn">↻ refresh</a>
  <a href="/api/db?t=${T}" target="_blank" class="tbtn">JSON</a>
  <a href="/admin/login" class="tbtn red">keluar</a>
</div>

<div class="layout">
  <div class="sidebar">
    <h2>buat event baru</h2>
    <form method="POST" action="/api/event/new?t=${T}" class="new-form">
      <input name="name" type="text" placeholder="nama acara..." maxlength="60" required/>
      <input name="date" type="date" value="${new Date().toISOString().slice(0,10)}"/>
      <button type="submit" class="btn-create">+ buat event</button>
    </form>
    <div class="divider"></div>
    <h2>semua event</h2>
    ${sidebarItems}
  </div>

  <div class="main">
    <div class="main-hdr">
      <h2>${active ? esc(active.name) : 'pilih event'}</h2>
      ${active ? '<span class="badge-active">aktif</span>' : ''}
      <span class="msg-count">${msgs.length} pesan</span>
    </div>

    <div class="bulk-bar" id="bulk-bar">
      <span class="bulk-count" id="bulk-count">0 dipilih</span>
      <form method="POST" action="/api/msg/delete-bulk?t=${T}" id="bulk-form">
        <input type="hidden" name="eid" value="${esc(activeId)}"/>
        <input type="hidden" name="ids" id="bulk-ids"/>
        <button type="submit" class="btn-bulk-del" onclick="return confirmBulk()">hapus yang dipilih</button>
      </form>
      <button class="btn-cancel" onclick="clearSel()">batal</button>
    </div>

    <table>
      <thead>
        <tr>
          <th><input type="checkbox" id="chk-all" onchange="toggleAll(this)"/></th>
          <th>#</th><th>nama</th><th>tulisan</th><th>waktu</th><th></th>
        </tr>
      </thead>
      <tbody>${msgRows}</tbody>
    </table>
  </div>
</div>

<script>
function toggleAll(cb) {
  document.querySelectorAll('.chk').forEach(c => {
    c.checked = cb.checked;
    c.closest('tr').classList.toggle('selected', cb.checked);
  });
  updateBulk();
}
function updateBulk() {
  const sel = [...document.querySelectorAll('.chk:checked')];
  document.getElementById('bulk-count').textContent = sel.length + ' dipilih';
  document.getElementById('bulk-bar').classList.toggle('show', sel.length > 0);
  document.querySelectorAll('.chk').forEach(c => c.closest('tr').classList.toggle('selected', c.checked));
}
function clearSel() {
  document.querySelectorAll('.chk').forEach(c => { c.checked=false; c.closest('tr').classList.remove('selected'); });
  const ca = document.getElementById('chk-all'); if (ca) ca.checked = false;
  updateBulk();
}
function confirmBulk() {
  const sel = [...document.querySelectorAll('.chk:checked')].map(c => c.value);
  if (!sel.length) return false;
  if (!confirm('Hapus ' + sel.length + ' pesan?')) return false;
  document.getElementById('bulk-ids').value = sel.join(',');
  return true;
}
document.querySelectorAll('.chk').forEach(c => c.addEventListener('change', updateBulk));
</script>
</body></html>`;
}

/* ── WEBSOCKET ── */
const wsSess = {};
function getWsSess(sid) { if (!wsSess[sid]) wsSess[sid]={desktop:null,guests:[]}; return wsSess[sid]; }

const wss = new WebSocketServer({ server });
wss.on('connection', (ws, req) => {
  const u    = new URL(req.url, 'http://localhost');
  const role = u.searchParams.get('role');
  const sid  = u.searchParams.get('sid');
  if (!role||!sid) { ws.close(); return; }
  const s = getWsSess(sid);
  ws.role=role; ws.sid=sid;

  if (role==='desktop') {
    if (s.desktop) s.desktop.close();
    s.desktop=ws;
    console.log(`[+] desktop #${sid}`);
    ws.send(JSON.stringify({type:'connected',role:'desktop',sid}));
    // Flush any buffered messages (sent while desktop was offline)
    if (s.pending?.length) {
      console.log(`[📨] flushing ${s.pending.length} buffered msgs to desktop #${sid}`);
      s.pending.forEach(m => ws.send(JSON.stringify(m)));
      s.pending = [];
    }
  } else {
    s.guests.push(ws);
    console.log(`[+] guest   #${sid}`);
    ws.send(JSON.stringify({type:'connected',role:'guest',sid}));
    if (s.desktop?.readyState===1) s.desktop.send(JSON.stringify({type:'guest_joined',sid}));
  }

  ws.on('message', raw => {
    let msg; try{msg=JSON.parse(raw);}catch{return;}
    const S=wsSess[msg.sid||sid]; if(!S) return;

    if (msg.type==='ping') {
      // keepalive — send pong back
      if (ws.readyState===1) ws.send(JSON.stringify({type:'pong'}));
    }

    if (msg.type==='write') {
      console.log(`[✓] pesan #${sid}: "${msg.title}"`);
      addMessage(msg.title, msg.body, sid);

      if (S.desktop?.readyState===1) {
        // Desktop online — deliver immediately
        S.desktop.send(JSON.stringify({type:'write',title:msg.title,body:msg.body}));
      } else {
        // Desktop offline/reconnecting — buffer message, deliver on reconnect
        if (!S.pending) S.pending = [];
        S.pending.push({type:'write', title:msg.title, body:msg.body});
        console.log(`[⏳] buffered for #${sid} (desktop offline)`);
      }
    }

    if (msg.type==='reset') {
      S.guests.forEach(g=>{if(g.readyState===1)g.send(JSON.stringify({type:'reset'}));});
      delete wsSess[sid];
      console.log(`[~] reset  #${sid}`);
    }
  });

  ws.on('close', ()=>{
    const S=wsSess[sid]; if(!S) return;
    if (role==='desktop') { S.desktop=null; }
    else { S.guests=S.guests.filter(g=>g!==ws); }
  });
  ws.on('error', e=>console.error('[!]',e.message));
});

/* ── START ── */
ensureDB();
server.listen(PORT, ()=>{
  const db=loadDB();
  const ae=db.events.find(e=>e.id===db.activeEventId);
  console.log('\n  (◕ᴗ◕✿) sena instalasi v4.1');
  console.log('  ─────────────────────────────────');
  console.log(`  Layar     →  http://localhost:${PORT}/`);
  console.log(`  HP tamu   →  http://localhost:${PORT}/tamu`);
  console.log(`  Dashboard →  http://localhost:${PORT}/admin/login`);
  console.log(`  Login     :  ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log(`  Event aktif: ${ae?ae.name:'(belum ada)'}`);
  console.log('  ─────────────────────────────────\n');
});
