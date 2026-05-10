/**
 * SENA INSTALASI v4.1 — Server
 * WebSocket + HTTP + Dashboard Admin (events + delete)
 *
 * DATA STRUCTURE (data/db.json):
 * {
 *   activeEventId: "evt_xxx" | null,
 *   events: [
 *     {
 *       id: "evt_xxx",
 *       name: "Nama Acara",
 *       date: "2026-05-10",
 *       createdAt: 1234567890,
 *       messages: [
 *         { id: "msg_xxx", name: "Tamu", body: "...", sid: "XXXXX", ts: 1234567890 }
 *       ]
 *     }
 *   ]
 * }
 *
 * Routes:
 *   GET  /               → layar instalasi
 *   GET  /tamu           → HP pengunjung
 *   GET  /dashboard      → panel admin (perlu login)
 *   GET  /admin/login    → halaman login
 *   POST /admin/login    → proses login
 *   GET  /admin/logout   → logout
 *   POST /api/event/new          → buat event baru
 *   POST /api/event/activate     → set event aktif
 *   POST /api/event/delete       → hapus event + semua pesannya
 *   POST /api/message/delete     → hapus 1 pesan
 *   POST /api/message/delete-bulk → hapus beberapa pesan
 *   GET  /api/db         → JSON seluruh database
 *
 * ENV: PORT, ALLOWED_ORIGIN, ADMIN_USER, ADMIN_PASS
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT       = process.env.PORT        || 3000;
const ORIGIN     = process.env.ALLOWED_ORIGIN || '*';
const ADMIN_USER = process.env.ADMIN_USER  || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS  || 'admin';

const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css',
  '.js':'application/javascript',     '.json':'application/json',
  '.png':'image/png', '.ico':'image/x-icon', '.svg':'image/svg+xml',
};

/* ══════════════════════════════════════════
   SESSION (in-memory, 8 jam)
══════════════════════════════════════════ */
const activeSessions = {};
function genToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function createSession(user) {
  const token = genToken();
  activeSessions[token] = { user, expires: Date.now() + 8*60*60*1000 };
  return token;
}
function getSession(token) {
  const s = activeSessions[token];
  if (!s) return null;
  if (Date.now() > s.expires) { delete activeSessions[token]; return null; }
  return s;
}
function deleteSession(token) { delete activeSessions[token]; }

function parseCookies(h) {
  const o = {};
  (h||'').split(';').forEach(c => { const [k,...v]=c.trim().split('='); if(k) o[k.trim()]=v.join('=').trim(); });
  return o;
}
function setCookie(t) { return `sena_admin=${t}; HttpOnly; SameSite=Lax; Max-Age=28800; Path=/`; }
function clearCookie() { return `sena_admin=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`; }

/* ══════════════════════════════════════════
   DATABASE (JSON file)
══════════════════════════════════════════ */
const DATA_DIR  = path.join(__dirname, 'data');
const DB_FILE   = path.join(DATA_DIR, 'db.json');

const EMPTY_DB = { activeEventId: null, events: [] };

