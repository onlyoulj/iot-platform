---
name: mobile-apk-pack
description: 打包 mobile 移动端（uni-app 项目）为 Android APK。使用 HBuilderX CLI（D:/HBuilderX/cli.exe）的 pack 云打包命令，当用户要求打 APK、打包移动端、生成安卓安装包时使用。
---

# mobile-apk-pack：打包 uni-app 移动端为 APK

本仓库的移动端在 `E:\iot-platform\mobile`（uni-app 3 + Vue 3，仅配置了 h5 构建，Android 打包通过 HBuilderX 云打包完成）。本机已安装 HBuilderX 于 `D:\HBuilderX`，其 `cli.exe` 已登录账号（见下方前置检查）。

## 前置检查（每次打包前执行）

1. 确认 HBuilderX 存在：`D:/HBuilderX/cli.exe`。
2. 启动并检查登录（pack 依赖登录的 DCloud 账号）：
   ```powershell
   powershell -NoProfile -Command "& 'D:\HBuilderX\cli.exe' open"
   powershell -NoProfile -Command "& 'D:\HBuilderX\cli.exe' user info"
   ```
   输出包含账号邮箱和 `user info:OK` 即已登录。未登录时提示用户在 HBuilderX 界面登录后重试，不要索要账号密码。
3. 检查 `mobile/src/manifest.json` 中应用名称、appid、版本号；若用户要求升版本，修改 `versionName` / `versionCode` 后再打包。

注意：`cli.exe` 必须经 PowerShell 调用（Git Bash 直接执行无输出）。`cli.exe open` 首次运行会启动 HBuilderX 主程序，属正常现象。

## 打包命令

```powershell
powershell -NoProfile -Command "& 'D:\HBuilderX\cli.exe' pack --project 'E:/iot-platform/mobile' --platform android --iscustom false --safemode true --android.packagename '<包名>' --android.androidpacktype 2"
```

注意 `--project` 必须用**正斜杠**路径 `E:/iot-platform/mobile`（反斜杠会报「Project not found」）；项目须已在 HBuilderX 中导入过（`cli.exe project list` 里存在 `mobile`）。

参数说明（完整参数见 `cli.exe pack --help`）：

- `--project`：HBuilderX 中导入的项目绝对路径，即 `E:\iot-platform\mobile`。
- `--platform android`：打包安卓。
- `--android.packagename`：必填，如 `com.example.iotmobile`。沿用上次打包的包名；没有记录时询问用户。
- `--android.androidpacktype`：`0` 自有证书（需 `--android.certfile/--android.certalias/--android.certpassword`），`2` DCloud 云端生成证书（默认用这个），`1` 公共测试证书已停用勿用。正式发布需用户提供自有证书与密码。
- `--safemode true`：安心打包，本地不出验证码。
- `--android.channels`：可选渠道包（google/huawei/xiaomi/oppo/vivo/360/yyb）。

## 关键坑：CLI 打包的编译环节（本项目必读）

`cli.exe pack` 会先用 HBuilderX 内置编译器在本地编译项目再上传云端。本项目是「CLI 项目」（有 `package.json` + `src/manifest.json`），HBuilderX 对这类项目的编译有一个隐蔽要求：**编译进程的工作目录必须是 `D:/HBuilderX/plugins/uniapp-cli-vite`**，否则 `isInHBuilderX()` 检测失败，`vite.config.js`（项目根，内含 `uni()` 插件）不会被加载，报「项目编译失败」且 HBuilderX 控制台之外没有任何详细错误。

表现：pack 命令走到「正在编译打包资源...」后 7 秒内报「项目编译失败」。正常编译输出两个 `Compiler version` 后 `DONE Build complete.`，产物在 `unpackage/dist/build/app/`（app 平台目录为 `app`，不是 `app-plus`，应包含 `manifest.json`、`app-service.js`、`pages/` 等）。

打包前手动预编译验证（产物无效时先跑这个，再提交 pack）：

```bash
cd "D:/HBuilderX/plugins/uniapp-cli-vite" && \
UNI_INPUT_DIR="E:/iot-platform/mobile/src" \
UNI_OUTPUT_DIR="E:/iot-platform/mobile/unpackage/dist/build/app" \
HX_Version=4.01 NODE_ENV=production \
node --max-old-space-size=2048 --no-warnings "E:/iot-platform/mobile/node_modules/@dcloudio/vite-plugin-uni/bin/uni.js" build build -p app
```

注意：必须从 HBuilderX 插件目录执行；`UNI_INPUT_DIR` 是 `src` 子目录。HBuilderX GUI 内打包（界面点「发行→原生App-云打包」）不受此问题影响。

## 证书

- DCloud **公共测试证书已停用**（新应用报「存在安全隐患」不再支持），`--android.androidpacktype 1` 会失败。
- 可用：`2`（DCloud 云端生成的证书，适合测试分发）或 `0`（自有 keystore，需 certfile/certalias/certpassword）。本项目此前用过的包名为 `com.aurora.iotplatform`。

## 打包后

1. 云打包完成后 APK 下载到 `E:\iot-platform\mobile\unpackage\release\apk\`（`.apk` 文件），把绝对路径和文件大小告诉用户。
2. 记录本次的包名、证书类型、版本号到仓库 `.workbuddy/memory/` 当日记忆文件，供下次沿用。
3. 若失败：如实转述 cli 输出的错误（常见原因：未登录、包名不合法、证书密码错误、云端排队超时、编译失败见上文），修正参数后重试；不要谎报成功。

## 约束

- 只用云打包，不要尝试本地 gradle 构建（项目无 android 原生工程）。
- 打包耗时通常 2–10 分钟，命令设置足够超时（建议 600000ms），超时后可去 `unpackage/release/apk/` 确认产物。
- 不要修改 `mobile/src/manifest.json` 的 appid（DCloud appid 绑定云端项目），除非用户明确要求。
