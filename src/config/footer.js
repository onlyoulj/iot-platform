/**
 * 全局页脚信息
 * ------------------------------------------------------------------
 * 构建时由 vite.config.js 从 server/config.json（FOOTER_TEXT / FOOTER_COMPANY /
 * FOOTER_ICP / FOOTER_CONTACT）读取并注入 __APP_FOOTER__，前端同步渲染、零请求。
 * 修改页脚：编辑 server/config.json 后重启 dev server / 重新构建生效。
 */
const FALLBACK = { text: '© 2026 IoT 物联网管理平台', company: '', icp: '', contact: '' }

export const APP_FOOTER = typeof __APP_FOOTER__ !== 'undefined' ? __APP_FOOTER__ : FALLBACK