function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE))  fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY_DB, null, 2));
}
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
  catch { return { ...EMPTY_DB }; }
}
function saveDB(db) {
  ensureDB();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`;
}

/* ══════════════════════════════════════════
   DB HELPERS
══════════════════════════════════════════ */
function getActiveEvent(db) {
  if (!db.activeEventId) return null;
  return db.events.find(e => e.id === db.activeEventId) || null;
}

function addMessage(title, body, sid) {
  const db  = loadDB();
  const evt = getActiveEvent(db);
  if (!evt) return; // no active event — silently skip (message still mirrors to screen)
  evt.messages.push({
    id:   genId('msg'),
    name: title,
    body,
    sid,
    ts: Date.now()
  });
  saveDB(db);
}

/* ══════════════════════════════════════════
   HTTP REQUEST BODY PARSER
══════════════════════════════════════════ */
function parseBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) {
        try { resolve(JSON.parse(raw)); } catch { resolve({}); }
      } else {
        const o = {};
        raw.split('&').forEach(p => {
          const [k,...v] = p.split('=');
          if (k) o[decodeURIComponent(k)] = decodeURIComponent(v.join('='));
        });
        resolve(o);
      }
    });
  });
}

function jsonRes(res, data, status=200) {
  res.writeHead(status, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':ORIGIN });
  res.end(JSON.stringify(data));
}

/* ══════════════════════════════════════════
   HTTP SERVER
══════════════════════════════════════════ */
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  const url     = req.url.split('?')[0];
  const cookies = parseCookies(req.headers['cookie']);
  const session = getSession(cookies['sena_admin']);
  const isAuth  = !!session;
  const method  = req.method;

  /* ── LOGIN ── */
  if (url === '/admin/login') {
    if (method === 'POST') {
      const body = await parseBody(req);
      if (body.username === ADMIN_USER && body.password === ADMIN_PASS) {
        const token = createSession(body.username);
        res.writeHead(302, { Location:'/dashboard', 'Set-Cookie':setCookie(token) });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });
      return res.end(loginHTML(true));
    }
    if (isAuth) { res.writeHead(302,{Location:'/dashboard'}); return res.end(); }
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });
    return res.end(loginHTML(false));
  }

  /* ── LOGOUT ── */
  if (url === '/admin/logout') {
    if (cookies['sena_admin']) deleteSession(cookies['sena_admin']);
    res.writeHead(302, { Location:'/admin/login', 'Set-Cookie':clearCookie() });
    return res.end();
  }

  /* ── PROTECTED ROUTES ── */
  if (url.startsWith('/dashboard') || url.startsWith('/api/')) {
    if (!isAuth) {
      if (url.startsWith('/api/')) return jsonRes(res, { error:'Unauthorized' }, 401);
      res.writeHead(302, { Location:'/admin/login' }); return res.end();
    }
  }

  /* ── DASHBOARD ── */
  if (url === '/dashboard') {
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });
    return res.end(dashboardHTML(loadDB(), session.user));
  }

  /* ── API: new event ── */
  if (url === '/api/event/new' && method === 'POST') {
    const body = await parseBody(req);
    if (!body.name) return jsonRes(res, { error:'name required' }, 400);
    const db  = loadDB();
    const evt = { id:genId('evt'), name:body.name, date:body.date||'', createdAt:Date.now(), messages:[] };
    db.events.unshift(evt); // newest first
    db.activeEventId = evt.id;
    saveDB(db);
    res.writeHead(302, { Location: '/dashboard' });
    return res.end();
  }

  /* ── API: activate event ── */
  if (url === '/api/event/activate' && method === 'POST') {
    const body = await parseBody(req);
    const db   = loadDB();
    if (!db.events.find(e => e.id === body.id)) return jsonRes(res, { error:'not found' }, 404);
    db.activeEventId = body.id;
    saveDB(db);
    res.writeHead(302, { Location: '/dashboard' });
    return res.end();
  }

  /* ── API: delete event ── */
  if (url === '/api/event/delete' && method === 'POST') {
    const body = await parseBody(req);
    const db   = loadDB();
    db.events = db.events.filter(e => e.id !== body.id);
    if (db.activeEventId === body.id) db.activeEventId = db.events[0]?.id || null;
    saveDB(db);
    res.writeHead(302, { Location: '/dashboard' });
    return res.end();
  }

  /* ── API: delete 1 message ── */
  if (url === '/api/message/delete' && method === 'POST') {
    const body = await parseBody(req);
    const db   = loadDB();
    const evt  = db.events.find(e => e.id === body.eventId);
    if (!evt) return jsonRes(res, { error:'event not found' }, 404);
    evt.messages = evt.messages.filter(m => m.id !== body.messageId);
    saveDB(db);
    res.writeHead(302, { Location: '/dashboard' });
    return res.end();
  }

  /* ── API: delete bulk messages ── */
  if (url === '/api/message/delete-bulk' && method === 'POST') {
    const body = await parseBody(req);
    // ids can be array (JSON) or comma-separated string (form POST)
    let ids = body.ids || [];
    if (typeof ids === 'string') ids = ids.split(',').map(s=>s.trim()).filter(Boolean);
    const db  = loadDB();
    const evt = db.events.find(e => e.id === body.eventId);
    if (!evt) return jsonRes(res, { error:'event not found' }, 404);
    evt.messages = evt.messages.filter(m => !ids.includes(m.id));
    saveDB(db);
    // redirect back to dashboard after form POST
    res.writeHead(302, { Location: '/dashboard' });
    return res.end();
  }

  /* ── API: get full DB ── */
  if (url === '/api/db') {
    return jsonRes(res, loadDB());
  }

  /* ── STATIC FILES ── */
  let fp = url;
  if (fp==='/'||fp==='/layar') fp='/index.html';
  if (fp==='/tamu')            fp='/tamu.html';

  fs.readFile(path.join(__dirname, fp), (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
    res.end(data);
  });
});

/* ══════════════════════════════════════════
   LOGIN HTML
══════════════════════════════════════════ */
function loginHTML(error) {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>sena — admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Georgia,serif;background:#0a0a0a;min-height:100vh;display:flex;align-items:center;justify-content:center;}
.box{width:300px;}
.mark{font-size:15px;opacity:.22;text-align:center;margin-bottom:24px;}
h1{font-size:14px;font-weight:400;color:rgba(255,255,255,.55);letter-spacing:.12em;text-align:center;margin-bottom:28px;}
label{display:block;font-size:10px;letter-spacing:.18em;color:rgba(255,255,255,.22);text-transform:uppercase;margin-bottom:6px;}
input{width:100%;background:rgba(255,255,255,.05);border:.5px solid rgba(255,255,255,.1);color:rgba(255,255,255,.8);font-family:Georgia,serif;font-size:15px;padding:11px 13px;border-radius:6px;outline:none;margin-bottom:18px;}
input:focus{border-color:rgba(255,255,255,.28);}
button{width:100%;padding:12px;background:rgba(255,255,255,.88);color:#0a0a0a;border:none;border-radius:6px;font-size:13px;letter-spacing:.1em;cursor:pointer;font-family:Georgia,serif;}
.err{font-size:11px;color:rgba(255,100,100,.65);text-align:center;margin-top:12px;letter-spacing:.08em;}
</style></head><body><div class="box">
<div class="mark">(◕ᴗ◕✿)</div>
<h1>sena admin</h1>
<form method="POST" action="/admin/login">
  <label>username</label><input name="username" type="text" autocomplete="username" required/>
  <label>password</label><input name="password" type="password" autocomplete="current-password" required/>
  <button type="submit">masuk</button>
  ${error?'<div class="err">username atau password salah</div>':''}
</form></div></body></html>`;
}

