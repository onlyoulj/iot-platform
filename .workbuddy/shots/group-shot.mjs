/**
 * 任务#7 UI 截图：/devices 分组树侧栏 + 点击分组筛选 + /ota 创建弹窗灰度组
 * node group-shot.mjs <outfile>
 */
import http from 'node:http';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEBUG_PORT = 9226;
const BASE = 'http://localhost:3000/api';
const outfile = process.argv[2] || 'group-ui.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'Admin@123' }),
}).then((r) => r.json());
const { token, user } = loginRes.data;

const { spawn } = await import('node:child_process');
const profile = 'C:/Users/ninesugar/AppData/Local/Temp/group-shot-profile';
const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1440,1100', 'about:blank',
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
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };

  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:5173/login' });
  await sleep(700);
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('iot:token', ${JSON.stringify(token)}); localStorage.setItem('iot:user', ${JSON.stringify(JSON.stringify(user))}); 'ok'`,
  });
  await send('Page.navigate', { url: 'http://localhost:5173/devices' });
  await sleep(3500);

  console.log('tree nodes:', await evalJs(`document.querySelectorAll('.group-panel .el-tree-node').length`));
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('group-devices.png', Buffer.from(shot.result.data, 'base64'));
  console.log('saved: group-devices.png');

  // 点击「未分组」节点 → 筛选
  console.log('click none:', await evalJs(`(() => {
    const nodes = [...document.querySelectorAll('.group-panel .el-tree-node__content')];
    const none = nodes.find((n) => n.textContent.includes('未分组'));
    if (!none) return 'NO_NODE';
    none.querySelector('.el-tree-node__label')?.click() || none.click();
    return 'CLICKED';
  })()`));
  await sleep(1800);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('group-filtered.png', Buffer.from(shot.result.data, 'base64'));
  console.log('saved: group-filtered.png');

  // /ota 创建弹窗 → 选灰度组
  await send('Page.navigate', { url: 'http://localhost:5173/ota' });
  await sleep(3000);
  console.log('open dialog:', await evalJs(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('创建升级任务') || b.textContent.includes('创建任务'));
    if (!btn) return 'NO_BTN:' + [...document.querySelectorAll('.page-container button')].map((b)=>b.textContent.trim()).slice(0,8).join('|');
    btn.click(); return 'CLICKED';
  })()`));
  await sleep(1200);
  console.log('select gray:', await evalJs(`(() => {
    const radios = [...document.querySelectorAll('.el-radio')];
    const gray = radios.find((r) => r.textContent.includes('指定分组'));
    if (!gray) return 'NO_RADIO:' + radios.map((r)=>r.textContent.trim()).join('|');
    gray.click(); return 'CLICKED';
  })()`));
  await sleep(800);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outfile, Buffer.from(shot.result.data, 'base64'));
  console.log('saved:', outfile);
  ws.close();
} finally {
  chrome.kill();
}
process.exit(0);
