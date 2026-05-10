/**
 * SENA INSTALASI v4.1 — Server
 * WebSocket + HTTP static + Dashboard admin dengan login
 *
 * Routes:
 *   /              → index.html (layar instalasi)
 *   /tamu          → tamu.html (HP pengunjung)
 *   /dashboard     → panel admin (butuh login)
 *   /admin/login   → halaman login
 *   /admin/logout  → logout
 *   /api/messages  → JSON API (butuh login)
 *
 * Data: ./data/messages.json
 *
 * ENV vars (set di Railway/Render):
 *   PORT           — default 3000
 *   ALLOWED_ORIGIN — default *
 *   ADMIN_USER     — default "admin"
 *   ADMIN_PASS     — default "admin"
 *   SESSION_SECRET — default "sena-secret-2024"
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT          = process.env.PORT          || 3000;
const ORIGIN        = process.env.ALLOWED_ORIGIN || '*';
const ADMIN_USER    = process.env.ADMIN_USER    || 'admin';
const ADMIN_PASS    = process.env.ADMIN_PASS    || 'admin';
const SESSION_SECRET= process.env.SESSION_SECRET || 'sena-secret-2024';

const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css',
  '.js'  :'application/javascript',   '.json':'application/json',
  '.png' :'image/png', '.ico':'image/x-icon', '.svg':'image/svg+xml',
};

/* ─── SIMPLE SESSION STORE (in-memory) ─── */
// Format: { token: { user, expires } }
const activeSessions = {};
function generateToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function createSession(user) {
  const token   = generateToken();
  const expires = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
  activeSessions[token] = { user, expires };
  return token;
}
function getSession(token) {
  const s = activeSessions[token];
  if (!s) return null;
  if (Date.now() > s.expires) { delete activeSessions[token]; return null; }
  return s;
}
function deleteSession(token) { delete activeSessions[token]; }

/* ─── COOKIE HELPERS ─── */
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) out[k.trim()] = v.join('=').trim();
  });
  return out;
}
function setCookieHeader(token) {
  return `sena_admin=${token}; HttpOnly; SameSite=Lax; Max-Age=28800; Path=/`;
}
function clearCookieHeader() {
  return `sena_admin=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`;
}

/* ─── DATA PERSISTENCE ─── */
const DATA_DIR  = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'messages.json');
function ensureData() {
  if (!fs.existsSync(DATA_DIR))  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
}
function loadMsgs()  { try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf-8')); } catch { return []; } }
function saveMsg(m)  { ensureData(); const a=loadMsgs(); a.unshift(m); fs.writeFileSync(DATA_FILE,JSON.stringify(a,null,2)); }

/* ─── SESSIONS (WebSocket) ─── */
const sessions = {};
function wsSession(sid) { if (!sessions[sid]) sessions[sid]={desktop:null,guests:[]}; return sessions[sid]; }

/* ─── PARSE REQUEST BODY ─── */
function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const params = {};
        body.split('&').forEach(p => {
          const [k,v] = p.split('=');
          if (k) params[decodeURIComponent(k)] = decodeURIComponent(v||'');
        });
        resolve(params);
      } catch { resolve({}); }
    });
  });
}

