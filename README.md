# Shot Mate · 你的 AI 分镜师

**你的 AI 分镜师。**

**程序员接手先看：[交接入口与上线清单](docs/PROGRAMMER-BRIEF.md)** · [当前 UI 交接](docs/SHOT-MATE-HANDOFF.md) · [技术部署说明](docs/HANDOFF.md)

将剧本交给所选文字模型，自动串联 Higgsfield 创作 Skills，输出可逐镜审核的分镜表；可选择图片模型为单镜生成静帧。网站独立运行，不依赖 Codex / ChatGPT 会话，不调用 Higgsfield 付费 API，也不生成视频。

品牌与 UI 规范位于 `/brand/`，包含透明 Logo 下载、配色与排版说明。实现与素材说明见 [Shot Mate 设计系统](docs/BRAND-SYSTEM.md)。

最新 UI 交接与验证边界见 [Shot Mate 交接](docs/SHOT-MATE-HANDOFF.md)。

## 本地启动

需要 Node.js 24（使用内置 SQLite）。

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

打开 http://127.0.0.1:4318 。右上角「模型设置」分为文字 API 和图片 API。文字 API 可切换 ToAPIs / OpenAI 兼容模型或豆包直连，并设置模型 ID、API Key、Base URL；图片 API 可独立选择模型和 Base URL，复用 ToAPIs 文字密钥或填写单独密钥。密钥只保存在服务端，不能提交 Git。

无密钥时仍可打开明确标注的预写示例，查看、编辑、审核和导出；真实生成必须配置有额度且支持 JSON 输出的模型。示例不会伪装成模型结果。

## 使用

主界面只有两个窗口：左侧剧本输入，右侧分镜表；手机上改为上下排列。默认粘贴后直接生成，画幅/画风/名称收在「更多选项」，模型和历史分镜在顶部。生成过程中输入和输出同屏，点击镜号修改。修改输入后再次生成会新建项目，旧结果保留在历史中。

打开网站地址，不要双击 index.html；这是需要后台的 Web 应用。

1. 粘贴剧本，或导入 TXT、Markdown、DOCX（最多 5 MB / 30,000 字符）。
2. 可选画幅和画风，点击生成。后台依次理解场景 → 拆镜/表演/摄影 → 美术/光线/声音 → 复核。
3. 每镜包含原文出处、画面、表演、景别、运镜、轴线/正反打、画风、美术、光线、对白/音效/环境/配乐、秒数和完整提示词。
4. 点击镜号逐镜修改，保存同步更新提示词并恢复待审；相邻已通过镜头提示复查。导出 CSV 或完整 JSON。

**不填写目标总时长。** 模型依据剧情估算每镜的语速、动作、停顿及重叠关系，程序计算并汇总。范围是经验浮动带，不是统计置信区间；秒数需后续通过配音/表演校准。

## 导演规则来源

界面采用「走位胶带」视觉：水泥灰页面、粉笔白剧本区与胶带黑分镜区并排。默认先生成分镜表，再逐镜按需规划机位；拖动后自动同步摄影文字与提示词。品牌规范见 [BRAND-SYSTEM.md](docs/BRAND-SYSTEM.md)。支持逐镜上传分镜图和调整站位；没有图片时显示构图示意。详见 [故事板改版与验证说明](docs/UI-STORYBOARD.md)。

## 图片 API

模型设置可分别选择文字和图片 API。默认文字模型为 Claude Opus 5.5，ToAPIs / 兼容文字接口还内置 GPT Mini、DeepSeek V4 Flash（待完整验证）、GLM 5.3 Flash、Qwen 3.5 Flash 快捷选项，也可填写其他支持 Chat Completions 和 JSON 输出的模型 ID。DeepSeek V4 Flash 已通过简单 JSON 连接测试；一次完整分镜先触发本地输出长度限制，调高限制后又返回未能解析的 JSON，因此尚未确认完整流程。默认图片模型为 GPT Image 2，另有 Qwen Image 3.0 / Pro、Seedream 5.0 快捷选项，也可自行填写兼容的模型 ID。默认 Base URL 为 `https://toapis.cn/v1`，图片可复用已保存的 ToAPIs 文字 API Key。

文字分镜完成后，在故事板中逐镜点击「生成图片」；每次点击调用一次付费图片模型，不会自动批量生成。后台等待 ToAPIs 异步任务完成后，把结果图片下载到本地 `.data/images` 并展示在镜头中。手工上传分镜图仍可使用。模型处理与平台排队时间会因所选模型和请求而变化。

文字分镜的所有场次完成后才能进入故事板；图片是可选的异步任务，不影响切换到下一镜查看文字。当前后台一次只运行一个图片生成任务，需等前一张完成才能提交下一张。

CSV 交付文字分镜和提示词；完整 JSON 包含生成图片的本地地址。图片文件保存在运行此服务的机器上，导出 JSON 不会打包图片文件。


主创作规则来自 OSideMedia 的 Higgsfield 社区 Skills：shotlist-director、acting、camera、style、audio。原文快照位于 [vendor/higgsfield](vendor/higgsfield)，许可为 MIT。实际选段、版本和 SHA-256 记录在 manifest，后台直接读取选段传给模型。不是只写一个“你是导演”的提示词，也不是 Higgsfield 官方接口。

[规则来源与适配说明](docs/SKILL-SOURCES.md) · [发给程序员的交接摘要](docs/PROGRAMMER-BRIEF.md) · [技术交接](docs/HANDOFF.md) · [验收记录](docs/TESTING.md)

## 交付状态

- 本地前后端、示例逐镜流程、模拟模型多阶段流程已验证。
- 本地已使用现有 ToAPIs 令牌验证 GPT 文字与图片链路、Qwen Image 3.0 图片链路；文字模型 DeepSeek V4 Flash、GLM 5.3 Flash、Qwen 3.5 Flash 的简单 JSON 请求也已验证。实际完整分镜质量、延时与费用仍取决于所选模型和剧本。
- 本次只交付本地运行与公开 GitHub 源码，不包含公网部署。

## 开发

```sh
npm test
npm run build
npm start
```

修改前端后重新 build，修改服务端后重启。服务器只服务构建后的 dist。

目录：src 为界面；server 为 API / 数据 / 模型工作流；prompts 为网页适配合同；vendor 为 Higgsfield 原文；examples 为手写示例；tests 为离线测试。

仓库公开可读，未授予项目整体开源许可。Higgsfield 规则原文保留其 MIT 许可，见 licenses/HIGGSFIELD-MIT.txt。
