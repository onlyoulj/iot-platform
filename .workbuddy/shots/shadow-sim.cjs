/* 模拟设备上报 shadow_report → 验证影子更新 → 手动补录 → 读影子 */
const mqtt = require('mqtt');
const base = 'http://localhost:3000/api';

(async () => {
  const login = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123' }),
  }).then((r) => r.json());
  const auth = { Authorization: 'Bearer ' + login.data.token };

  // 模拟设备上报 reported
  const c = mqtt.connect('mqtt://129.204.31.17:1883', {
    username: 'os',
    password: 'os',
    clientId: 'shadow-sim-' + Date.now(),
  });
  await new Promise((r) => c.on('connect', r));
  await new Promise((r) =>
    c.publish(
      'device/8/uplink',
      JSON.stringify({ type: 'shadow_report', data: { reported: { switch: true, brightness: 78, temperature: 26.5 } } }),
      { qos: 1 },
      r
    )
  );
  console.log('shadow_report published (switch=true, brightness=78, temperature=26.5)');
  await new Promise((r) => setTimeout(r, 1500));
  c.end();

  // 读影子
  const sh = await fetch(base + '/devices/8/shadow', { headers: auth }).then((r) => r.json());
  console.log('=== shadow ===');
  console.log('desired :', JSON.stringify(sh.data.desired), 'v' + sh.data.desired_version);
  console.log('reported:', JSON.stringify(sh.data.reported), 'v' + sh.data.reported_version);

  // 手动补录接口
  const rep = await fetch(base + '/devices/8/shadow/reported', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ reported: { brightness: 85 } }),
  }).then((r) => r.json());
  console.log('manual report =>', rep.code, rep.message, 'reported=', JSON.stringify(rep.data?.shadow?.reported));

  // 设备 ack 清除 desired 模拟（设备执行完 brightness=80 后上报）
  const c2 = mqtt.connect('mqtt://129.204.31.17:1883', {
    username: 'os',
    password: 'os',
    clientId: 'ack-sim-' + Date.now(),
  });
  await new Promise((r) => c2.on('connect', r));
  await new Promise((r) =>
    c2.publish(
      'device/8/uplink',
      JSON.stringify({ type: 'shadow_ack', data: { applied: ['switch', 'brightness'] } }),
      { qos: 1 },
      r
    )
  );
  await new Promise((r) => setTimeout(r, 1500));
  c2.end();
  const sh2 = await fetch(base + '/devices/8/shadow', { headers: auth }).then((r) => r.json());
  console.log('=== after ack ===');
  console.log('desired :', JSON.stringify(sh2.data.desired), '(应为 {}，已执行清除)');
  console.log('reported:', JSON.stringify(sh2.data.reported));
})();