/* ─── HTTP SERVER ─── */
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  const url     = req.url.split('?')[0];
  const cookies = parseCookies(req.headers['cookie']);
  const session = getSession(cookies['sena_admin']);
  const isAuth  = !!session;

  /* ── LOGIN PAGE ── */
  if (url === '/admin/login') {
    if (req.method === 'POST') {
      const body = await parseBody(req);
      if (body.username === ADMIN_USER && body.password === ADMIN_PASS) {
        const token = createSession(body.username);
        res.writeHead(302, { 'Location': '/dashboard', 'Set-Cookie': setCookieHeader(token) });
        res.end(); return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(loginHTML(true)); return;
    }
    if (isAuth) { res.writeHead(302, { 'Location': '/dashboard' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(loginHTML(false)); return;
  }

  /* ── LOGOUT ── */
  if (url === '/admin/logout') {
    if (cookies['sena_admin']) deleteSession(cookies['sena_admin']);
    res.writeHead(302, { 'Location': '/admin/login', 'Set-Cookie': clearCookieHeader() });
    res.end(); return;
  }

  /* ── DASHBOARD (protected) ── */
  if (url === '/dashboard') {
    if (!isAuth) { res.writeHead(302, { 'Location': '/admin/login' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardHTML(loadMsgs(), session.user)); return;
  }

  /* ── API JSON (protected) ── */
  if (url === '/api/messages') {
    if (!isAuth) { res.writeHead(401); res.end('Unauthorized'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadMsgs())); return;
  }

  /* ── STATIC FILES ── */
  let fp = url;
  if (fp==='/'||fp==='/layar') fp='/index.html';
  if (fp==='/tamu')            fp='/tamu.html';

  fs.readFile(path.join(__dirname, fp), (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
    res.end(data);
  });
});

/* ─── LOGIN HTML ─── */
function loginHTML(error) {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>sena — admin login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Georgia,serif;background:#0a0a0a;min-height:100vh;display:flex;align-items:center;justify-content:center;}
.box{width:320px;padding:40px 36px;}
.mark{font-size:16px;opacity:.25;text-align:center;margin-bottom:28px;}
h1{font-size:15px;font-weight:400;color:rgba(255,255,255,.6);letter-spacing:.12em;text-align:center;margin-bottom:32px;}
.lbl{display:block;font-size:10px;letter-spacing:.18em;color:rgba(255,255,255,.25);text-transform:uppercase;margin-bottom:7px;}
input{width:100%;background:rgba(255,255,255,.05);border:.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.8);font-family:Georgia,serif;font-size:15px;padding:12px 14px;border-radius:6px;outline:none;margin-bottom:20px;}
input:focus{border-color:rgba(255,255,255,.3);}
.btn{width:100%;padding:13px;background:rgba(255,255,255,.9);color:#0a0a0a;border:none;border-radius:6px;font-size:13px;letter-spacing:.1em;cursor:pointer;font-family:Georgia,serif;}
.err{font-size:11px;color:rgba(255,120,100,.7);text-align:center;margin-top:14px;letter-spacing:.08em;}
</style></head><body>
<div class="box">
  <div class="mark">(◕ᴗ◕✿)</div>
  <h1>sena admin</h1>
  <form method="POST" action="/admin/login">
    <label class="lbl" for="u">username</label>
    <input id="u" name="username" type="text" autocomplete="username" placeholder="admin" required/>
    <label class="lbl" for="p">password</label>
    <input id="p" name="password" type="password" autocomplete="current-password" placeholder="••••••" required/>
    <button class="btn" type="submit">masuk</button>
    ${error ? '<div class="err">username atau password salah</div>' : ''}
  </form>
</div>
</body></html>`;
}

/* ─── DASHBOARD HTML ─── */
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function dashboardHTML(msgs, user) {
  const rows = msgs.map((m,i)=>`<tr>
    <td>${i+1}</td>
    <td><strong>${esc(m.name||'—')}</strong></td>
    <td class="bc">${esc(m.body||'—')}</td>
    <td>${esc(m.sid||'—')}</td>
    <td>${m.ts?new Date(m.ts).toLocaleString('id-ID'):'—'}</td>
  </tr>`).join('');

  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>sena — dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Georgia,serif;background:#0a0a0a;color:rgba(255,255,255,.7);padding:36px 32px;}
header{display:flex;align-items:center;gap:14px;margin-bottom:6px;flex-wrap:wrap;}
h1{font-size:18px;font-weight:400;color:rgba(255,255,255,.85);letter-spacing:.08em;}
.actions{display:flex;gap:10px;margin-left:auto;}
a.btn{font-size:10px;color:rgba(255,255,255,.3);border:.5px solid rgba(255,255,255,.1);padding:4px 12px;border-radius:12px;text-decoration:none;letter-spacing:.1em;}
a.btn:hover{color:rgba(255,255,255,.6);}
a.btn.danger{color:rgba(255,100,100,.4);border-color:rgba(255,100,100,.15);}
a.btn.danger:hover{color:rgba(255,100,100,.7);}
.sub{font-size:11px;color:rgba(255,255,255,.2);letter-spacing:.1em;margin-bottom:6px;}
.count{font-size:11px;color:rgba(255,255,255,.15);letter-spacing:.1em;margin-bottom:28px;}
.user-badge{font-size:10px;color:rgba(255,255,255,.2);letter-spacing:.1em;margin-top:2px;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{text-align:left;font-size:9px;letter-spacing:.16em;color:rgba(255,255,255,.22);text-transform:uppercase;padding:8px 12px;border-bottom:.5px solid rgba(255,255,255,.07);}
td{padding:12px 12px;border-bottom:.5px solid rgba(255,255,255,.04);vertical-align:top;}
td:first-child{color:rgba(255,255,255,.18);width:36px;}
td strong{color:rgba(255,255,255,.75);}
.bc{color:rgba(255,255,255,.45);font-style:italic;max-width:360px;line-height:1.65;}
tr:hover td{background:rgba(255,255,255,.018);}
.empty{font-size:13px;color:rgba(255,255,255,.18);font-style:italic;}
</style></head><body>
<header>
  <div>
    <h1>(◕ᴗ◕✿) dashboard</h1>
    <div class="user-badge">masuk sebagai ${esc(user)}</div>
  </div>
  <div class="actions">
    <a class="btn" href="/dashboard">↻ refresh</a>
    <a class="btn" href="/api/messages" target="_blank">JSON ↗</a>
    <a class="btn danger" href="/admin/logout">keluar</a>
  </div>
</header>
<div class="sub">sena instalasi v4.1 — panel admin</div>
<div class="count">${msgs.length} pesan tersimpan</div>
${msgs.length===0
  ? '<p class="empty">belum ada pesan.</p>'
  : `<table><thead><tr>
      <th>#</th><th>nama</th><th>tulisan</th><th>sesi</th><th>waktu</th>
    </tr></thead><tbody>${rows}</tbody></table>`}
</body></html>`;
}

/* ─── WEBSOCKET ─── */
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
    s.desktop=ws;
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
    const S=sessions[msg.sid||sid]; if(!S) return;

    if (msg.type==='write') {
      console.log(`[✓] pesan    #${sid}: "${msg.title}"`);
      if (S.desktop?.readyState===1)
        S.desktop.send(JSON.stringify({type:'write',title:msg.title,body:msg.body}));
    }
    if (msg.type==='save') {
      saveMsg({name:msg.title,body:msg.body,sid:msg.sid||sid,ts:msg.ts||Date.now()});
      console.log(`[💾] saved    #${sid}: "${msg.title}"`);
    }
    if (msg.type==='reset') {
      console.log(`[~] reset    #${sid}`);
      S.guests.forEach(g=>{if(g.readyState===1)g.send(JSON.stringify({type:'reset'}));});
      delete sessions[sid];
    }
  });

  ws.on('close', ()=>{
    const S=sessions[sid]; if(!S) return;
    if (role==='desktop') { S.desktop=null; console.log(`[-] desktop  #${sid}`); }
    else { S.guests=S.guests.filter(g=>g!==ws); console.log(`[-] guest    #${sid}`); }
  });
  ws.on('error', e=>console.error(`[!] #${sid}:`,e.message));
});

/* ─── START ─── */
ensureData();
server.listen(PORT, ()=>{
  console.log('\n  (◕ᴗ◕✿) sena instalasi v4.1');
  console.log('  ──────────────────────────────────');
  console.log(`  Layar      →  http://localhost:${PORT}/`);
  console.log(`  HP tamu    →  http://localhost:${PORT}/tamu`);
  console.log(`  Dashboard  →  http://localhost:${PORT}/dashboard`);
  console.log(`  Admin user : ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log('  ──────────────────────────────────\n');
});
