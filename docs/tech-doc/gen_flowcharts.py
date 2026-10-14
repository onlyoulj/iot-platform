# -*- coding: utf-8 -*-
"""
IoT 平台核心算法流程图绘制（v2：动态行高 + 按词换行 + 菱形加大）
输出 3 张高清 PNG，供 DOCX / PPTX 内嵌：
  1. 设备订阅与激活鉴权流程
  2. OTA 升级任务全链路
  3. RBAC 权限校验流程
"""
import os
import re
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
FONT_PATH = "C:/Windows/Fonts/msyh.ttc"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"

# ---- 配色（light theme）----
C_BG = "#FFFFFF"
C_TEXT = "#1F2D3D"
C_LINE = "#8B96A8"
C_TERMINAL_FILL = "#E8F1FB"
C_TERMINAL_BORDER = "#2B7DE9"
C_PROCESS_FILL = "#F3F6FC"
C_PROCESS_BORDER = "#5B6AC4"
C_DECISION_FILL = "#FFF6E6"
C_DECISION_BORDER = "#E8A317"
C_ERROR_FILL = "#FDECEC"
C_ERROR_BORDER = "#D9534F"
C_SUCCESS_FILL = "#EAFBF1"
C_SUCCESS_BORDER = "#1D9E6E"
C_SIDE_FILL = "#F5F3FF"
C_SIDE_BORDER = "#7C6FB0"
C_TITLE = "#2B3A55"

MARGIN_X = 70
MARGIN_TOP = 130
COL_W = 360
ROW_GAP = 42          # 行与行之间的空隙
NODE_W = 300
FP_NODE = 21
FP_LABEL = 17
FP_TITLE = 30
FP_SUB = 17
LINE_H = 32

STYLE_FILL = {
    "terminal": C_TERMINAL_FILL, "process": C_PROCESS_FILL,
    "decision": C_DECISION_FILL, "error": C_ERROR_FILL,
    "success": C_SUCCESS_FILL, "side": C_SIDE_FILL,
}
STYLE_BORDER = {
    "terminal": C_TERMINAL_BORDER, "process": C_PROCESS_BORDER,
    "decision": C_DECISION_BORDER, "error": C_ERROR_BORDER,
    "success": C_SUCCESS_BORDER, "side": C_SIDE_BORDER,
}


def font(size, bold=False):
    path = FONT_BOLD if bold and os.path.exists(FONT_BOLD) else FONT_PATH
    return ImageFont.truetype(path, size)


def text_size(draw, text, fnt):
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def tokenize(raw):
    """中英文混排分词：连续英数/./-/_ 为一个词，其他逐字"""
    return re.findall(r"[A-Za-z0-9_./:%&'()+\-]+|\S", raw)


def wrap_text(draw, text, fnt, max_w):
    """按词换行（英文单词不拆断），尊重显式 \n"""
    lines = []
    for raw in text.split("\n"):
        if not raw:
            lines.append("")
            continue
        cur = ""
        for tok in tokenize(raw):
            test = cur + tok
            if text_size(draw, test, fnt)[0] <= max_w or not cur:
                cur = test
            else:
                lines.append(cur)
                cur = tok
        lines.append(cur)
    return lines


