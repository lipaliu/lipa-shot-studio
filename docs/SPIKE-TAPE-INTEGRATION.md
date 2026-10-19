# 走位胶带视觉整合 · 2026-10-19

设计来源：lipaliu/lipa-shot-studio 的 `design/spike-tape`，提交 `043413e7df9b965775cc71c41c6538c447bb3d24`，其基线为 `63ae9fe575af5d78d62ebf7e580fecda1578b335`。

整合分支：`codex/spike-tape-integration`。先将现有模型配置、图片 API 与表格优先/机位同步功能保存为本地提交，再基于设计基线进行三方合并。Git 直连超时，因此通过 GitHub API 下载改动文件，并按 Git blob SHA 核验；非直接切换旧版设计分支。原始设计分支截图未引入，以本次实际运行截图代替。

采用：模板字胶带字标、粉色 T 图标、水泥灰/粉笔白/胶带黑色系、状态胶带、自托管字体及许可证、T 形人物与 CAM 机位、黄色 X 主光、品牌规范页。新版机位同步面板及文字/图片模型快捷选择补齐同一视觉；机位 SVG 的主要品牌色改为读取 tokens.css。

保留：默认分镜表、逐镜按需规划机位、拖动与键盘调整、自动保存/同步提示词、GPT/豆包兼容入口、图片模型设置和逐镜生图、现有剧本数据。未改真实密钥与用户模型配置。

验证：34 项测试通过、Vite 生产构建通过。浏览器检查首页、品牌页、文字/图片设置、默认表格、机位编辑；示例摄影机移至 X=51 后，数据库与提示词同步。检查 320/768/1024/默认 1440 宽度，未发现页面横向溢出；宽分镜表保留内部横向滚动。字体 HTTP 200，浏览器无错误日志。此次未调用付费模型，不代替真实生成质量验收；审美仍待用户确认。

截图：`docs/screenshots/spike-integrated-empty.jpg`、`docs/screenshots/spike-integrated-plan.jpg`。

已按用户确认同步到 GitHub 的 `codex/spike-tape-integration` 分支；原 `codex/initial-delivery` 与 `design/spike-tape` 分支未修改。未部署公网。

追加交互调整：剧本名称、画幅、画风直接显示在输入区，移除“更多选项”折叠入口，原设置值和提交逻辑保留。
