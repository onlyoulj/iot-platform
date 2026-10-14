# -*- coding: utf-8 -*-
"""
IoT 平台技术汇报 PPT 生成（python-pptx）
16:9 宽屏，浅色商务风格，内嵌 3 张算法流程图
"""
import os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "IoT平台技术汇报.pptx")

# ---- 配色（light 商务风）----
BLUE = RGBColor(0x2B, 0x7D, 0xE9)      # 主色
DARK = RGBColor(0x1F, 0x2D, 0x3D)      # 深色文字
GRAY = RGBColor(0x5E, 0x6C, 0x84)      # 次级文字
LIGHT_BG = RGBColor(0xF3, 0xF6, 0xFC)  # 卡片底
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
GREEN = RGBColor(0x1D, 0x9E, 0x6E)
ORANGE = RGBColor(0xE8, 0xA3, 0x17)

FONT = "微软雅黑"

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]


def add_slide():
    return prs.slides.add_slide(BLANK)


def set_text(tf, lines, size=18, color=DARK, bold=False, align=PP_ALIGN.LEFT,
             space_after=6, line_spacing=1.15):
    """lines: [(text, size, color, bold), ...] 或纯文本"""
    tf.word_wrap = True
    first = True
    for item in lines:
        if isinstance(item, tuple):
            text, sz, col, bd = item
        else:
            text, sz, col, bd = item, size, color, bold
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.alignment = align
        p.space_after = Pt(space_after)
        p.line_spacing = line_spacing
        run = p.add_run()
        run.text = text
        run.font.size = Pt(sz)
        run.font.color.rgb = col
        run.font.bold = bd
        run.font.name = FONT
        run.font._rPr.set("{http://schemas.openxmlformats.org/drawingml/2006/main}eastAsia", FONT)


def add_box(slide, x, y, w, h, fill=LIGHT_BG, line=None, radius=None):
    from pptx.enum.shapes import MSO_SHAPE
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                   Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    if line:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
    else:
        shape.line.fill.background()
    try:
        shape.adjustments[0] = 0.08
    except Exception:
        pass
    shape.shadow.inherit = False
    return shape


def slide_title(slide, title, subtitle=None, page=None):
    # 顶部色带
    bar = add_box(slide, 0, 0, 13.333, 0.12, fill=BLUE)
    tf = slide.shapes.add_textbox(Inches(0.6), Inches(0.32),
                                  Inches(11), Inches(0.8)).text_frame
    set_text(tf, [(title, 30, DARK, True)])
    if subtitle:
        tf2 = slide.shapes.add_textbox(Inches(0.62), Inches(1.02),
                                       Inches(11.5), Inches(0.45)).text_frame
        set_text(tf2, [(subtitle, 14, GRAY, False)])
    if page is not None:
        tf3 = slide.shapes.add_textbox(Inches(12.4), Inches(7.0),
                                       Inches(0.7), Inches(0.4)).text_frame
        set_text(tf3, [(str(page), 12, GRAY, False)], align=PP_ALIGN.RIGHT)
    return bar


def add_image_fit(slide, path, x, y, max_w, max_h):
    """按比例缩放放入指定区域，水平居中"""
    with Image.open(path) as im:
        iw, ih = im.size
    ratio = min(max_w / iw, max_h / ih)
    w, h = iw * ratio, ih * ratio
    slide.shapes.add_picture(path, Inches(x + (max_w - w) / 2),
                             Inches(y), Inches(w), Inches(h))


# ================= 封面 =================
s = add_slide()
add_box(s, 0, 0, 13.333, 7.5, fill=WHITE)
add_box(s, 0, 0, 13.333, 0.35, fill=BLUE)
add_box(s, 0, 7.15, 13.333, 0.35, fill=BLUE)
tf = s.shapes.add_textbox(Inches(1.2), Inches(2.3), Inches(11), Inches(1.4)).text_frame
set_text(tf, [("IoT 设备管理平台", 48, DARK, True)], align=PP_ALIGN.CENTER)
tf2 = s.shapes.add_textbox(Inches(1.2), Inches(3.6), Inches(11), Inches(0.8)).text_frame
set_text(tf2, [("技术方案汇报 ｜ 项目交付", 24, BLUE, False)], align=PP_ALIGN.CENTER)
tf3 = s.shapes.add_textbox(Inches(1.2), Inches(5.6), Inches(11), Inches(0.6)).text_frame
set_text(tf3, [("2026 年 10 月", 16, GRAY, False)], align=PP_ALIGN.CENTER)