/* ══════════════════════════════════════════
   DASHBOARD HTML
══════════════════════════════════════════ */
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function dashboardHTML(db, user) {
  const events      = db.events || [];
  const activeId    = db.activeEventId;
  const activeEvent = events.find(e => e.id === activeId);

  /* Event list sidebar */
  const eventItems = events.length === 0
    ? `<div class="empty-events">belum ada event.<br>Buat event baru di atas.</div>`
    : events.map(e => `
      <div class="event-item ${e.id===activeId?'active':''}" onclick="activateEvent('${esc(e.id)}','${esc(e.name)}')">
        <div class="event-name">${esc(e.name)}</div>
        <div class="event-meta">${esc(e.date)||'—'} · ${e.messages.length} pesan</div>
        <button class="event-del-btn" onclick="deleteEvent(event,'${esc(e.id)}','${esc(e.name)}')">hapus event</button>
      </div>`).join('');

  /* Message table for active event */
  const msgs = activeEvent ? activeEvent.messages : [];
  const msgRows = msgs.length === 0
    ? `<tr><td colspan="5" class="empty-msg">${activeEvent ? 'belum ada pesan di event ini.' : 'pilih atau buat event dulu.'}</td></tr>`
    : msgs.map((m,i) => `
      <tr id="row-${esc(m.id)}">
        <td><input type="checkbox" class="msg-check" value="${esc(m.id)}" onchange="updateBulk()"/></td>
        <td>${i+1}</td>
        <td><strong>${esc(m.name)}</strong></td>
        <td class="bc">${esc(m.body)}</td>
        <td class="ts">${fmtDate(m.ts)}</td>
        <td><button class="del-btn" onclick="deleteMsg('${esc(m.id)}','${esc(m.name)}')">hapus</button></td>
      </tr>`).join('');

  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>sena — dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Georgia,serif;background:#0a0a0a;color:rgba(255,255,255,.7);min-height:100vh;display:flex;flex-direction:column;}
/* Top bar */
.topbar{display:flex;align-items:center;gap:12px;padding:16px 24px;border-bottom:.5px solid rgba(255,255,255,.07);background:#0a0a0a;position:sticky;top:0;z-index:10;}
.topbar h1{font-size:15px;font-weight:400;color:rgba(255,255,255,.8);letter-spacing:.08em;flex:1;}
.topbar-user{font-size:10px;color:rgba(255,255,255,.2);letter-spacing:.1em;}
a.tbtn{font-size:10px;color:rgba(255,255,255,.28);border:.5px solid rgba(255,255,255,.1);padding:4px 12px;border-radius:12px;text-decoration:none;letter-spacing:.08em;}
a.tbtn:hover{color:rgba(255,255,255,.6);}
a.tbtn.danger{color:rgba(255,80,80,.4);border-color:rgba(255,80,80,.15);}
a.tbtn.danger:hover{color:rgba(255,80,80,.7);}
/* Layout */
.layout{display:flex;flex:1;min-height:0;}
/* Sidebar */
.sidebar{width:260px;flex-shrink:0;border-right:.5px solid rgba(255,255,255,.07);padding:20px 16px;overflow-y:auto;}
.sidebar h2{font-size:10px;letter-spacing:.18em;color:rgba(255,255,255,.22);text-transform:uppercase;margin-bottom:14px;}
/* New event form */
.new-event-form{margin-bottom:20px;display:flex;flex-direction:column;gap:8px;}
.new-event-form input{background:rgba(255,255,255,.05);border:.5px solid rgba(255,255,255,.1);color:rgba(255,255,255,.75);font-family:Georgia,serif;font-size:13px;padding:8px 10px;border-radius:5px;outline:none;width:100%;}
.new-event-form input:focus{border-color:rgba(255,255,255,.25);}
.new-event-form input::placeholder{color:rgba(255,255,255,.18);}
.btn-create{background:rgba(255,255,255,.85);color:#0a0a0a;border:none;border-radius:5px;padding:8px;font-size:12px;letter-spacing:.08em;cursor:pointer;font-family:Georgia,serif;width:100%;}
.btn-create:hover{background:#fff;}
.sidebar-divider{height:.5px;background:rgba(255,255,255,.07);margin-bottom:14px;}
/* Event items */
.event-item{padding:10px 10px;border-radius:6px;cursor:pointer;margin-bottom:6px;border:.5px solid rgba(255,255,255,.05);transition:background .15s;position:relative;}
.event-item:hover{background:rgba(255,255,255,.04);}
.event-item.active{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.15);}
.event-name{font-size:13px;color:rgba(255,255,255,.75);margin-bottom:3px;padding-right:60px;}
.event-meta{font-size:10px;color:rgba(255,255,255,.22);letter-spacing:.06em;}
.event-del-btn{position:absolute;top:8px;right:8px;background:none;border:none;color:rgba(255,80,80,.3);font-size:10px;cursor:pointer;letter-spacing:.06em;font-family:Georgia,serif;padding:2px 6px;border-radius:4px;}
.event-del-btn:hover{color:rgba(255,80,80,.7);background:rgba(255,80,80,.08);}
.empty-events{font-size:12px;color:rgba(255,255,255,.18);font-style:italic;line-height:1.6;padding:8px 4px;}
/* Main content */
.main{flex:1;padding:20px 24px;overflow-y:auto;}
.main-header{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;}
.main-header h2{font-size:14px;font-weight:400;color:rgba(255,255,255,.75);flex:1;}
.active-badge{font-size:9px;background:rgba(74,222,128,.12);border:.5px solid rgba(74,222,128,.25);color:rgba(74,222,128,.65);padding:3px 10px;border-radius:12px;letter-spacing:.1em;}
.msg-count{font-size:11px;color:rgba(255,255,255,.2);letter-spacing:.08em;}
/* Bulk actions */
.bulk-bar{display:none;align-items:center;gap:10px;margin-bottom:12px;padding:8px 12px;background:rgba(255,255,255,.04);border-radius:6px;border:.5px solid rgba(255,255,255,.08);}
.bulk-bar.show{display:flex;}
.bulk-count{font-size:12px;color:rgba(255,255,255,.45);flex:1;}
.btn-del-bulk{background:rgba(255,80,80,.15);border:.5px solid rgba(255,80,80,.3);color:rgba(255,80,80,.75);font-size:11px;padding:5px 14px;border-radius:5px;cursor:pointer;font-family:Georgia,serif;letter-spacing:.06em;}
.btn-del-bulk:hover{background:rgba(255,80,80,.25);}
.btn-clear-sel{background:none;border:none;color:rgba(255,255,255,.25);font-size:11px;cursor:pointer;font-family:Georgia,serif;letter-spacing:.06em;}
/* Table */
table{width:100%;border-collapse:collapse;font-size:13px;}
th{text-align:left;font-size:9px;letter-spacing:.15em;color:rgba(255,255,255,.2);text-transform:uppercase;padding:8px 10px;border-bottom:.5px solid rgba(255,255,255,.07);}
th:first-child{width:32px;}
td{padding:11px 10px;border-bottom:.5px solid rgba(255,255,255,.04);vertical-align:top;}
td:first-child{width:32px;}
td strong{color:rgba(255,255,255,.75);}
.bc{color:rgba(255,255,255,.42);font-style:italic;max-width:340px;line-height:1.65;}
.ts{font-size:11px;color:rgba(255,255,255,.2);white-space:nowrap;}
tr:hover td{background:rgba(255,255,255,.016);}
tr.selected td{background:rgba(255,200,80,.04);}
.del-btn{background:none;border:none;color:rgba(255,80,80,.28);font-size:11px;cursor:pointer;font-family:Georgia,serif;letter-spacing:.06em;padding:3px 8px;border-radius:4px;}
.del-btn:hover{color:rgba(255,80,80,.7);background:rgba(255,80,80,.08);}
input[type=checkbox]{accent-color:rgba(74,222,128,.7);width:14px;height:14px;cursor:pointer;}
.empty-msg{color:rgba(255,255,255,.18);font-style:italic;text-align:center;padding:32px;}
/* Toast */
#toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,.1);backdrop-filter:blur(8px);border:.5px solid rgba(255,255,255,.15);color:rgba(255,255,255,.75);font-size:12px;letter-spacing:.08em;padding:8px 20px;border-radius:20px;opacity:0;transition:opacity .3s;pointer-events:none;font-family:Georgia,serif;}
#toast.show{opacity:1;}
</style></head>
<body>

<div class="topbar">
  <h1>(◕ᴗ◕✿) dashboard</h1>
  <span class="topbar-user">${esc(user)}</span>
  <a class="tbtn" href="/dashboard">↻</a>
  <a class="tbtn" href="/api/db" target="_blank">JSON</a>
  <a class="tbtn danger" href="/admin/logout">keluar</a>
</div>

<div class="layout">

  <!-- SIDEBAR: event list -->
  <div class="sidebar">
    <h2>buat event</h2>
    <div class="new-event-form">
      <input id="evt-name" type="text" placeholder="nama acara..." maxlength="60"/>
      <input id="evt-date" type="date"/>
      <button class="btn-create" onclick="createEvent()">+ buat event</button>
    </div>
    <div class="sidebar-divider"></div>
    <h2>semua event</h2>
    ${eventItems}
  </div>

  <!-- MAIN: messages -->
  <div class="main">
    <div class="main-header">
      <h2 id="main-title">${activeEvent ? esc(activeEvent.name) : 'pilih event'}</h2>
      ${activeEvent ? `<span class="active-badge">aktif</span>` : ''}
      <span class="msg-count" id="msg-count">${msgs.length} pesan</span>
    </div>

    <!-- Bulk action bar -->
    <div class="bulk-bar" id="bulk-bar">
      <span class="bulk-count" id="bulk-count">0 dipilih</span>
      <button class="btn-del-bulk" onclick="deleteBulk()">hapus yang dipilih</button>
      <button class="btn-clear-sel" onclick="clearSelection()">batal pilih</button>
    </div>

    <table>
      <thead>
        <tr>
          <th><input type="checkbox" id="check-all" onchange="toggleAll(this)"/></th>
          <th>#</th><th>nama</th><th>tulisan</th><th>waktu</th><th></th>
        </tr>
      </thead>
      <tbody id="msg-tbody">${msgRows}</tbody>
    </table>
  </div>

</div>

<div id="toast"></div>

<script>
const ACTIVE_EVENT_ID = ${JSON.stringify(activeId)};

/* ── TOAST ── */
function toast(msg, dur=2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), dur);
}

/* ── POST via hidden form (works reliably on all hosts) ── */
function formPost(action, fields, reload=true) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  form.style.display = 'none';
  Object.entries(fields).forEach(([k,v]) => {
    const inp = document.createElement('input');
    inp.type='hidden'; inp.name=k; inp.value=v;
    form.appendChild(inp);
  });
  document.body.appendChild(form);
  form.submit();
}

