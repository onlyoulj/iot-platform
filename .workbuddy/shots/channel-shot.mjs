import http from 'node:http';
import fs from 'node:fs';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9227;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const login=await fetch('http://localhost:3000/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'Admin@123'})}).then(r=>r.json());
const {token,user}=login.data;
// 先建一条示例渠道供截图展示
await fetch('http://localhost:3000/api/alerts/channels',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({name:'运维告警群',type:'wecom',config:{webhook_url:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx'},enabled:1,levels:'critical,major'})}).then(r=>r.json());
await fetch('http://localhost:3000/api/alerts/channels',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({name:'钉钉监控',type:'dingtalk',config:{webhook_url:'https://oapi.dingtalk.com/robot/send?access_token=xxx',secret:'SECxxx'},enabled:1,levels:'critical'})}).then(r=>r.json());
const {spawn}=await import('node:child_process');
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars',`--remote-debugging-port=${PORT}`,'--user-data-dir=C:/Users/ninesugar/AppData/Local/Temp/channel-shot-profile','--window-size=1280,900','about:blank'],{stdio:'ignore'});
try{
  let v=null;for(let i=0;i<50;i++){try{v=await new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path:'/json/version'},r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>res(JSON.parse(b)))}).on('error',rej)});break}catch{await sleep(200)}}
  if(!v)throw new Error('not ready');
  const t=await new Promise((res,rej)=>{const q=http.request({host:'127.0.0.1',port:PORT,path:'/json/new?about:blank',method:'PUT'},r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>res(JSON.parse(b)))});q.on('error',rej);q.end()});
  const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  let id=0;const pend=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}};
  const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
  await send('Page.enable');await send('Runtime.enable');
  await send('Page.navigate',{url:'http://localhost:5173/login'});await sleep(700);
  await send('Runtime.evaluate',{expression:`localStorage.setItem('iot:token',${JSON.stringify(token)});localStorage.setItem('iot:user',${JSON.stringify(JSON.stringify(user))});'ok'`,returnByValue:true});
  await send('Page.navigate',{url:'http://localhost:5173/alert'});await sleep(2200);
  await send('Runtime.evaluate',{expression:`(()=>{const t=[...document.querySelectorAll('.el-tabs__item')].find(x=>x.textContent.includes('通知渠道'));if(t){t.click();return 'CLICKED'}return 'NO_TAB'})()`,returnByValue:true});
  await sleep(1200);
  const s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('E:/iot-platform/.workbuddy/shots/channels.png',Buffer.from(s.result.data,'base64'));console.log('saved');ws.close();
}finally{chrome.kill()}process.exit(0);