# ================= 目录 =================
s = add_slide()
slide_title(s, "目录", page=1)
toc = [
    ("01", "项目概述与建设目标", "轻量可私有化部署的 IoT 设备管理平台"),
    ("02", "总体架构设计", "前后端分离 · 三层后端 · 双轨鉴权"),
    ("03", "核心算法一：设备订阅与激活", "一次成功订阅 = 一次在线心跳"),
    ("04", "核心算法二：OTA 升级全链路", "SSE 主动推送 + 订阅轮询补推"),
    ("05", "核心算法三：RBAC 权限校验", "无状态 token + 实时权限查询"),
    ("06", "安全设计与多实例扩展", "PBKDF2 · 提权防护 · Redis 可选降级"),
    ("07", "部署运维与交付清单", "一键启停 · 环境变量 · 生产建议"),
]
y = 1.75
for num, t, d in toc:
    add_box(s, 0.8, y, 11.7, 0.68, fill=LIGHT_BG)
    tf = s.shapes.add_textbox(Inches(1.1), y + 0.1, Inches(0.9), Inches(0.5)).text_frame
    set_text(tf, [(num, 20, BLUE, True)])
    tf = s.shapes.add_textbox(Inches(2.1), y + 0.08, Inches(5.6), Inches(0.5)).text_frame
    set_text(tf, [(t, 17, DARK, True)])
    tf = s.shapes.add_textbox(Inches(7.6), y + 0.12, Inches(4.8), Inches(0.5)).text_frame
    set_text(tf, [(d, 12.5, GRAY, False)])
    y += 0.78

# ================= 1 项目概述 =================
s = add_slide()
slide_title(s, "01  项目概述与建设目标", page=2)
tf = s.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(11.8), Inches(0.7)).text_frame
set_text(tf, [("面向物联网设备规模增长带来的固件版本管理、远程升级（OTA）与状态监控痛点，"
               "提供一套轻量、可私有化部署的 IoT 设备管理平台。", 15, GRAY, False)])
cards = [
    ("设备全生命周期", "产品 → 设备 → 固件 → 升级 → 告警\n一站式业务闭环", BLUE),
    ("低成本设备接入", "设备仅需一个 HTTP 订阅接口\n激活/保活/固件拉取全完成", GREEN),
    ("可靠 OTA 升级", "SSE 主动推送 + 订阅轮询补推\n离线设备上线自动续推", ORANGE),
    ("精细化权限控制", "无状态 token + RBAC\n18 个权限点覆盖全模块", BLUE),
    ("多实例可扩展", "可选接入 Redis\nSSE 推送/在线统计/配置共享", GREEN),
    ("私有化部署", "SQLite 单文件 + Node.js\n一键启停脚本", ORANGE),
]
x0, y0, cw, ch, gap = 0.8, 2.45, 3.85, 2.1, 0.15
for i, (t, d, c) in enumerate(cards):
    r, col = divmod(i, 3)
    x = x0 + col * (cw + gap)
    y = y0 + r * (ch + 0.25)
    add_box(s, x, y, cw, ch, fill=LIGHT_BG, line=c)
    tf = s.shapes.add_textbox(Inches(x + 0.25), Inches(y + 0.25),
                              Inches(cw - 0.5), Inches(0.6)).text_frame
    set_text(tf, [(t, 17, c, True)])
    tf = s.shapes.add_textbox(Inches(x + 0.25), Inches(y + 0.9),
                              Inches(cw - 0.5), Inches(1.1)).text_frame
    set_text(tf, [(d, 12.5, DARK, False)], line_spacing=1.3)