/* ── CREATE EVENT ── */
function createEvent() {
  const name = document.getElementById('evt-name').value.trim();
  const date = document.getElementById('evt-date').value;
  if (!name) { toast('isi nama acara dulu'); return; }
  formPost('/api/event/new', { name, date });
}

/* ── ACTIVATE EVENT ── */
function activateEvent(id, name) {
  formPost('/api/event/activate', { id });
}

/* ── DELETE EVENT ── */
function deleteEvent(e, id, name) {
  e.stopPropagation();
  if (!confirm('Hapus event "' + name + '" beserta semua pesannya?')) return;
  formPost('/api/event/delete', { id });
}

/* ── DELETE 1 MESSAGE ── */
function deleteMsg(msgId, name) {
  if (!confirm('Hapus pesan dari "' + name + '"?')) return;
  formPost('/api/message/delete', { eventId: ACTIVE_EVENT_ID, messageId: msgId });
}

/* ── SELECT ALL ── */
function toggleAll(cb) {
  document.querySelectorAll('.msg-check').forEach(c => {
    c.checked = cb.checked;
    c.closest('tr').classList.toggle('selected', cb.checked);
  });
  updateBulk();
}

/* ── UPDATE BULK BAR ── */
function updateBulk() {
  const checked = document.querySelectorAll('.msg-check:checked');
  document.getElementById('bulk-count').textContent = checked.length + ' dipilih';
  document.getElementById('bulk-bar').classList.toggle('show', checked.length > 0);
  document.querySelectorAll('.msg-check').forEach(c => {
    c.closest('tr').classList.toggle('selected', c.checked);
  });
}

