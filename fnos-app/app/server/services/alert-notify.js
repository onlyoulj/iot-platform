/**
 * 告警通知渠道服务
 * ------------------------------------------------------------------
 * 告警生成时（alert-engine createAlert）fire-and-forget 调 notify()，
 * 按渠道类型把告警推送到外部（企业微信/钉钉/飞书/通用 webhook）。
 *
 * 渠道类型（type）：
 *   wecom    企业微信群机器人，POST JSON {msgtype:'markdown', markdown:{content}}
 *   dingtalk 钉钉群机器人，POST JSON {msgtype:'markdown', markdown:{title,text}}，可选加签（secret）
 *   feishu   飞书群机器人，POST JSON {msg_type:'text', content:{text}}
 *   webhook  通用 webhook，POST JSON（body 模板支持占位符）
 *   email    预留（需配 SMTP，本期未接入实际发送，配置后走通用 webhook 接邮件触发服务）
 *
 * 级别过滤：channel.levels 逗号分隔，空=接收所有级别。
 * 失败不阻塞：单个渠道发送异常仅记日志，不影响告警生成与其他渠道。
 */
import db from '../db/init.js';
import crypto from 'node:crypto';

const LEVEL_TEXT = {
  critical: '紧急',
  major: '重要',
  minor: '次要',
  info: '提示',
};

/** 渲染模板占位符 {content}/{level}/{device}/{time}/{product} */
function renderTemplate(tpl, alert) {
  return String(tpl || '')
    .replaceAll('{content}', String(alert.content || ''))
    .replaceAll('{level}', LEVEL_TEXT[alert.level] || alert.level || '')
    .replaceAll('{device}', String(alert.device_name || ''))
    .replaceAll('{product}', String(alert.product_name || ''))
    .replaceAll('{time}', String(alert.created_at || ''));
}

/** 钉钉加签：timestamp + secret → HMAC-SHA256 base64 url-safe */
function dingtalkSign(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64');
  return encodeURIComponent(hmac);
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON 响应 */ }
  // 企微/钉钉/飞书返回 errcode != 0 视为失败
  if (data && (data.errcode || data.code)) {
    const code = data.errcode ?? data.code;
    if (code !== 0) throw new Error(`渠道返回错误 ${code}: ${data.errmsg || data.msg || ''}`);
  }
  return data;
}

/**
 * 向单个渠道发送告警
 */
async function sendToChannel(ch, alert) {
  let cfg = {};
  try { cfg = JSON.parse(ch.config || '{}'); } catch {}
  if (!cfg.webhook_url && ch.type !== 'email') {
    throw new Error('渠道未配置 webhook_url');
  }

  const levelText = LEVEL_TEXT[alert.level] || alert.level;
  const time = alert.created_at || '';

  switch (ch.type) {
    case 'wecom':
      return postJson(cfg.webhook_url, {
        msgtype: 'markdown',
        markdown: {
          content: `### <font color="${alertColor(alert.level)}">${levelText}告警</font>\n${alert.content}\n> 设备：<b>${alert.device_name}</b>\n> 产品：${alert.product_name || '-'}\n> 时间：${time}`,
        },
      });
    case 'dingtalk': {
      const url = cfg.secret
        ? `${cfg.webhook_url}&timestamp=${Date.now()}&sign=${dingtalkSign(cfg.secret, Date.now())}`
        : cfg.webhook_url;
      return postJson(url, {
        msgtype: 'markdown',
        markdown: {
          title: `${levelText}告警`,
          text: `#### ${levelText}告警\n\n${alert.content}\n\n- 设备：${alert.device_name}\n- 产品：${alert.product_name || '-'}\n- 时间：${time}`,
        },
      });
    }
    case 'feishu':
      return postJson(cfg.webhook_url, {
        msg_type: 'interactive',
        card: {
          header: { title: { tag: 'plain_text', content: `${levelText}告警` } },
          elements: [
            { tag: 'div', text: { tag: 'lark_md', content: `**${alert.content}**` } },
            { tag: 'div', text: { tag: 'lark_md', content: `设备：${alert.device_name}｜产品：${alert.product_name || '-'}｜时间：${time}` } },
          ],
        },
      });
    case 'webhook': {
      const body = cfg.body_template
        ? JSON.parse(renderTemplate(cfg.body_template, alert))
        : {
            level: alert.level,
            content: alert.content,
            device: alert.device_name,
            product: alert.product_name,
            time,
          };
      return postJson(cfg.webhook_url, body);
    }
    case 'email':
      // 预留：需 SMTP 配置，本期未接入实际发送
      throw new Error('邮件渠道暂未接入 SMTP，请改用通用 webhook 接邮件触发服务');
    default:
      throw new Error(`未知渠道类型：${ch.type}`);
  }
}

function alertColor(level) {
  return { critical: 'info', major: 'warning', minor: 'comment', info: 'info' }[level] || 'comment';
}

/**
 * 通知所有启用的、级别匹配的渠道
 * @param {object} alert alerts 表记录（含 level/content/device_name/product_name/created_at）
 * @returns {Promise<{sent:number, failed:number}>}
 */
export async function notify(alert) {
  const channels = db.prepare('SELECT * FROM alert_channels WHERE enabled = 1').all();
  let sent = 0;
  let failed = 0;
  for (const ch of channels) {
    if (ch.levels) {
      const levels = ch.levels.split(',').map((s) => s.trim()).filter(Boolean);
      if (levels.length && !levels.includes(alert.level)) continue;
    }
    try {
      await sendToChannel(ch, alert);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.warn(`[alert-notify] 渠道「${ch.name}」(${ch.type}) 发送失败:`, err.message);
    }
  }
  return { sent, failed };
}

/**
 * 发送测试消息到指定渠道（前端测试按钮调用，验证配置是否正确）
 */
export async function testChannel(channelId) {
  const ch = db.prepare('SELECT * FROM alert_channels WHERE id = ?').get(channelId);
  if (!ch) throw new Error('渠道不存在');
  const fakeAlert = {
    level: 'info',
    content: `这是一条来自渠道「${ch.name}」的测试告警消息`,
    device_name: 'test-device',
    product_name: '测试产品',
    created_at: new Date().toLocaleString('zh-CN', { hour12: false }),
  };
  await sendToChannel(ch, fakeAlert);
  return { ok: true };
}

/** 渠道类型字典（供前端枚举） */
export const CHANNEL_TYPES = ['wecom', 'dingtalk', 'feishu', 'webhook', 'email'];