# ================= 2 技术栈与架构 =================
s = add_slide()
slide_title(s, "02  总体架构与技术栈", "前后端分离单仓库 · 后端三层（路由 → 服务 → 数据）", page=3)
# 左：技术栈
add_box(s, 0.8, 1.7, 5.8, 5.2, fill=LIGHT_BG)
tf = s.shapes.add_textbox(Inches(1.05), Inches(1.9), Inches(5.3), Inches(0.5)).text_frame
set_text(tf, [("技术栈", 18, BLUE, True)])
stack = [
    ("前端", "Vue 3.4 + Vite 5 + Element Plus 2.9 + ECharts 5（端口 5173）"),
    ("后端", "Express 4 + better-sqlite3 11（WAL 模式，端口 3000，全程 ES Modules）"),
    ("可选", "Redis 4.7（双连接，优雅降级，多实例扩展）"),
    ("存储", "SQLite 单文件 iot.db + uploads/firmware 固件文件"),
    ("安全", "Node 内置 crypto：HMAC 签名 / PBKDF2 口令 / timingSafeEqual"),
]
lines = []
for t, d in stack:
    lines.append((f"【{t}】{d}", 13, DARK, False))
    lines.append(("", 6, DARK, False))
tf = s.shapes.add_textbox(Inches(1.05), Inches(2.45), Inches(5.35), Inches(4.3)).text_frame
set_text(tf, lines, line_spacing=1.25)
# 右：分层
add_box(s, 6.9, 1.7, 5.6, 5.2, fill=WHITE, line=BLUE)
layers = [
    ("接入层", "管理端 SPA（Bearer token）｜ 设备固件（订阅 HMAC token）", BLUE),
    ("路由层", "14 组管理端业务路由 + subscribe.js 设备侧独立鉴权路由", GREEN),
    ("服务层", "auth 鉴权 · push(SSE) · redis · config-store · api-logger · device-monitor", ORANGE),
    ("数据层", "SQLite 单例（WAL+外键）· 13 张表 · init 建表种子 · auth-schema 权限", BLUE),
]
ly = 1.95
for t, d, c in layers:
    add_box(s, 7.15, ly, 5.1, 1.05, fill=LIGHT_BG, line=c)
    tf = s.shapes.add_textbox(Inches(7.35), Inches(ly + 0.1), Inches(4.7), Inches(0.4)).text_frame
    set_text(tf, [(t, 14, c, True)])
    tf = s.shapes.add_textbox(Inches(7.35), Inches(ly + 0.5), Inches(4.75), Inches(0.5)).text_frame
    set_text(tf, [(d, 11, DARK, False)])
    ly += 1.22

# ================= 3 算法一：订阅鉴权（流程图） =================
s = add_slide()
slide_title(s, "03  核心算法一：设备订阅与激活鉴权",
            "HMAC 凭证校验 → 零副作用心跳 → 固件下发 → 积压任务补推", page=4)
add_image_fit(s, os.path.join(BASE, "flow1-subscribe.png"), 4.1, 1.55, 5.2, 5.8)
# 左侧要点
points = [
    "派生式凭证：HMAC-SHA256(SECRET, 'device:'+id) 前 16 位，服务端零存储",
    "恒定时间比较，防时序侧信道",
    "心跳必须在校验之后：403/404 零副作用",
    "状态机：inactive/offline → online\nfault 保持，不掩盖故障",
    "active_time 仅首次激活写入\nlast_online 每次订阅刷新",
]
py = 1.75
for p in points:
    add_box(s, 0.7, py, 3.2, 0.92, fill=LIGHT_BG)
    tf = s.shapes.add_textbox(Inches(0.85), Inches(py + 0.08),
                              Inches(2.95), Inches(0.8)).text_frame
    set_text(tf, [(p, 11, DARK, False)], line_spacing=1.15)
    py += 1.03

# ================= 4 算法二：OTA 全链路（流程图） =================
s = add_slide()
slide_title(s, "04  核心算法二：OTA 升级任务全链路",
            "任务创建 → 两层推送 → 结果上报 → 统计重算 → 自动完成", page=5)
add_image_fit(s, os.path.join(BASE, "flow2-ota.png"), 3.6, 1.5, 6.1, 5.85)
points = [
    "两层互补推送：SSE 秒级触达在线设备，订阅轮询补推离线设备",
    "total 由服务端按实际设备数写，防前端伪造",
    "上报 success 自动更新设备固件版本\nfailed 自动建 major 告警 + 去重记录",
    "统计从 job 聚合重算，不增量计数\ndone+failed≥total 自动 completed",
]
py = 1.8
for p in points:
    add_box(s, 0.65, py, 2.85, 1.15, fill=LIGHT_BG)
    tf = s.shapes.add_textbox(Inches(0.8), Inches(py + 0.1),
                              Inches(2.6), Inches(1.0)).text_frame
    set_text(tf, [(p, 10.5, DARK, False)], line_spacing=1.15)
    py += 1.28