/* ── DELETE BULK ── */
function deleteBulk() {
  const ids = [...document.querySelectorAll('.msg-check:checked')].map(c => c.value);
  if (!ids.length) return;
  if (!confirm('Hapus ' + ids.length + ' pesan yang dipilih?')) return;
  formPost('/api/message/delete-bulk', { eventId: ACTIVE_EVENT_ID, ids: ids.join(',') });
}

/* ── CLEAR SELECTION ── */
function clearSelection() {
  document.querySelectorAll('.msg-check').forEach(c => {
    c.checked=false; c.closest('tr').classList.remove('selected');
  });
  const ca = document.getElementById('check-all');
  if (ca) ca.checked=false;
  updateBulk();
}

const today = new Date().toISOString().split('T')[0];
const dateInput = document.getElementById('evt-date');
if (dateInput) dateInput.value = today;
</script>
</body></html>`;
}

/* ══════════════════════════════════════════
   WEBSOCKET
══════════════════════════════════════════ */
const wsSessions = {};
function wsSession(sid) {
  if (!wsSessions[sid]) wsSessions[sid] = { desktop:null, guests:[] };
  return wsSessions[sid];
}

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url  = new URL(req.url, `http://localhost:${PORT}`);
  const role = url.searchParams.get('role');
  const sid  = url.searchParams.get('sid');
  if (!role||!sid) { ws.close(); return; }
  ws.role=role; ws.sid=sid;
  const s = wsSession(sid);

  if (role==='desktop') {
    if (s.desktop) s.desktop.close();
    s.desktop = ws;
    console.log(`[+] desktop  #${sid}`);
    ws.send(JSON.stringify({type:'connected',role:'desktop',sid}));
  } else {
    s.guests.push(ws);
    console.log(`[+] guest    #${sid}`);
    ws.send(JSON.stringify({type:'connected',role:'guest',sid}));
    if (s.desktop?.readyState===1)
      s.desktop.send(JSON.stringify({type:'guest_joined',sid}));
  }

  ws.on('message', raw => {
    let msg; try{msg=JSON.parse(raw);}catch{return;}
    const S = wsSessions[msg.sid||sid];
    if (!S) return;

    if (msg.type==='write') {
      console.log(`[✓] pesan    #${sid}: "${msg.title}"`);
      // Save to active event
      addMessage(msg.title, msg.body, sid);
      // Mirror to desktop screen
      if (S.desktop?.readyState===1)
        S.desktop.send(JSON.stringify({type:'write',title:msg.title,body:msg.body}));
    }

    if (msg.type==='reset') {
      console.log(`[~] reset    #${sid}`);
      S.guests.forEach(g=>{ if(g.readyState===1) g.send(JSON.stringify({type:'reset'})); });
      delete wsSessions[sid];
    }
  });

  ws.on('close', ()=>{
    const S=wsSessions[sid]; if(!S) return;
    if (role==='desktop') { S.desktop=null; console.log(`[-] desktop  #${sid}`); }
    else { S.guests=S.guests.filter(g=>g!==ws); console.log(`[-] guest    #${sid}`); }
  });
  ws.on('error', e=>console.error(`[!] #${sid}:`,e.message));
});

/* ══════════════════════════════════════════
   START
══════════════════════════════════════════ */
ensureDB();
server.listen(PORT, ()=>{
  const db = loadDB();
  const ae = db.events.find(e=>e.id===db.activeEventId);
  console.log('\n  (◕ᴗ◕✿) sena instalasi v4.1');
  console.log('  ──────────────────────────────────');
  console.log(`  Layar      →  http://localhost:${PORT}/`);
  console.log(`  HP tamu    →  http://localhost:${PORT}/tamu`);
  console.log(`  Dashboard  →  http://localhost:${PORT}/dashboard`);
  console.log(`  Admin      :  ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log(`  Event aktif:  ${ae ? ae.name : '(belum ada — buat di dashboard)'}`);
  console.log('  ──────────────────────────────────\n');
});
