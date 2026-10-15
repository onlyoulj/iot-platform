/**
 * 零依赖 CDP 截图脚本：打开页面 → 等待渲染 → 可选点击 → 截图
 * 用法: node cdp-shot.mjs <url> <outfile> [clickSelectorText] [waitMs]
 */
import http from 'node:http';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEBUG_PORT = 9223;
const [url, outfile, clickText, waitMs = '2500'] = process.argv.slice(2);
if (!url || !outfile) {
  console.error('usage: node cdp-shot.mjs <url> <outfile> [clickText] [waitMs]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGetJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: DEBUG_PORT, path }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve(JSON.parse(buf)));
      })
      .on('error', reject);
  });
}

// 启动 Chrome（headless + remote debugging port）
const { spawn } = await import('node:child_process');
const profile = 'C:/Users/ninesugar/AppData/Local/Temp/cdp-shot-profile';
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=420,900',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

try {
  // 等 DevTools 端口就绪
  let version = null;
  for (let i = 0; i < 50; i++) {
    try {
      version = await httpGetJson('/json/version');
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!version) throw new Error('DevTools 端口未就绪');

  // 新建 target
  const target = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: DEBUG_PORT, path: '/json/new?about:blank', method: 'PUT' },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve(JSON.parse(buf)));
      }
    );
    req.on('error', reject);
    req.end();
  });

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });

  let msgId = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      events.push(msg);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(Number(waitMs));

  // 可选：点击包含指定文字的按钮/链接
  if (clickText) {
    const click = await send('Runtime.evaluate', {
      expression: `(() => {
        const els = [...document.querySelectorAll('button, a, .el-link')];
        const el = els.find((e) => e.textContent.includes(${JSON.stringify(clickText)}));
        if (!el) return 'NOT_FOUND';
        el.click();
        return 'CLICKED';
      })()`,
      returnByValue: true,
    });
    console.log('click:', click.result?.result?.value);
    await sleep(1200); // 等侧滑动画（0.7s）完成
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outfile, Buffer.from(shot.result.data, 'base64'));
  console.log('saved:', outfile);
  ws.close();
} finally {
  chrome.kill();
}
process.exit(0);
