/**
 * 告警中心截图：登录注入 → /alert → 点规则配置 tab → 截图
 */
import http from 'node:http';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9226;
const outfile = process.argv[2] || 'alert.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loginRes = await fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'Admin@123' }),
}).then((r) => r.json());
const { token, user } = loginRes.data;

const { spawn } = await import('node:child_process');
const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=C:/Users/ninesugar/AppData/Local/Temp/alert-shot-profile',
    '--window-size=1280,1100', 'about:blank',
  ],
  { stdio: 'ignore' }
);

try {
  let version = null;
  for (let i = 0; i < 50; i++) {
    try {
      version = await new Promise((res, rej) => {
        http.get({ host: '127.0.0.1', port: PORT, path: '/json/version' }, (r) => {
          let b = '';
          r.on('data', (c) => (b += c));
          r.on('end', () => res(JSON.parse(b)));
        }).on('error', rej);
      });
      break;
    } catch { await sleep(200); }
  }
  if (!version) throw new Error('not ready');

  const target = await new Promise((res, rej) => {
    const q = http.request({ host: '127.0.0.1', port: PORT, path: '/json/new?about:blank', method: 'PUT' }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => res(JSON.parse(b)));
    });
    q.on('error', rej);
    q.end();
  });

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id; pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://localhost:5173/login' });
  await sleep(700);
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('iot:token', ${JSON.stringify(token)}); localStorage.setItem('iot:user', ${JSON.stringify(JSON.stringify(user))}); 'ok'`,
    returnByValue: true,
  });
  await send('Page.navigate', { url: 'http://localhost:5173/alert' });
  await sleep(2500);

  // 点击「规则配置」tab
  const clickRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const tabs = [...document.querySelectorAll('.el-tabs__item')];
      const target = tabs.find((t) => t.textContent.includes('规则配置'));
      if (target) { target.click(); return 'CLICKED'; }
      return 'NO_TAB';
    })()`,
    returnByValue: true,
  });
  console.log('click tab:', clickRes.result?.result?.value);
  await sleep(1500);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outfile, Buffer.from(shot.result.data, 'base64'));
  console.log('saved:', outfile);
  ws.close();
} finally {
  chrome.kill();
}
process.exit(0);
