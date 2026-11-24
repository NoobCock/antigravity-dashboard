# Antigrative Dashboard v0.9.0

## Auto-update from GitHub Releases (`latest`)
- Automatically checks `NoobCock/antigravity-dashboard` GitHub Releases (`/releases/latest`) on startup (after a 10s delay) and every 6 hours, with a manual **Check / Update** action and **Auto** toggle inside the Context card.
- Downloads the official desktop release ZIP and its `.sha256` checksum strictly from allowlisted GitHub HTTPS hosts (including verified redirects), verifies SHA256 + CRC32 + path safety in pure Node.js, stages runtime files (`assets/`, `compat/`, `sidecars/`, `plugin.json`) atomically, preserves all user data/preferences/usage history, and cleanly restarts the sidecar for live hot-reload.
- Automatically protects local git workspaces (`.git`) from self-overwriting while still allowing update checks.

## Antigravity 2.35+ compatibility, native model menu & quota accuracy
- **Native model menu while running + deferred switch**: Hovering or clicking the locked model selector while the agent is running opens Antigravity's native Base-UI model menu (including `Thinking effort` and `View Usage` submenus), replaces the locked hint with `Model will be changed after this turn`, queues the chosen model locally without mutating the active turn, and applies it automatically once the turn unlocks.
- **Immediate `/compact` context refresh**: Detects completed checkpoint compaction steps immediately after `/compact` so context occupancy updates before the next user message.
- **Weekly quota token estimate**: Aligns weekly token estimation to the actual reset window and reports both estimated remaining and estimated cycle total (`~remaining / ~total`), filtering API jitter dips from calibration.
- **Windows elevated backend & atomic install**: Retains elevated `language_server.exe` instances via listening port + sidecar credentials, and stages `manage.py install` atomically before replacing live files.

## Downloads and update
- **Desktop App / CLI:** `antigrative-dashboard-0.9.0.zip` and its `.sha256`. Extract and run `python manage.py install` (App) or `python manage.py install-cli` (CLI). Future releases published to `latest` will be detected and updated automatically.
- **Standalone Antigravity IDE:** `antigrative-dashboard-ide-0.9.0.vsix` and its `.sha256`.

## 中文摘要
- **GitHub `latest` 自动检查与热更新**：内置无依赖自动更新器，定期检查 `NoobCock/antigravity-dashboard` 的 `latest` Release，严格校验 GitHub 下载域名与 `.sha256` 校验和后原子替换插件运行时文件并自动重启 sidecar 热重载（完整保留本地统计、用量账本和偏好设置；本地 `.git` 开发目录自动保护不覆写），同时在上下文卡片底部提供手动检查/更新与自动更新开关。
- **运行期原生模型菜单 + 延迟切换**：Agent 运行期间悬停或点击模型按钮可直接展开 Antigravity 原生模型列表及 `Thinking effort` / `View Usage` 二级菜单，顶部提示 `Model will be changed after this turn`；点选模型仅本地排队、不中途越权修改，本轮结束解锁后自动应用。
- **兼容性与统计增强**：适配 Antigravity 2.35+ 及 Windows 管理员权限启动的后端进程；`/compact` 完成后立即刷新上下文占用；周额度剩余与周期总额测算对齐真实重置窗口；安装脚本改用原子暂存替换，避免磁盘空间异常破坏插件文件。
