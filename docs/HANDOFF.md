# 程序员交接 · 2026-10-14

## 明天优先做

1. 克隆私有仓库，Node 24，npm ci / npm run build / npm start。
2. 配置真实 GPT 和豆包 Key、可用模型 ID（不要发聊天、不要提交 Git）。分别「保存并测试」，再分别用 examples/script.txt 真实生成一次。
3. 验证每份成品的原文/对白覆盖、正反打与持物连续、可表演性、时长构成、风格/光线/声音。记录实际模型 ID、日期、返回 usage、耗时、问题；离线测试不等同模型质量验收。
4. 在获得明确域名/服务器配置后部署独立托管网址。当前没有创建任何公网站点。

## 模型接口

两者采用服务端 Chat Completions：OpenAI 官方 /v1/chat/completions；豆包默认方舟北京 /api/v3/chat/completions。body 使用 response_format=json_object 和 max_completion_tokens，要求选择支持这些参数且上下文足够的模型。DOUBAO_BASE_URL 可调整官方区域；没有开放任意浏览器指定端点。

每 N 场成功路径为 2N+2 次请求，结构校验失败各阶段最多额外修复一次；单请求 240 秒超时。每场完成写入 SQLite；取消/失败可继续，已完成场次保留。当前仅支持一个同时运行的任务，单进程部署。重启会把运行任务标为已中断，需要人工点继续。

## 密钥与数据

- .env 环境变量优先于页面保存的 key/model。默认提供方优先采用已保存的页面选择。
- 页面保存的配置写入 .data/config.json（权限 600，目录 700），是服务端明文配置；建议部署使用环境密钥。
- 剧本、分镜、进度、审核保存在 .data/studio.sqlite，未纳入 Git。SQLite WAL 模式；备份请使用 SQLite backup 或停服务后备份完整 .data，不能只热拷贝主库忽略 WAL。
- 共用团队密码，无个人账号、角色隔离、审计日志或多人编辑冲突检测。所有登录成员可看全部项目并改模型设置。仅适合受信任小团队。
- 密码会话存在进程内，重启需要重新登录。第一版没有数据删除 UI 或异步任务队列服务。

## 独立服务器部署参考（Docker）

已提供 Dockerfile 与 compose.yaml；Docker 路径未在本机实测，程序员需验收。服务器不能使用静态托管直接承载此项目，必须支持持续 Node 服务、出站模型网络、持久卷。

```sh
cp .env.example .env
# 编辑 .env：设置强 APP_PASSWORD、实际模型、COOKIE_SECURE=true（HTTPS 环境）
docker compose up -d --build
```

容器内部 HOST=0.0.0.0，强制密码至少 12 位；宿主端口默认只绑定 127.0.0.1:4318。使用 Caddy / Nginx 为正式域名提供 HTTPS 并代理至本机 4318。命名卷保留数据库；升级不要执行 docker compose down -v。需确认域名/托管账号已授权，避免覆盖无关站点。

非回环绑定要求密码。不用 Docker 时，默认回环模式会拒绝外部 Host；部署反向代理请设置 HOST=0.0.0.0 和强 APP_PASSWORD，并通过防火墙禁止公网直连 4318，只允许代理访问。反向代理保留正确 Host / Origin。COOKIE_SECURE=true 仅用于 HTTPS，普通 HTTP 会导致 Cookie 无法回传。

上线验收：不带 Cookie/Authorization 请求根路径与静态资源可得到登录页面；敏感 API 应 401；正确登录后验证导入、真实生成、保存、刷新、导出、重启持久化。再用浏览器检查最终正式域名真实内容及跳转。不把本地进程、隧道或 Codex 预览当公网交付。大陆/微信可达性另行实际测试。

## 当前边界

- 不接 Higgsfield API、不生成分镜图/视频。
- 不支持 PDF、扫描文档、OCR；DOCX 只取文本。
- 时长是创作估计，无 TTS / 实拍测量，不支持完整跨镜声音时间线。
- 长剧本、复杂对白格式和精确原文行动覆盖仍需人工复核；原文行号存在不证明语义全部被拍到。
- 本次没有真实模型验收，不承诺影视质量/成功率/延时。
- npm audit 当前有 3 项 moderate，来自 mammoth 的 CLI 依赖 argparse → sprintf-js 格式串 DoS；本项目调用 extractRawText，未使用该 CLI 格式化入口。不要强制降级 mammoth 到旧版；上线前复查上游修复并评估 DOCX 隔离/限流。