# ================= 5 算法三：RBAC（流程图） =================
s = add_slide()
slide_title(s, "05  核心算法三：RBAC 权限校验",
            "无状态 token 解析 → 实时查权限 → 权限点匹配 → 提权防护", page=6)
add_image_fit(s, os.path.join(BASE, "flow3-rbac.png"), 3.4, 1.5, 6.4, 5.85)
points = [
    "token 只含 uid/iat/exp\n不含权限 → 改组立即生效",
    "中间件三件套：authenticate\n/ optionalAuth / requirePermission",
    "提权防护：防自锁 + 防失管\n保护最后一个可用超管",
    "PBKDF2 12 万次迭代 + 独立盐\n恒定时间比较防时序攻击",
]
py = 1.8
for p in points:
    add_box(s, 0.65, py, 2.7, 1.15, fill=LIGHT_BG)
    tf = s.shapes.add_textbox(Inches(0.8), Inches(py + 0.1),
                              Inches(2.45), Inches(1.0)).text_frame
    set_text(tf, [(p, 10.5, DARK, False)], line_spacing=1.15)
    py += 1.28

# ================= 6 安全设计 =================
s = add_slide()
slide_title(s, "06  安全设计与多实例扩展", page=7)
# 左：双轨鉴权
add_box(s, 0.8, 1.7, 5.9, 2.5, fill=LIGHT_BG, line=BLUE)
tf = s.shapes.add_textbox(Inches(1.05), Inches(1.85), Inches(5.4), Inches(0.5)).text_frame
set_text(tf, [("双轨鉴权体系（完全隔离）", 16, BLUE, True)])
rows = [
    ("管理端", "无状态会话 token（uid/iat/exp，7 天）· Bearer 优先 ?token= 兜底"),
    ("设备侧", "HMAC 派生 token · 独立密钥可单独轮换 · 真实 HTTP 状态码"),
    ("口令", "PBKDF2-HMAC-SHA256 12 万次迭代 + 16 字节独立盐 + 恒定时间比较"),
]
ly = 2.4
for t, d in rows:
    tf = s.shapes.add_textbox(Inches(1.05), Inches(ly), Inches(5.5), Inches(0.55)).text_frame
    set_text(tf, [(f"【{t}】{d}", 11.5, DARK, False)], line_spacing=1.15)
    ly += 0.58
# 右：Redis
add_box(s, 7.0, 1.7, 5.5, 2.5, fill=LIGHT_BG, line=GREEN)
tf = s.shapes.add_textbox(Inches(7.25), Inches(1.85), Inches(5.0), Inches(0.5)).text_frame
set_text(tf, [("Redis：可选 + 全降级", 16, GREEN, True)])
redis_rows = [
    "五个场景：SSE 多实例推送 / 在线缓存 / API 计数 / 配置共享 / 分布式锁",
    "连接失败自动降级，不阻塞启动；10s 健康检查，恢复自动升格",
    "双连接架构：命令连接 + 订阅连接",
]
lines = [(t, 11.5, DARK, False) for t in redis_rows]
tf = s.shapes.add_textbox(Inches(7.25), Inches(2.4), Inches(5.05), Inches(1.7)).text_frame
set_text(tf, lines, line_spacing=1.2, space_after=8)
# 下：提权防护矩阵
add_box(s, 0.8, 4.5, 11.7, 2.5, fill=WHITE, line=ORANGE)
tf = s.shapes.add_textbox(Inches(1.05), Inches(4.65), Inches(11), Inches(0.5)).text_frame
set_text(tf, [("提权防护矩阵（写操作额外校验）", 16, ORANGE, True)])
prot = [
    "仅超管可分配 super_admin 组",
    "不能修改自己的用户组 / 禁用自己 / 删除自己（防自锁）",
    "保护最后一个可用超管（防失管）",
    "非超管不能修改超管资料",
    "非超管不能授予 user:manage / group:manage",
    "内置组不可删除 · super_admin 权限不可修改 · 有成员的组不可删除",
]
# 两列排布
for i, p in enumerate(prot):
    r, c = divmod(i, 2)
    tf = s.shapes.add_textbox(Inches(1.05 + c * 5.8), Inches(5.25 + r * 0.55),
                              Inches(5.6), Inches(0.5)).text_frame
    set_text(tf, [("• " + p, 12.5, DARK, False)])

