/**
 * 鉴权与权限链路自测（临时脚本，验证完可删）
 * 覆盖：未登录 401 / 错误口令 401 / 登录成功 / me / 越权 403 / 超管全通 / 用户与用户组 CRUD
 */
const B = 'http://127.0.0.1:3000/api';

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const login = async (username, password) => {
  const r = await call('/auth/login', { method: 'POST', body: { username, password } });
  return { token: r.json?.data?.token, ...r };
};

(async () => {
  /* 1. 未登录 */
  let r = await call('/devices');
  check('未登录访问 /devices 返回 401', r.status === 401 && r.json.code === 401, `${r.status} ${r.json?.message}`);

  r = await call('/auth/me');
  check('未登录访问 /auth/me 返回 401', r.status === 401);

  /* 2. 登录校验 */
  r = await call('/auth/login', { method: 'POST', body: { username: 'admin', password: 'bad' } });
  check('错误口令返回 401', r.status === 401, r.json?.message);

  r = await call('/auth/login', { method: 'POST', body: { username: 'nobody', password: 'whatever' } });
  check('不存在用户与错误口令文案一致（防枚举）', r.json?.message === '用户名或密码错误', r.json?.message);

  /* 3. 三种角色登录 */
  const admin = await login('admin', 'Admin@123');
  const ops = await login('ops', 'Ops@12345');
  const viewer = await login('viewer', 'Viewer@123');
  check('admin 登录成功且返回 token', admin.status === 200 && !!admin.token);
  check('ops 登录成功', ops.status === 200 && !!ops.token);
  check('viewer 登录成功', viewer.status === 200 && !!viewer.token);
  check('admin 拥有 16 个权限点', admin.json?.data?.user?.permissions?.length === 16, `${admin.json?.data?.user?.permissions?.length}`);
  check('ops 不含 user:manage', !admin.json?.data?.user?.permissions?.includes('user:manage') === false && !ops.json?.data?.user?.permissions?.includes('user:manage'));

  /* 4. me */
  r = await call('/auth/me', { token: admin.token });
  check('/auth/me 返回当前用户与角色', r.json?.data?.username === 'admin' && r.json?.data?.group_code === 'super_admin', r.json?.data?.group_name);

  /* 5. 伪造 token */
  r = await call('/devices', { token: 'aaaa.bbbb' });
  check('伪造 token 返回 401', r.status === 401);

  /* 6. 权限差异 */
  r = await call('/devices?page=1&pageSize=1', { token: viewer.token });
  check('viewer 可读设备列表', r.status === 200 && r.json.code === 0, `total=${r.json?.data?.total}`);

  r = await call('/devices', { method: 'POST', token: viewer.token, body: { name: 'x', device_name: 'X-1', product_name: '智能网关 GW-S1' } });
  check('viewer 新增设备被拒 403', r.status === 403, r.json?.message);

  r = await call('/dashboard/stats', { token: ops.token });
  check('ops 可读仪表盘', r.status === 200);

  r = await call('/users', { token: viewer.token });
  check('viewer 访问用户管理被拒 403', r.status === 403, r.json?.message);

  r = await call('/users', { token: ops.token });
  check('ops（无 user:view）访问用户管理被拒 403', r.status === 403, r.json?.message);

  /* 7. 用户管理 CRUD */
  r = await call('/users?page=1&pageSize=10', { token: admin.token });
  check('admin 用户列表含 3 个内置用户', r.json?.data?.total === 3, JSON.stringify(r.json?.data?.list?.map((u) => u.username)));

  r = await call('/users', { method: 'POST', token: admin.token, body: { username: 'qa01', password: 'Qa@12345', nickname: '测试账号', group_id: 3 } });
  check('admin 新建用户成功', r.status === 201 && r.json?.data?.username === 'qa01', r.json?.message);
  const qaId = r.json?.data?.id;

  r = await call('/users', { method: 'POST', token: admin.token, body: { username: 'qa01', password: 'Qa@12345', group_id: 3 } });
  check('重复用户名返回 409', r.status === 409, r.json?.message);

  r = await call('/users', { method: 'POST', token: admin.token, body: { username: 'qa02', password: 'Qa@12345', group_id: 1 } });
  check('超管可分配 super_admin 组', r.status === 201);
  const qa2Id = r.json?.data?.id;

  // 用 ops 提权测试：先给 ops 的组加 user:manage 需要超管；这里直接用 admin 创建组测试敏感权限保护
  r = await call('/groups', { method: 'POST', token: ops.token, body: { name: '提权组', code: 'escalate', permissions: ['user:manage'] } });
  check('ops 无 group:manage，创建组被拒 403', r.status === 403, r.json?.message);

  /* 8. 用户组 */
  r = await call('/groups', { token: admin.token });
  check('用户组列表含 3 个内置组', r.json?.data?.list?.length === 3, JSON.stringify(r.json?.data?.list?.map((g) => g.code)));
  check('权限点字典返回 16 项', r.json?.data?.permissions?.length === 16);

  r = await call('/groups', { method: 'POST', token: admin.token, body: { name: '区域运维', code: 'region_ops', desc: '区域负责人', permissions: ['dashboard:view', 'device:view', 'device:edit', 'alert:view'] } });
  check('admin 新建用户组成功', r.status === 201, JSON.stringify(r.json?.data?.permissions));
  const newGroupId = r.json?.data?.id;

  r = await call(`/groups/${newGroupId}`, { method: 'PUT', token: admin.token, body: { permissions: ['dashboard:view', 'device:view'] } });
  check('更新用户组权限生效', r.json?.data?.permissions?.length === 2, JSON.stringify(r.json?.data?.permissions));

  r = await call('/groups/1', { method: 'PUT', token: admin.token, body: { permissions: ['device:view'] } });
  check('超管组权限不可修改', r.status === 400, r.json?.message);

  r = await call('/groups/1', { method: 'DELETE', token: admin.token });
  check('内置组不可删除', r.status === 400, r.json?.message);

  r = await call(`/groups/${newGroupId}`, { method: 'DELETE', token: admin.token });
  check('空组可删除', r.status === 200, r.json?.message);

  /* 9. 自我保护 */
  r = await call(`/users/${admin.json.data.user.id}`, { method: 'DELETE', token: admin.token });
  check('不能删除自己', r.status === 400, r.json?.message);

  r = await call(`/users/${admin.json.data.user.id}`, { method: 'PUT', token: admin.token, body: { status: 'disabled' } });
  check('不能禁用自己', r.status === 400, r.json?.message);

  // 新超管入组后，再删原超管才允许 —— 这里先验证「最后一个超管」保护
  r = await call(`/users/${admin.json.data.user.id}`, { method: 'PUT', token: admin.token, body: { group_id: 2 } });
  check('不能修改自己的用户组', r.status === 400, r.json?.message);

  /* 10. 清理测试数据 */
  if (qaId) await call(`/users/${qaId}`, { method: 'DELETE', token: admin.token });
  if (qa2Id) await call(`/users/${qa2Id}`, { method: 'DELETE', token: admin.token });

  /* 11. 注册 */
  r = await call('/auth/register', { method: 'POST', body: { username: 'newbie', password: 'New@12345', email: 'n@iot.local' } });
  check('开放注册成功并归入只读访客', r.status === 201 && r.json?.data?.user?.group_code === 'viewer', r.json?.message);
  const newbieId = r.json?.data?.user?.id;

  r = await call('/auth/register', { method: 'POST', body: { username: 'newbie', password: 'New@12345' } });
  check('重复注册返回 409', r.status === 409, r.json?.message);

  r = await call('/auth/register', { method: 'POST', body: { username: 'x', password: 'weak' } });
  check('非法用户名/弱口令被拒 400', r.status === 400, r.json?.message);

  if (newbieId) await call(`/users/${newbieId}`, { method: 'DELETE', token: admin.token });

  /* 12. 修改密码 */
  r = await call('/auth/password', { method: 'POST', token: viewer.token, body: { old_password: 'bad', new_password: 'New@12345' } });
  check('原密码错误被拒', r.status === 400, r.json?.message);

  console.log('\n==============================');
  const failed = results.filter((x) => !x.pass);
  console.log(`通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log('失败项：');
    failed.forEach((f) => console.log(' -', f.name, f.detail || ''));
    process.exit(1);
  }
})().catch((e) => { console.error('脚本异常', e); process.exit(1); });
