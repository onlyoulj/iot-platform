/**
 * 仪表盘截图脚本：登录拿 token → 注入 localStorage → 截图 /dashboard
 * node dash-shot.mjs <outfile> [waitMs]
 */
import http from 'node:http';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEBUG_PORT = 9224;
const BASE = 'http://localhost:3000/api';
const outfile = process.argv[2] || 'dash.png';
const waitMs = process.argv[3] || '3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 登录拿 token + user
const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'Admin@123' }),
}).then((r) => r.json());
if (loginRes.code !== 0) {
  console.error('login failed', loginRes);
  process.exit(1);
}
const { token, user } = loginRes.data;
console.log('login ok, token len', token.length);

// 2) 启动 Chrome
const { spawn } = await import('node:child_process');
const profile = 'C:/Users/ninesugar/AppData/Local/Temp/dash-shot-profile';
const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1280,1500', 'about:blank',
  ],
  { stdio: 'ignore' }
);

try {
  let version = null;
  for (let i = 0; i < 50; i++) {
    try {
      version = await new Promise((res, rej) =>
        http.get({ host: '127.0.0.1', port: DEBUG_PORT, path: '/json/version' }, (r) => {
          let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(JSON.parse(b)));
        }).on('error', rej)
      );
      break;
    } catch { await sleep(200); }
  }
  if (!version) throw new Error('DevTools not ready');

  const target = await new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port: DEBUG_PORT, path: '/json/new?about:blank', method: 'PUT' }, (r) => {
      let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(JSON.parse(b)));
    });
    req.on('error', rej); req.end();
  });

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId; pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://localhost:5173/login' });
  await sleep(800);
  // 注入登录态（localStorage），再跳 dashboard
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('iot:token', ${JSON.stringify(token)}); localStorage.setItem('iot:user', ${JSON.stringify(JSON.stringify(user))}); 'ok'`,
    returnByValue: true,
  });
  await send('Page.navigate', { url: 'http://localhost:5173/dashboard' });
  await sleep(Number(waitMs));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outfile, Buffer.from(shot.result.data, 'base64'));
  console.log('saved:', outfile);
  ws.close();
} finally {
  chrome.kill();
}
process.exit(0);