# ================= 7 部署运维 =================
s = add_slide()
slide_title(s, "07  部署运维与交付清单", page=8)
# 左：一键启动
add_box(s, 0.8, 1.7, 5.9, 2.9, fill=LIGHT_BG, line=BLUE)
tf = s.shapes.add_textbox(Inches(1.05), Inches(1.85), Inches(5.4), Inches(0.5)).text_frame
set_text(tf, [("一键启停", 16, BLUE, True)])
steps = [
    "npm start / npm run stop / start.bat（Windows 双击）",
    "依赖检查 → Node 运行时探测（better-sqlite3 ABI 匹配）→ 端口清理 → 并行启动 → 健康检查",
    "参数：--api-port / --watch / --backend-only / --no-kill 等",
]
lines = [(t, 11.5, DARK, False) for t in steps]
tf = s.shapes.add_textbox(Inches(1.05), Inches(2.4), Inches(5.5), Inches(2.0)).text_frame
set_text(tf, lines, line_spacing=1.25, space_after=10)
# 右：生产建议
add_box(s, 7.0, 1.7, 5.5, 2.9, fill=LIGHT_BG, line=GREEN)
tf = s.shapes.add_textbox(Inches(7.25), Inches(1.85), Inches(5.0), Inches(0.5)).text_frame
set_text(tf, [("生产部署建议", 16, GREEN, True)])
prod = [
    "必须覆盖 AUTH_SECRET / SUBSCRIBE_SECRET（默认值等同无防护）",
    "Nginx 反代需配置 SUBSCRIBE_BASE_URL；SSE 已内置关闭缓冲",
    "多实例部署接入 Redis；token 无状态，实例间无会话依赖",
    "定期备份 iot.db（VACUUM INTO 或文件冷备）",
]
lines = [("• " + t, 11.5, DARK, False) for t in prod]
tf = s.shapes.add_textbox(Inches(7.25), Inches(2.4), Inches(5.05), Inches(2.0)).text_frame
set_text(tf, lines, line_spacing=1.2, space_after=8)
# 下：交付物
add_box(s, 0.8, 4.85, 11.7, 2.1, fill=WHITE, line=ORANGE)
tf = s.shapes.add_textbox(Inches(1.05), Inches(5.0), Inches(11), Inches(0.5)).text_frame
set_text(tf, [("交付物清单", 16, ORANGE, True)])
deliv = [
    ("前端工程", "Vue 3 + Vite（仓库根目录）"),
    ("后端工程", "server/（Express 4 + SQLite）"),
    ("技术文档", "docs/tech-doc/（30+ 页 DOCX + Markdown 源）"),
    ("流程图", "flow1-subscribe / flow2-ota / flow3-rbac PNG"),
    ("汇报演示", "IoT平台技术汇报.pptx（本文件）"),
]
for i, (t, d) in enumerate(deliv):
    r, c = divmod(i, 3)
    tf = s.shapes.add_textbox(Inches(1.05 + c * 3.85), Inches(5.6 + r * 0.62),
                              Inches(3.7), Inches(0.55)).text_frame
    set_text(tf, [(f"【{t}】{d}", 11.5, DARK, False)])

# ================= 结束页 =================
s = add_slide()
add_box(s, 0, 0, 13.333, 7.5, fill=WHITE)
add_box(s, 0, 0, 13.333, 0.35, fill=BLUE)
add_box(s, 0, 7.15, 13.333, 0.35, fill=BLUE)
tf = s.shapes.add_textbox(Inches(1.2), Inches(2.9), Inches(11), Inches(1.2)).text_frame
set_text(tf, [("谢谢观看", 44, DARK, True)], align=PP_ALIGN.CENTER)
tf2 = s.shapes.add_textbox(Inches(1.2), Inches(4.2), Inches(11), Inches(0.7)).text_frame
set_text(tf2, [("IoT 设备管理平台 ｜ 技术方案汇报", 18, GRAY, False)], align=PP_ALIGN.CENTER)

prs.save(OUT)
print("saved:", OUT)