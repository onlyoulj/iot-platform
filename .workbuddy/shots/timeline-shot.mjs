/**
 * 设备详情截图：登录注入 token → /devices → 点第一台设备 → 截详情抽屉
 * node device-shot.mjs <outfile> [waitMs]
 */
import http from 'node:http';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEBUG_PORT = 9225;
const BASE = 'http://localhost:3000/api';
const outfile = process.argv[2] || 'device.png';
const waitMs = process.argv[3] || '3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'Admin@123' }),
}).then((r) => r.json());
const { token, user } = loginRes.data;

const { spawn } = await import('node:child_process');
const profile = 'C:/Users/ninesugar/AppData/Local/Temp/device-shot-profile';
const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1280,1100', 'about:blank',
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
  await sleep(700);
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('iot:token', ${JSON.stringify(token)}); localStorage.setItem('iot:user', ${JSON.stringify(JSON.stringify(user))}); 'ok'`,
    returnByValue: true,
  });
  await send('Page.navigate', { url: 'http://localhost:5173/devices' });
  await sleep(Number(waitMs));

  // 点击第一台设备名称打开详情抽屉
  const clickRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const link = document.querySelector('.device-cell .el-link');
      if (!link) return 'NO_DEVICE_LINK';
      link.click();
      return 'CLICKED';
    })()`,
    returnByValue: true,
  });
  console.log('click device:', clickRes.result?.result?.value);
  await sleep(1500); // 等抽屉 + 趋势 + 控制面板渲染

  // 滚动抽屉到控制面板可见
  await send('Runtime.evaluate', {
    expression: `(() => {
      const drawer = document.querySelector('.el-drawer__body');
      const ctrl = document.querySelector('.ctrl-form');
      if (drawer && ctrl) drawer.scrollTop = ctrl.offsetTop - 20;
      return 'scrolled';
    })()`,
    returnByValue: true,
  });
  await sleep(500);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outfile, Buffer.from(shot.result.data, 'base64'));
  console.log('saved:', outfile);
  ws.close();
} finally {
  chrome.kill();
}
process.exit(0);
