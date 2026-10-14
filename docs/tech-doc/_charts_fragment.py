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
