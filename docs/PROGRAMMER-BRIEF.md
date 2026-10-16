# 程序员接手入口 · Shot Mate

更新：2026-10-16。请以本文和 [当前 UI 交接](SHOT-MATE-HANDOFF.md) 为准；较早的视觉探索只作历史记录。

- 仓库：[lipaliu/lipa-shot-studio](https://github.com/lipaliu/lipa-shot-studio)，公开，默认分支 `codex/initial-delivery`。
- 产品名：**Shot Mate**。透明英文扁宽字标，无中文副标。钴蓝主色、朱红与酸柠黄强调，暖白剧本区、深蓝分镜区。
- 当前状态：本地工作台已运行、代码已同步；**尚未完成真实模型验收与公网部署**。

## 1. 先在本地启动

需要 Node.js 24 或更高版本。

```sh
git clone https://github.com/lipaliu/lipa-shot-studio.git
cd lipa-shot-studio
npm ci
cp .env.example .env
npm run build
npm test
npm start
```

访问 http://127.0.0.1:4318/ 。已存在 `.env` 时不要覆盖；修改前端后重新执行 `npm run build`，修改服务端后重启。不能双击 `index.html` 运行完整应用。

无密钥也能点击“查看预写示例”，检查故事板、机位图、分镜表、编辑、审核和导出。示例是预写数据，不是实时模型输出。

## 2. 配置并实测 GPT、豆包

- `.env` 可配置 `OPENAI_API_KEY` / `OPENAI_MODEL`、`DOUBAO_API_KEY` / `DOUBAO_MODEL`；也可在网页模型设置保存，密钥仅在服务端存储。
- GPT 使用 OpenAI 官方接口；豆包使用火山方舟接口。模型 ID 必须属于对应厂商、账户可调用且支持项目所需 JSON 输出。不要将 Claude 模型 ID 填入 GPT 栏。
- 环境变量中的 key/model 优先于页面值。页面“已配置”只表示配置存在，**不等于连接测试成功**。
- 分别“保存并测试”，再分别用 `examples/script.txt` 完整生成。记录实际模型、耗时、usage/费用和失败信息，不记录密钥。
- 检查对白原句覆盖、正反打/轴线、动作与道具连续、表演可执行性、光线/声音，以及时长依据。不要只看请求成功。

导演规则来自仓库内的 Higgsfield 社区 Skills，由 GPT/豆包执行；不需要充值 Higgsfield、不调用其付费 API，不依赖 Codex。

## 3. 保留已确定的产品流程

**粘贴或导入剧本 → 一键生成 → 逐镜审核 → 导出。** 左侧剧本、右侧故事板/表格；手机上下排列。画幅、画风和名称收在“更多选项”；模型与历史在顶部。

- 不增加目标总时长输入。根据对白、动作、停顿估算每镜时间，程序汇总，用户可修改。
- 保留镜号、原文出处、画面、表演、景别/机位/运镜、正反打/轴线、美术/画风/光线、对白/环境声/音效/配乐、预计秒数、完整提示词。
- 保留故事板、俯视机位图、分镜表切换，逐镜编辑、审核和 CSV/JSON 导出。
- 修改输入后再次生成新建项目，旧结果留在历史。
- 当前尚未接自动生图或视频生成；支持构图示意、机位草图及上传分镜图。首页电影照片是已标注的视觉参考，不是生成结果。

## 4. 部署独立公网服务

详细步骤见 [技术交接](HANDOFF.md)。这是 React + Express + SQLite 应用，不能只上传静态 HTML。

1. 使用独立服务器/托管、正式域名、HTTPS；不要把 localhost、临时隧道或 Codex 预览当交付网址。
2. 配置至少 12 位 `APP_PASSWORD`；HTTPS 设置 `COOKIE_SECURE=true`。容器使用 `HOST=0.0.0.0`，由反向代理访问，限制公网直连内部端口。
3. 持久化 `.data` / `DATA_DIR`，包含 SQLite、配置与用户数据。环境文件、密钥和数据不能进 Git。
4. Dockerfile 构建时包含 `public` 目录，避免 Logo、配色和参考图丢失；Docker/Compose 尚需在目标环境实测。
5. 验收未登录访问可打开登录页、敏感 API 返回 401；登录后导入、真实生成、编辑、审核、导出正常；重启后数据仍在。
6. 用不带 Cookie/Authorization 的 HTTP 请求检查最终网址、跳转、JS/CSS/图片，再用真实浏览器验证。大陆/微信访问单独实测，不作未经验证的可达性承诺。

当前只有共用团队密码、单任务执行；没有个人权限隔离与多人编辑冲突控制。适合受信任小团队，扩展时需单独设计。

## 5. 验证记录与代码位置

2026-10-16：前端构建及 **17 项现有测试通过**；含模拟模型流程和 HTTP 集成测试，不含真实付费模型调用。桌面/手机页面、选项、预写示例、故事板、机位图、分镜表、编辑抽屉和模型设置已浏览器检查。

| 位置 | 用途 |
| --- | --- |
| `src/main.jsx` | 主工作台、模型设置、分镜表与镜头编辑 |
| `src/storyboard.jsx` | 故事板和可编辑机位图 |
| `src/shotmate.css`、`src/cinema.css` | 品牌布局与工作区样式 |
| `public/shotmate/`、`public/brand/` | 透明 Logo、视觉参考、品牌色与规范页 |
| `server/` | API、模型适配、多阶段生成、校验与存储 |
| `prompts/`、`vendor/higgsfield/` | 工作流合同与创作规则快照 |
| `tests/`、`examples/` | 离线/API 测试和预写示例 |

[当前 UI 交接](SHOT-MATE-HANDOFF.md) · [技术部署说明](HANDOFF.md) · [规则来源](SKILL-SOURCES.md) · [品牌系统](BRAND-SYSTEM.md)