class Canvas:
    def __init__(self, title, subtitle, cols):
        self.title = title
        self.subtitle = subtitle
        self.cols = cols
        self.nodes = {}
        self.edges = []
        self.row_heights = {}   # row -> 像素高度

    def add_node(self, nid, text, ntype, row, col, w=NODE_W):
        self.nodes[nid] = {"text": text, "type": ntype,
                           "row": row, "col": col, "w": w}

    def add_edge(self, frm, to, label=None, fp="bottom", tp="top", color=None):
        self.edges.append({"f": frm, "t": to, "label": label,
                           "fp": fp, "tp": tp, "color": color})

    def _layout(self, draw):
        # 计算每个节点的行数与高度
        for nid, n in self.nodes.items():
            fnt = font(FP_NODE)
            lines = wrap_text(draw, n["text"], fnt, n["w"] - 40)
            n["_lines"] = lines
            text_h = len(lines) * LINE_H
            if n["type"] == "decision":
                # 菱形需要更大空间
                n["_h"] = int(max(text_h * 2.1, 110))
            elif n["type"] == "terminal":
                n["_h"] = text_h + 46
            else:
                n["_h"] = text_h + 38
        # 每行高度 = 该行最大节点高
        self.row_heights = {}
        for n in self.nodes.values():
            self.row_heights[n["row"]] = max(
                self.row_heights.get(n["row"], 0), n["_h"])
        # 每行 y 中心
        self.row_y = {}
        y = MARGIN_TOP
        for row in sorted(self.row_heights):
            self.row_y[row] = y + self.row_heights[row] // 2
            y += self.row_heights[row] + ROW_GAP
        self.height = int(y - ROW_GAP + 70)

    def _node_center(self, nid):
        n = self.nodes[nid]
        cx = MARGIN_X + n["col"] * COL_W + COL_W // 2
        return cx, self.row_y[n["row"]]

    def render(self, out_path):
        w, h = MARGIN_X * 2 + self.cols * COL_W, 100
        img = Image.new("RGB", (w, 100), C_BG)   # 临时量文字
        draw = ImageDraw.Draw(img)
        self._layout(draw)
        W = MARGIN_X * 2 + self.cols * COL_W
        img = Image.new("RGB", (W, self.height), C_BG)
        draw = ImageDraw.Draw(img)
        # 标题
        fnt_t = font(FP_TITLE, bold=True)
        draw.text((MARGIN_X, 40), self.title, font=fnt_t, fill=C_TITLE)
        if self.subtitle:
            fnt_s = font(FP_SUB)
            draw.text((MARGIN_X, 86), self.subtitle, font=fnt_s, fill="#5E6C84")
        for e in self.edges:
            self._draw_edge(draw, e)
        for nid, n in self.nodes.items():
            self._draw_node(draw, nid, n)
        img.save(out_path, "PNG")
        print("saved:", out_path, f"{W}x{self.height}")

    def _port(self, nid, port):
        cx, cy = self._node_center(nid)
        n = self.nodes[nid]
        h, w = n["_h"], n["w"]
        return {
            "top": (cx, cy - h // 2),
            "bottom": (cx, cy + h // 2),
            "left": (cx - w // 2, cy),
            "right": (cx + w // 2, cy),
        }[port]

    def _draw_edge(self, draw, e):
        p1 = self._port(e["f"], e["fp"])
        p2 = self._port(e["t"], e["tp"])
        col = e["color"] or C_LINE
        if e["fp"] in ("bottom", "top") and e["tp"] in ("top", "bottom"):
            midy = (p1[1] + p2[1]) // 2
            self._polyline(draw, [p1, (p1[0], midy), (p2[0], midy), p2], col)
        elif e["fp"] == "right" and e["tp"] == "left":
            midx = (p1[0] + p2[0]) // 2
            self._polyline(draw, [p1, (midx, p1[1]), (midx, p2[1]), p2], col)
        elif e["fp"] == "bottom" and e["tp"] == "left":
            self._polyline(draw, [p1, (p1[0], p2[1] - 14), p2], col)
        elif e["fp"] == "left" and e["tp"] == "left":
            midx = min(p1[0], p2[0]) - 36
            self._polyline(draw, [p1, (midx, p1[1]), (midx, p2[1]), p2], col)
        elif e["fp"] == "right" and e["tp"] == "right":
            midx = max(p1[0], p2[0]) + 36
            self._polyline(draw, [p1, (midx, p1[1]), (midx, p2[1]), p2], col)
        else:
            self._polyline(draw, [p1, p2], col)
        self._arrow(draw, p2, e["tp"], col)
        if e["label"]:
            fnt = font(FP_LABEL)
            tx = (p1[0] + p2[0]) // 2
            ty = (p1[1] + p2[1]) // 2 - 14
            tw, th = text_size(draw, e["label"], fnt)
            draw.rectangle([tx - tw // 2 - 6, ty - th // 2 - 3,
                            tx + tw // 2 + 6, ty + th // 2 + 3],
                           fill="#FFFFFF", outline=col, width=1)
            draw.text((tx - tw // 2, ty - th // 2), e["label"],
                      font=fnt, fill=col)

    def _polyline(self, draw, pts, col):
        for i in range(len(pts) - 1):
            draw.line([pts[i], pts[i + 1]], fill=col, width=2)

    def _arrow(self, draw, tip, port, col):
        if port == "top":
            pts = [tip, (tip[0] - 7, tip[1] - 12), (tip[0] + 7, tip[1] - 12)]
        elif port == "bottom":
            pts = [tip, (tip[0] - 7, tip[1] + 12), (tip[0] + 7, tip[1] + 12)]
        elif port == "left":
            pts = [tip, (tip[0] - 12, tip[1] - 7), (tip[0] - 12, tip[1] + 7)]
        else:
            pts = [tip, (tip[0] + 12, tip[1] - 7), (tip[0] + 12, tip[1] + 7)]
        draw.polygon(pts, fill=col)

    def _draw_node(self, draw, nid, n):
        cx, cy = self._node_center(nid)
        h, w = n["_h"], n["w"]
        x0, y0 = cx - w // 2, cy - h // 2
        x1, y1 = cx + w // 2, cy + h // 2
        fill = STYLE_FILL[n["type"]]
        border = STYLE_BORDER[n["type"]]
        if n["type"] == "decision":
            draw.polygon([(cx, y0), (x1, cy), (cx, y1), (x0, cy)],
                         fill=fill, outline=border, width=2)
        elif n["type"] == "terminal":
            draw.rounded_rectangle([x0, y0, x1, y1], radius=min(38, h // 2),
                                   fill=fill, outline=border, width=2)
        else:
            draw.rounded_rectangle([x0, y0, x1, y1], radius=12,
                                   fill=fill, outline=border, width=2)
        fnt = font(FP_NODE)
        lines = n["_lines"]
        total_h = len(lines) * LINE_H
        ty = cy - total_h // 2
        for line in lines:
            tw, _ = text_size(draw, line, fnt)
            draw.text((cx - tw // 2, ty), line, font=fnt, fill=C_TEXT)
            ty += LINE_H


def chart1_subscribe():
    c = Canvas("图 1  设备订阅与激活鉴权流程",
               "HMAC 凭证校验 → 零副作用心跳 → 固件下发 → 积压任务补推", cols=2)
    c.add_node("n0", "设备发起订阅请求\nGET /api/subscribe/:key?token=xxx", "terminal", 0, 0)
    c.add_node("n1", "定位设备 findDevice(key)\n纯数字 → 按 ID 查\n否则 → 按 DeviceName(SN) 查", "decision", 1, 0)
    c.add_node("e1", "404 设备不存在", "error", 1, 1, w=230)
    c.add_node("n2", "校验凭证 verifyToken\nHMAC-SHA256(SECRET,'device:'+id)\n取前 16 位 · 恒定时间比较", "decision", 2, 0)
    c.add_node("e2", "403 凭证无效\n零副作用：不写任何状态", "error", 2, 1, w=230)
    c.add_node("n3", "记录心跳 touchDeviceOnline（仅鉴权通过后执行）\n状态机：inactive/offline → online（首次激活写 active_time）\nonline → online 仅刷新 last_online · fault → fault 保持不掩盖\n非环回 IP 才更新 · Redis 心跳缓存 TTL 300s", "process", 3, 0, w=340)
    c.add_node("n4", "findLatestFirmware：published 中取版本最高者\ncompareVersion 去 v 前缀逐段比较（高版本不降级）\ndeliverPendingUpgrades：补推 running 任务的积压 job", "process", 4, 0, w=340)
    c.add_node("n5", "返回订阅信息\ndevice / update_available / pending_upgrades\nlatest / available_versions / compat", "terminal", 5, 0, w=340)
    c.add_edge("n0", "n1")
    c.add_edge("n1", "e1", label="否", fp="right", tp="left")
    c.add_edge("n1", "n2", label="是")
    c.add_edge("n2", "e2", label="否", fp="right", tp="left")
    c.add_edge("n2", "n3", label="是")
    c.add_edge("n3", "n4")
    c.add_edge("n4", "n5")
    c.render(os.path.join(OUT_DIR, "flow1-subscribe.png"))


def chart2_ota():
    c = Canvas("图 2  OTA 升级任务全链路",
               "任务创建 → 两层推送（SSE 主动 + 订阅补推）→ 结果上报 → 统计重算 → 自动完成",
               cols=3)
    c.add_node("n0", "管理端创建升级任务 POST /api/ota（ota:manage）\nresolveTargetDevices（device_names 可选灰度）\ntotal 由服务端按实际设备数写入", "process", 0, 1)
    c.add_node("n1", "strategy\n= immediate ?", "decision", 1, 1)
    c.add_node("a1", "status=running\n立即推送", "process", 2, 0, w=250)
    c.add_node("a2", "status=pending\n等待计划时间触发", "process", 2, 2, w=250)
    c.add_node("n2", "第一层：SSE 主动推送 emit('upgrade')\n设备在线且有连接 → 标记 pushing（秒级触达）", "process", 3, 1)
    c.add_node("n3", "第二层：订阅轮询补推 deliverPendingUpgrades\n离线设备上线自动补推 → pushing（指令不丢）", "process", 4, 1)
    c.add_node("n4", "设备执行升级\nPOST /:key/report 上报结果", "process", 5, 1)
    c.add_node("n5", "report\nstatus ?", "decision", 6, 1)
    c.add_node("b1", "upgrading\n更新 progress\n与 acked_at", "process", 7, 0, w=250)
    c.add_node("b2", "success\n更新 devices\n.firmware_version", "success", 7, 1, w=250)
    c.add_node("b3", "failed\n记 ota_fail_devices\n创建 major 告警", "error", 7, 2, w=250)
    c.add_node("n6", "recomputeTaskStats：从 job 聚合重算统计\ndone / running / failed 不做增量计数，杜绝错位", "process", 8, 1)
    c.add_node("n7", "done+failed ≥ total\n且 task = running ?", "decision", 9, 1)
    c.add_node("n8", "自动置为 completed\n任务结束", "success", 9, 2, w=240)
    c.add_edge("n0", "n1")
    c.add_edge("n1", "a1", label="是", fp="left", tp="left")
    c.add_edge("n1", "a2", label="否", fp="right", tp="right")
    c.add_edge("a1", "n2", fp="bottom", tp="left")
    c.add_edge("a2", "n2", fp="bottom", tp="right")
    c.add_edge("n2", "n3")
    c.add_edge("n3", "n4")
    c.add_edge("n4", "n5")
    c.add_edge("n5", "b1", label="进行中", fp="left", tp="left")
    c.add_edge("n5", "b2", label="成功")
    c.add_edge("n5", "b3", label="失败", fp="right", tp="right")
    c.add_edge("b1", "n6", fp="bottom", tp="left")
    c.add_edge("b2", "n6")
    c.add_edge("b3", "n6", fp="bottom", tp="right")
    c.add_edge("n6", "n7")
    c.add_edge("n7", "n8", label="是")
    c.render(os.path.join(OUT_DIR, "flow2-ota.png"))


def chart3_rbac():
    c = Canvas("图 3  RBAC 权限校验流程",
               "无状态 token 解析 → 实时查权限 → 权限点匹配 → 提权防护", cols=3)
    c.add_node("n0", "请求到达管理端接口", "terminal", 0, 0)
    c.add_node("n1", "提取并解析 token parseToken\nBearer 优先，?token= 兜底\npayload=base64url(uid/iat/exp)\nHMAC 重算+恒定时间比较，校验 exp", "decision", 1, 0)
    c.add_node("e1", "401 未登录\n或登录已过期", "error", 1, 1, w=220)
    c.add_node("n2", "查用户 findUserById", "process", 2, 0)
    c.add_node("n3", "账号 status = active ?", "decision", 3, 0)
    c.add_node("e2", "403 账号已被禁用", "error", 3, 1, w=220)
    c.add_node("n4", "构建鉴权画像 buildAuthProfile\n按 group_id 实时查 group_permissions\ntoken 不含权限 → 改组立即生效", "process", 4, 0)
    c.add_node("n5", "requirePermission(needed)\n权限点匹配（数组满足其一即可）", "process", 5, 0)
    c.add_node("n6", "owned 含 needed ?", "decision", 6, 0)
    c.add_node("e3", "403 无权访问", "error", 6, 1, w=220)
    c.add_node("n7", "通过，执行业务逻辑", "terminal", 7, 0)
    side_text = ("写操作提权防护\n"
                 "──────────────\n"
                 "• 仅超管可分配 super_admin 组\n"
                 "• 不能改自己组 / 禁用 / 删自己\n"
                 "• 保护最后一个可用超管\n"
                 "• 非超管不能授予敏感权限\n"
                 "• 内置组不可删除\n"
                 "• super_admin 权限不可修改")
    c.add_node("s1", side_text, "side", 3, 2, w=280)
    c.add_edge("n0", "n1")
    c.add_edge("n1", "e1", label="否", fp="right", tp="left")
    c.add_edge("n1", "n2", label="是")
    c.add_edge("n2", "n3")
    c.add_edge("n3", "e2", label="否", fp="right", tp="left")
    c.add_edge("n3", "n4", label="是")
    c.add_edge("n4", "n5")
    c.add_edge("n5", "n6")
    c.add_edge("n6", "e3", label="否", fp="right", tp="left")
    c.add_edge("n6", "n7", label="是")
    c.render(os.path.join(OUT_DIR, "flow3-rbac.png"))


if __name__ == "__main__":
    chart1_subscribe()
    chart2_ota()
    chart3_rbac()
    print("ALL DONE")
