import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Clapperboard,
  ArrowUpRight,
  ArrowRight,
  Settings2,
  FileText,
  Upload,
  Check,
  X,
  ChevronRight,
  ChevronDown,
  Download,
  Copy,
  LoaderCircle,
  Play,
  AlertCircle,
  Film,
  Clock3,
  CheckCheck,
  BookOpen,
  RotateCcw,
  Square,
  Sparkles,
} from "lucide-react";
import "./cinema.css";
import "./shotmate.css";
import { Storyboard } from "./storyboard.jsx";
async function api(url, options = {}) {
  const r = await fetch("/api" + url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `请求失败 (${r.status})`);
  return d;
}
const post = (url, data = {}) =>
  api(url, { method: "POST", body: JSON.stringify(data) });
const cn = (...a) => a.filter(Boolean).join(" ");
const statusNames = { draft: "待审核", approved: "已通过", changes: "待修改" };
const projectStatus = {
  running: "生成中",
  ready: "可审核",
  failed: "生成失败",
  cancelled: "已取消",
  interrupted: "已中断",
  queued: "排队中",
};
const duration = (s) =>
  s >= 60
    ? `${Math.floor(s / 60)}分${Math.round(s % 60)}秒`
    : `${Math.round(s * 10) / 10}秒`;
const providers = { openai: "ToAPIs / 兼容", doubao: "豆包直连" };
const textModelPresets = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5 · 默认" },
  { id: "gpt-5.4-mini-official", name: "GPT Mini" },
  { id: "deepseek-v4-flash", name: "DeepSeek Flash · 待验证" },
  { id: "glm-5.3-flash", name: "智谱 GLM Flash" },
  { id: "qwen3.5-flash", name: "通义千问 Flash" },
];
const imageModelPresets = [
  { id: "gpt-image-2", name: "GPT Image 2 · 默认" },
  { id: "qwen-image-3.0", name: "通义万相 3.0" },
  { id: "qwen-image-3.0-pro", name: "通义万相 3.0 Pro" },
  { id: "doubao-seedream-5-0", name: "即梦 Seedream 5.0" },
];
const textModelName = (model) =>
  textModelPresets.find((preset) => preset.id === model)?.name || model || "模型";
function App() {
  const [session, setSession] = useState(null),
    [password, setPassword] = useState(""),
    [projects, setProjects] = useState([]),
    [project, setProject] = useState(null),
    [settings, setSettings] = useState(null),
    [showSettings, setShowSettings] = useState(false),
    [settingsSection, setSettingsSection] = useState("text"),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [showHistory, setShowHistory] = useState(false),
    [selected, setSelected] = useState(null),
    [filter, setFilter] = useState("all"),
    [sceneFilter, setSceneFilter] = useState("all"),
    [view, setView] = useState("board"),
    [boardDirty, setBoardDirty] = useState(false);
  const leaveBoard = () => {
    if (boardDirty) notify("请先保存镜头，或在故事板中撤销修改。");
    return !boardDirty;
  };
  const [title, setTitle] = useState(""),
    [script, setScript] = useState(""),
    [style, setStyle] = useState("写实影像，具体光色和氛围依剧本判断"),
    [aspect, setAspect] = useState("9:16");
  const upload = useRef();
  const imageInProgress = Object.values(project?.imageTasks || {}).some((task) =>
    ["queued", "in_progress"].includes(task.status),
  );
  const notify = (s) => {
    setToast(s);
    setTimeout(() => setToast(""), 3200);
  };
  const load = async () => {
    const [p, s] = await Promise.all([api("/projects"), api("/settings")]);
    setProjects(p);
    setSettings(s);
  };
  useEffect(() => {
    api("/session")
      .then(setSession)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (session?.authenticated) load().catch((e) => setError(e.message));
  }, [session]);
  useEffect(() => {
    if (project?.status !== "running" && !imageInProgress) return;
    const id = setInterval(async () => {
      try {
        const p = await api("/projects/" + project.id);
        setProject(p);
        const stillGeneratingImage = Object.values(p.imageTasks || {}).some((task) =>
          ["queued", "in_progress"].includes(task.status),
        );
        if (
          imageInProgress &&
          !stillGeneratingImage
        ) notify("图片任务已结束，分镜已更新");
        if (p.status !== "running" && !stillGeneratingImage) load();
      } catch (e) {
        setError(e.message);
      }
    }, 1800);
    return () => clearInterval(id);
  }, [project?.id, project?.status, imageInProgress]);
  useEffect(() => {
    if (!project?.id || !["failed", "cancelled", "interrupted"].includes(project.status) || boardDirty)
      return;
    const sync = async () => {
      try {
        const latest = await api("/projects/" + project.id);
        if (latest.updatedAt !== project.updatedAt) {
          setProject(latest);
          await load();
        }
      } catch {
        // Keep the current project visible while the local server is unavailable.
      }
    };
    const id = setInterval(sync, 5000);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", sync);
    };
  }, [project?.id, project?.status, project?.updatedAt, boardDirty]);
  async function act(fn) {
    setError("");
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function open(id) {
    if (!leaveBoard()) return;
    await act(async () => {
      const p = await api("/projects/" + id);
      setProject(p);
      setScript(p.script);
      setTitle(p.title);
      setStyle(p.style);
      setAspect(p.aspect);
      setSelected(null);
      setFilter("all");
      setSceneFilter("all");
      setShowHistory(false);
    });
  }
  async function generate(e) {
    e.preventDefault();
    if (!leaveBoard()) return;
    if (!settings?.[settings.provider]?.configured) {
      setSettingsSection("text");
      setShowSettings(true);
      return;
    }
    await act(async () => {
      const p = await post("/projects", {
        title: title.trim() || "未命名剧本",
        script,
        style,
        aspect,
      });
      setProject(p);
      setSelected(null);
      setFilter("all");
      setSceneFilter("all");
      await load();
    });
  }
  async function importFile(file) {
    if (!file) return;
    await act(async () => {
      const b = new Uint8Array(await file.arrayBuffer());
      let str = "";
      for (let i = 0; i < b.length; i += 8192)
        str += String.fromCharCode(...b.subarray(i, i + 8192));
      const d = await post("/import", { name: file.name, base64: btoa(str) });
      setScript(d.text);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
      notify("剧本已导入");
    });
  }
  async function example() {
    if (!leaveBoard()) return;
    await act(async () => {
      const p = await post("/example");
      setProject(p);
      setScript(p.script);
      setTitle(p.title);
      setStyle(p.style);
      setAspect(p.aspect);
      setFilter("all");
      setSceneFilter("all");
      await load();
    });
  }
  async function updateShot(shot) {
    const p = await api(`/projects/${project.id}/shots/${shot.id}`, {
      method: "PATCH",
      body: JSON.stringify(shot),
    });
    setProject(p);
    if (selected) setSelected(p.shots.find((s) => s.id === shot.id));
    await load();
    return p;
  }
  async function generateShotImage(shot) {
    const p = await post(`/projects/${project.id}/shots/${shot.id}/image`);
    setProject(p);
    await load();
    notify("图片任务已提交，完成后自动保存");
    return p;
  }
  async function approve(s) {
    await act(async () => {
      await updateShot({
        ...s,
        status: s.status === "approved" ? "draft" : "approved",
      });
      notify(s.status === "approved" ? "已恢复待审" : "镜头已通过");
    });
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify("提示词已复制");
    } catch {
      setError("浏览器未允许复制，请展开镜头后手动选择提示词。");
    }
  }
  const filtered =
    project?.shots.filter(
      (s) =>
        (filter === "all" || s.status === filter) &&
        (sceneFilter === "all" || s.sceneIndex === Number(sceneFilter)),
    ) || [];
  if (!session)
    return (
      <div className="boot">
        <LoaderCircle className="spin" />
        正在打开工作台{error && <p>{error}</p>}
      </div>
    );
  if (!session.authenticated)
    return (
      <div className="login">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              await post("/login", { password });
              setSession(await api("/session"));
            });
          }}
        >
          <Logo />
          <h1>你的 AI 分镜师。</h1>
          <p>输入团队访问密码，继续创作。</p>
          <label>
            访问密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="primary" disabled={busy}>
            进入工作台 <ArrowRight size={16} />
          </button>
        </form>
      </div>
    );
  return (
    <div className={cn("simple-app", project && "has-project")}>
      <header className="simple-header">
        <Logo />
        <div className="header-actions">
          <button className="text-button" onClick={() => setShowHistory(true)}>
            <BookOpen size={16} />
            历史分镜
          </button>
          <button
            className="model-button"
            onClick={() => {
              setSettingsSection("text");
              setShowSettings(true);
            }}
          >
            <Settings2 size={15} />
            {textModelName(settings?.[settings?.provider]?.model)} ·{" "}
            {settings?.[settings?.provider]?.configured ? "已配置" : "待配置"}
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
          <button aria-label="关闭提示" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <section className="studio-intro" aria-label="Shot Mate 分镜工作台">
        <div>
          <p className="studio-eyebrow">从文字，到镜头。</p>
          <h1>把故事，<br className="intro-break" />画进下一镜<span>。</span></h1>
          <p className="studio-description">你来讲故事，Shot Mate 帮你安排画面、表演与声音。</p>
        </div>
        <ol className="workflow-steps" aria-label="创作流程">
          <li><span>01</span><div><strong>放入剧本</strong><small>粘贴文字，或导入文件</small></div></li>
          <li><span>02</span><div><strong>拆解镜头</strong><small>自动估时，保留原对白</small></div></li>
          <li><span>03</span><div><strong>逐镜定稿</strong><small>审阅故事板，导出分镜表</small></div></li>
        </ol>
      </section>
      <main className="two-windows" id="workspace">
        <form className="input-window" onSubmit={generate}>
          <div className="window-heading">
            <h2>
              <span>01</span>你的剧本
            </h2>
            <button
              type="button"
              className="text-button"
              disabled={busy || project?.status === "running"}
              onClick={() => upload.current.click()}
            >
              <Upload size={14} />
              导入
            </button>
          </div>
          <input
            ref={upload}
            type="file"
            accept=".txt,.md,.docx"
            hidden
            onChange={(e) => {
              importFile(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <textarea
            className="simple-script"
            aria-label="剧本正文"
            placeholder={
              "故事从这里开始…\n\n粘贴剧本，保留场景、动作和对白。\n其余的，交给 Shot Mate。"
            }
            value={script}
            onChange={(e) => setScript(e.target.value)}
            maxLength={30000}
            minLength={10}
            required
            disabled={project?.status === "running"}
          />
          <div className="input-count">
            <span>TXT / Word / Markdown</span>
            <span>{script.length.toLocaleString()} / 30,000</span>
          </div>
          <details className="optional-settings">
            <summary>
              更多选项 <span>画幅、画风</span>
              <ChevronDown size={14} />
            </summary>
            <div>
              <label>
                剧本名称
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="自动命名"
                  maxLength={100}
                  disabled={project?.status === "running"}
                />
              </label>
              <label>
                画幅
                <select
                  value={aspect}
                  onChange={(e) => setAspect(e.target.value)}
                  disabled={project?.status === "running"}
                >
                  <option>9:16</option>
                  <option>16:9</option>
                  <option>1:1</option>
                </select>
              </label>
              <label>
                画风
                <textarea
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  disabled={project?.status === "running"}
                />
              </label>
            </div>
          </details>
          <div className="generate-area">
            <button
              className="primary"
              disabled={
                busy ||
                script.trim().length < 10 ||
                project?.status === "running"
              }
            >
              {busy || project?.status === "running" ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Sparkles size={17} />
              )}{" "}
              {project?.status === "running" ? "正在生成…" : "生成分镜"}
              <ArrowRight size={16} />
            </button>
            <p>自动拆镜、估算秒数，保留原对白。</p>
          </div>
        </form>
        <section className="output-window" aria-label="分镜结果">
          <div className="window-heading">
            <h2>
              <span>02</span>分镜工作区
            </h2>
            <span className="output-hint">逐镜修改 · 审核 · 导出</span>
          </div>
          {project &&
            (script !== project.script ||
              style !== project.style ||
              aspect !== project.aspect) && (
              <div className="draft-notice">
                左侧剧本或选项已修改。点击生成会新建一份分镜，当前结果保留在历史中。
              </div>
            )}
          {!project ? (
            <div className="output-empty">
              <figure className="reference-frame">
                <img src="/shotmate/cinema-reference.png" alt="雨夜洗衣店，女子手持信封站在门边的电影视觉参考" width="1672" height="941" />
                <figcaption><span>视觉参考 · AI 示意图</span><span>尚未生成你的分镜</span></figcaption>
              </figure>
              <div className="empty-message">
                <span className="brand-kicker">每一镜，都有它的理由。</span>
                <h2>你的故事，准备开拍。</h2>
                <p>放入剧本，生成后在这里逐镜审阅。<br />景别、运镜、光线、表演与声音，一起安排。</p>
                <button type="button" className="example-button" onClick={example} disabled={busy}>
                  {busy ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />} 查看预写示例 <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="empty-columns"><span>镜号与时长</span><span>表演与调度</span><span>摄影与声音</span></div>
            </div>
          ) : (
            <div className="project-view">
              <div className="project-heading">
                <div>
                  <div className="eyebrow">
                    STORYBOARD /{" "}
                    {project.isExample
                      ? "示例 · 非实时模型生成"
                      : project.provider?.model || providers[project.provider?.name] || "导演分镜"}
                  </div>
                  <h3>{project.title}</h3>
                  <div className="project-sub">
                    <span>{project.aspect}</span>
                    <span>{project.style}</span>
                  </div>
                </div>
                <div className="export-buttons">
                  <a
                    className="secondary"
                    href={`/api/projects/${project.id}/export?format=csv`}
                  >
                    <Download size={15} /> 导出表格
                  </a>
                  <a
                    className="icon-button bordered"
                    aria-label="导出完整 JSON"
                    title="导出完整 JSON"
                    href={`/api/projects/${project.id}/export?format=json`}
                  >
                    <BookOpen size={17} />
                  </a>
                </div>
              </div>
              <div className="stats">
                <div>
                  <Film size={18} />
                  <strong>{project.shots.length}</strong>
                  <span>个镜头</span>
                </div>
                <div>
                  <Clock3 size={18} />
                  <strong>{duration(project.totalSeconds)}</strong>
                  <span>预计成片</span>
                </div>
                <div>
                  <CheckCheck size={18} />
                  <strong>
                    {
                      project.shots.filter((s) => s.status === "approved")
                        .length
                    }{" "}
                    / {project.shots.length}
                  </strong>
                  <span>审核通过</span>
                </div>
                <div className="estimate-note">
                  时长为创作估算，需以配音与表演校准
                </div>
              </div>
              {project.status === "running" && (
                <div className="progress-card">
                  <LoaderCircle className="spin" size={22} />
                  <div>
                    <strong>{project.progress}</strong>
                    <p>正在生成文字分镜，图片不参与这一步。完成后可进入故事板；逐镜生图时仍可切换镜头。</p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() =>
                      act(() => post(`/projects/${project.id}/cancel`))
                    }
                  >
                    <Square size={13} />
                    取消
                  </button>
                  <div className="progress-track">
                    <span />
                  </div>
                </div>
              )}
              {["failed", "cancelled", "interrupted"].includes(
                project.status,
              ) && (
                <div className="task-error">
                  <AlertCircle />
                  <div>
                    <strong>{projectStatus[project.status]}</strong>
                    <p>{project.error}</p>
                    <small>已完成场次会保留，继续时使用当前后台模型。</small>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        setProject(
                          await post(`/projects/${project.id}/resume`),
                        );
                        await load();
                      })
                    }
                  >
                    <RotateCcw size={15} />
                    继续生成
                  </button>
                </div>
              )}
              {project.outline && (
                <details className="global-notes">
                  <summary>
                    <Clapperboard size={17} /> 全片导演设定{" "}
                    <span>
                      {project.outline.scenes.length} 场 ·{" "}
                      {project.outline.characters.length} 位角色
                    </span>
                    <ChevronDown size={15} />
                  </summary>
                  <div>
                    <p>
                      <b>影像基准</b>
                      {project.outline.look}
                    </p>
                    <p>
                      <b>角色</b>
                      {project.outline.characters.join("；")}
                    </p>
                    {project.outline.assumptions.length > 0 && (
                      <p>
                        <b>待确认的创作建议</b>
                        {project.outline.assumptions.join("；")}
                      </p>
                    )}
                    {project.outline.scenes.map((s, i) => (
                      <p key={i}>
                        <b>
                          第 {i + 1} 场 · {s.name}
                        </b>
                        {s.geography}
                      </p>
                    ))}
                  </div>
                </details>
              )}
              {(project.issues.length > 0 || project.auditStale) && (
                <details className="review-notes">
                  <summary>
                    <AlertCircle size={16} />
                    {project.auditStale
                      ? project.isExample
                        ? "示例已修改，请复查相邻镜头的衔接"
                        : "分镜已修改，整场模型审阅已失效；请重新核对衔接"
                      : `${project.issues.length} 项需要你留意`}
                    <ChevronDown size={15} />
                  </summary>
                  <ul>
                    {project.issues.map((x, i) => (
                      <li
                        key={i}
                        className={x.severity === "error" ? "issue-error" : ""}
                      >
                        <b>
                          {x.shotId || "整场"} · {x.category}
                        </b>
                        <span>{x.message}</span>
                        {x.suggestion && <small>{x.suggestion}</small>}
                      </li>
                    ))}
                  </ul>
                  {project.auditStale && !project.isExample && (
                    <button
                      className="secondary"
                      disabled={busy || project.status === "running"}
                      onClick={() =>
                        act(async () => {
                          setProject(
                            await post(`/projects/${project.id}/review`),
                          );
                          await load();
                        })
                      }
                    >
                      重新审阅整场
                    </button>
                  )}
                </details>
              )}
              <div className="table-toolbar">
                <div className="view-switch" aria-label="分镜视图">
                  <button
                    aria-pressed={view === "board"}
                    onClick={() => {
                      if (leaveBoard()) setView("board");
                    }}
                  >
                    <Film size={15} />
                    故事板
                  </button>
                  <button
                    aria-pressed={view === "table"}
                    onClick={() => {
                      if (leaveBoard()) setView("table");
                    }}
                  >
                    <FileText size={15} />
                    分镜表
                  </button>
                </div>
                <div className="tabs">
                  {[
                    ["all", "全部镜头"],
                    ["draft", "待审核"],
                    ["approved", "已通过"],
                    ["changes", "待修改"],
                  ].map(([v, l]) => (
                    <button
                      className={filter === v ? "active" : ""}
                      key={v}
                      onClick={() => {
                        if (leaveBoard()) setFilter(v);
                      }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <select
                  aria-label="筛选场次"
                  value={sceneFilter}
                  onChange={(e) => {
                    if (leaveBoard()) setSceneFilter(e.target.value);
                  }}
                >
                  <option value="all">全部场次</option>
                  {project.outline?.scenes.map((s, i) => (
                    <option value={i} key={i}>
                      第 {i + 1} 场 · {s.name}
                    </option>
                  ))}
                </select>
              </div>
              {view === "board" ? (
                <Storyboard
                  key={`${project.id}-${filter}-${sceneFilter}`}
                  shots={filtered}
                  project={project}
                  onSave={updateShot}
                  onEdit={setSelected}
                  onCopy={copy}
                  onApprove={approve}
                  imageConfigured={settings?.image?.configured}
                  onGenerateImage={generateShotImage}
                  onOpenImageSettings={() => {
                    setSettingsSection("image");
                    setShowSettings(true);
                  }}
                  busy={busy}
                  onDirtyChange={setBoardDirty}
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th className="sticky-col">镜号 / 秒数</th>
                        <th>对应剧本</th>
                        <th>画面与表演</th>
                        <th>摄影与运镜</th>
                        <th>美术与光线</th>
                        <th>对白与声音</th>
                        <th>提示词 / 审核</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((s) => (
                        <tr key={s.id}>
                          <td className="sticky-col">
                            <button
                              className="shot-id"
                              onClick={() => setSelected(s)}
                            >
                              {s.id}
                              <ArrowUpRight size={13} />
                            </button>
                            <strong className="shot-seconds">
                              {s.timing.seconds}
                              <small> 秒</small>
                            </strong>
                            <small className="muted">
                              约 {s.timing.min}–{s.timing.max} 秒
                            </small>
                            <span className={cn("status-pill", s.status)}>
                              {statusNames[s.status]}
                            </span>
                          </td>
                          <td>
                            <div className="source-excerpt">
                              {s.source.map((l) => (
                                <p key={l.id}>
                                  <span>L{l.id}</span>
                                  {l.text}
                                </p>
                              ))}
                            </div>
                            <p className="cell-reason">{s.purpose}</p>
                          </td>
                          <td>
                            <p className="cell-main">{s.description}</p>
                            <div className="cell-label">表演</div>
                            <p>{s.performance}</p>
                          </td>
                          <td>
                            <span className="framing-tag">{s.framing}</span>
                            <p>{s.camera}</p>
                            <div className="cell-label">正反打 / 轴线</div>
                            <p>{s.coverage}</p>
                          </td>
                          <td>
                            <p>{s.lighting}</p>
                            <div className="cell-label">画风与美术</div>
                            <p>
                              {s.style} · {s.artDirection}
                            </p>
                          </td>
                          <td>
                            <p className="dialogue">
                              {s.dialogue.map((d, i) => (
                                <React.Fragment key={i}>
                                  {d.speaker}：“{d.text}”<br />
                                </React.Fragment>
                              ))}
                              {!s.dialogue.length && (
                                <span className="muted">无对白</span>
                              )}
                            </p>
                            <div className="cell-label">声音</div>
                            <p>
                              {s.ambience}
                              <br />
                              {s.sfx}
                            </p>
                            <small className="muted">{s.music}</small>
                          </td>
                          <td>
                            <button
                              className="secondary compact"
                              onClick={() => copy(s.prompt)}
                            >
                              <Copy size={14} />
                              复制提示词
                            </button>
                            <button
                              className="text-button edit-button"
                              disabled={project.status === "running"}
                              onClick={() => setSelected(s)}
                            >
                              展开 / 修改
                              <ChevronRight size={14} />
                            </button>
                            <button
                              className={cn(
                                "approve-button",
                                s.status === "approved" && "approved",
                              )}
                              disabled={
                                busy ||
                                (project.status === "running" &&
                                  !project.completedScenes?.includes(s.sceneIndex))
                              }
                              onClick={() => approve(s)}
                            >
                              <Check size={14} />
                              {s.status === "approved" ? "已通过" : "通过此镜"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filtered.length && (
                    <div className="empty-table">
                      <Clapperboard size={26} />
                      <p>
                        {project.status === "running"
                          ? "镜头正在准备中，完成后会出现在这里。"
                          : "当前筛选下没有镜头。"}
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div className="table-foot">
                <span>
                  {view === "board"
                    ? "按镜头顺序审核；机位、图片可单独保存。"
                    : "点击镜号，查看估时依据与完整提示词。"}
                </span>
                <span>
                  {project.isExample ? "预先编写的演示内容" : "已保存到服务端"}{" "}
                  ·{" "}
                  {new Date(project.updatedAt).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>
          )}
        </section>
      </main>
      <footer className="studio-footer"><span>Shot Mate · 把故事，画进下一镜。</span><span>时长按对白与表演估算，由你定稿。</span></footer>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {showHistory && (
        <Modal onClose={() => setShowHistory(false)}>
          <div className="modal-header">
            <h2>历史分镜</h2>
            <button
              className="icon-button"
              aria-label="关闭历史分镜"
              onClick={() => setShowHistory(false)}
            >
              <X />
            </button>
          </div>
          <div className="history-list">
            {projects.map((p) => (
              <button
                key={p.id}
                className="project-link"
                onClick={() => open(p.id)}
              >
                <FileText size={17} />
                <span>
                  <strong>{p.title}</strong>
                  <small>
                    {p.isExample ? "预写示例" : projectStatus[p.status]} ·{" "}
                    {p.shots} 镜
                  </small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
            {!projects.length && (
              <p className="muted">生成后的分镜会自动保存在这里。</p>
            )}
          </div>
        </Modal>
      )}
      {showSettings && settings && (
        <Settings
          value={settings}
          initialSection={settingsSection}
          onClose={() => setShowSettings(false)}
          onSave={(s) => {
            setSettings(s);
            notify("模型配置已保存");
          }}
        />
      )}
      {selected && (
        <ShotEditor
          shot={selected}
          project={project}
          onClose={() => setSelected(null)}
          onSave={async (s) => {
            const p = await updateShot(s);
            notify("已保存，提示词同步更新");
            return p.shots.find((x) => x.id === s.id);
          }}
          onCopy={copy}
        />
      )}
    </div>
  );
}
function Logo() {
  return (
    <a className="logo" href="#workspace" aria-label="Shot Mate · 分镜工作台">
      <span className="shotmate-wordmark"><img src="/shotmate/wordmark.png" alt="Shot Mate" width="2172" height="724" /></span>
    </a>
  );
}
function Modal({ children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal drawer" : "modal"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
function Settings({ value, initialSection, onClose, onSave }) {
  const [form, setForm] = useState({
      provider: value.provider,
      openai: { model: value.openai.model, baseUrl: value.openai.baseUrl, key: "" },
      doubao: { model: value.doubao.model, baseUrl: value.doubao.baseUrl, key: "" },
      image: {
        model: value.image.model,
        baseUrl: value.image.baseUrl,
        useTextKey: value.image.useTextKey,
        key: "",
      },
    }),
    [section, setSection] = useState(initialSection),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function save() {
    setError("");
    setBusy(true);
    try {
      const s = await api("/settings", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      onSave(s);
      setForm((f) => ({
        ...f,
        openai: { ...f.openai, key: "" },
        doubao: { ...f.doubao, key: "" },
        image: { ...f.image, key: "" },
      }));
      setMessage("已保存。密钥不会返回浏览器。");
      return s;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    if (!(await save())) return;
    setBusy(true);
    try {
      const r = await post("/settings/test", { provider: form.provider });
      setMessage(
        r.ok ? "连接成功，可以生成分镜。" : "模型已响应，但未通过格式测试。",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal onClose={onClose}>
      <div className="modal-header">
        <div>
          <div className="eyebrow">WORKSPACE SETTINGS</div>
          <h2>模型设置</h2>
        </div>
        <button className="icon-button" aria-label="关闭设置" onClick={onClose}>
          <X />
        </button>
      </div>
      <p className="modal-description">
        文字模型负责拆镜与提示词；图片模型用于逐镜生图，可分别切换。
      </p>
      <div className="settings-sections" role="tablist" aria-label="API 类型">
        <button role="tab" aria-selected={section === "text"} className={section === "text" ? "active" : ""} onClick={() => setSection("text")}>文字 API</button>
        <button role="tab" aria-selected={section === "image"} className={section === "image" ? "active" : ""} onClick={() => setSection("image")}>图片 API <span>{value.image.configured ? "已配置" : "待配置"}</span></button>
      </div>
      {section === "text" && <>
      <details className="rule-library">
        <summary>导演规则库 · Higgsfield Skills</summary>
        <p>OSideMedia 社区版，已随项目保存；由下方选择的文字模型执行。</p>
        <ul>
          <li>shotlist-director — 分镜与连续性</li>
          <li>acting — 人物目标、行为与反应</li>
          <li>camera — 景别、机位与运镜</li>
          <li>style — 画风、调色与光线</li>
          <li>audio — 对白、环境声、音效与配乐</li>
        </ul>
        <p>
          按阶段加载原文创作规则，另加原文保留、中文表格和自然估时要求。不预设总时长，也不按
          15 秒硬切。
        </p>
        <a
          href="https://github.com/OSideMedia/higgsfield-ai-prompt-skill"
          target="_blank"
          rel="noreferrer"
        >
          查看规则来源 ↗
        </a>
      </details>
      <div className="provider-tabs">
        {Object.entries(providers).map(([n, l]) => (
          <button
            key={n}
            onClick={() => setForm({ ...form, provider: n })}
            className={form.provider === n ? "active" : ""}
          >
            {l}
            <span>{value[n].configured ? "已配置" : "待配置"}</span>
          </button>
        ))}
      </div>
      {["openai", "doubao"].map((n) => (
        <div key={n} hidden={form.provider !== n} className="provider-form">
          {n === "openai" && <div className="model-preset-group">
            <span>快捷选择文字模型</span>
            <div className="model-presets">{textModelPresets.map(({ id, name }) => <button key={id} type="button" className={form[n].model === id ? "active" : ""} onClick={() => setForm({ ...form, [n]: { ...form[n], model: id } })}>{name}<small>{id}</small></button>)}</div>
          </div>}
          <label>
            模型 ID
            <input
              placeholder={
                n === "openai"
                  ? "填写 ToAPIs 上可用的文字模型 ID"
                  : "填写豆包模型 ID 或 ep-… 推理接入点"
              }
              value={form[n].model}
              onChange={(e) =>
                setForm({ ...form, [n]: { ...form[n], model: e.target.value } })
              }
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              autoComplete="new-password"
              placeholder={
                value[n].hasKey ? "已配置，留空保留现有密钥" : "仅保存至服务端"
              }
              value={form[n].key}
              onChange={(e) =>
                setForm({ ...form, [n]: { ...form[n], key: e.target.value } })
              }
            />
          </label>
          <label>
            API Base URL
            <input
              value={form[n].baseUrl}
              onChange={(e) => setForm({ ...form, [n]: { ...form[n], baseUrl: e.target.value } })}
              placeholder={n === "openai" ? "https://toapis.cn/v1" : "https://ark.cn-beijing.volces.com/api/v3"}
            />
          </label>
          <p className="field-note">
            {value[n].envManaged
              ? "当前环境变量优先于页面配置。"
              : n === "openai"
                ? "使用 OpenAI 兼容接口；可填 ToAPIs 上其他支持 Chat Completions 和 JSON 的模型。DeepSeek Flash 已通过连接测试，完整分镜仍需验证。"
                : "使用火山方舟官方 API（北京区域）。模型需要支持 JSON 输出。"}
          </p>
        </div>
      ))}
      </>}
      {section === "image" && (
        <div className="provider-form image-provider-form">
          <p className="field-note">支持 ToAPIs 的异步图片接口。选择模型后，在故事板里逐镜点击“生成图片”；不会自动批量生图。</p>
          <div className="model-preset-group">
            <span>快捷选择图片模型</span>
            <div className="model-presets">{imageModelPresets.map(({ id, name }) => <button key={id} type="button" className={form.image.model === id ? "active" : ""} onClick={() => setForm({ ...form, image: { ...form.image, model: id } })}>{name}<small>{id}</small></button>)}</div>
          </div>
          <label>
            图片模型 ID
            <input
              list="image-model-options"
              value={form.image.model}
              onChange={(e) => setForm({ ...form, image: { ...form.image, model: e.target.value } })}
              placeholder="例如 gpt-image-2"
            />
            <datalist id="image-model-options">
              <option value="gpt-image-2" />
              <option value="gpt-image-2-official" />
              <option value="qwen-image-3.0" />
              <option value="qwen-image-3.0-pro" />
              <option value="doubao-seedream-5-0" />
            </datalist>
          </label>
          <label>
            图片 API Base URL
            <input
              value={form.image.baseUrl}
              onChange={(e) => setForm({ ...form, image: { ...form.image, baseUrl: e.target.value } })}
              placeholder="https://toapis.cn/v1"
            />
          </label>
          <label className="image-key-choice">
            <input
              type="checkbox"
              checked={form.image.useTextKey}
              onChange={(e) => setForm({ ...form, image: { ...form.image, useTextKey: e.target.checked } })}
            />
            复用 ToAPIs / 兼容文字 API 的密钥
          </label>
          {!form.image.useTextKey && (
            <label>
              图片 API Key
              <input
                type="password"
                autoComplete="new-password"
                value={form.image.key}
                placeholder={value.image.hasKey ? "已配置，留空保留现有密钥" : "仅保存至服务端"}
                onChange={(e) => setForm({ ...form, image: { ...form.image, key: e.target.value } })}
              />
            </label>
          )}
          <p className="field-note">图片生成按所选模型计费。不同模型速度受平台排队、模型处理和图片复杂度影响；其他模型需支持 ToAPIs 图片任务接口。</p>
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="form-message" role="status">
          {message}
        </div>
      )}
      <div className="settings-foot">
        <p>
          {section === "text" ? "测试连接会产生一次少量文字模型调用。" : "保存后可在故事板中按镜头生成图片。"}
          <br />
          使用 Higgsfield 社区 Skills，不调用其付费 API。
        </p>
        <div>
          {section === "text" && <button className="secondary" disabled={busy} onClick={test}>
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Play size={14} />
            )}
            保存并测试
          </button>}
          <button className="primary" disabled={busy} onClick={save}>
            保存配置
          </button>
        </div>
      </div>
    </Modal>
  );
}
const editFields = [
  ["description", "画面描述"],
  ["purpose", "镜头目的 / 切镜理由"],
  ["performance", "人物表演"],
  ["framing", "景别 / 机位 / 焦点"],
  ["camera", "运镜 / 起幅与落幅"],
  ["coverage", "正反打 / 视线与轴线"],
  ["style", "画风 / 局部风格"],
  ["artDirection", "美术 / 空间 / 道具"],
  ["lighting", "光线 / 氛围"],
  ["ambience", "环境声"],
  ["sfx", "音效 / 触发点"],
  ["music", "配乐"],
  ["continuityIn", "起始状态"],
  ["continuityOut", "结束状态"],
  ["timingReason", "时长估算依据"],
];
function ShotEditor({ shot, project, onClose, onSave, onCopy }) {
  const [draft, setDraft] = useState({ ...shot }),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState("edit");
  function change(k, v) {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const s = await onSave(draft);
      setDraft(s);
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (dirty && !window.confirm("有未保存的修改，确定离开？")) return;
    onClose();
  }
  return (
    <Modal onClose={close} wide>
      <div className="modal-header">
        <div>
          <div className="eyebrow">SHOT DETAIL</div>
          <h2>
            {shot.id}{" "}
            <span className="detail-time">
              {draft.timing.seconds} 秒 · 估算
            </span>
          </h2>
        </div>
        <button className="icon-button" aria-label="关闭镜头" onClick={close}>
          <X />
        </button>
      </div>
      <div className="drawer-tabs">
        <button
          className={tab === "edit" ? "active" : ""}
          onClick={() => setTab("edit")}
        >
          分镜详情
        </button>
        <button
          className={tab === "prompt" ? "active" : ""}
          onClick={() => setTab("prompt")}
        >
          完整提示词
        </button>
      </div>
      <div className="drawer-body">
        {tab === "edit" ? (
          <>
            <div className="original-box">
              <span>对应剧本 · 原文保留</span>
              {shot.source.map((l) => (
                <p key={l.id}>
                  <small>L{l.id}</small>
                  {l.text}
                </p>
              ))}
            </div>
            <div className="edit-grid">
              {editFields.map(([k, l]) => (
                <label
                  key={k}
                  className={
                    [
                      "description",
                      "performance",
                      "lighting",
                      "timingReason",
                    ].includes(k)
                      ? "full"
                      : ""
                  }
                >
                  {l}
                  <textarea
                    value={draft[k]}
                    rows={k === "description" ? 3 : 2}
                    onChange={(e) => change(k, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="timing-editor">
              <h3>
                时长构成 <span>未实测</span>
              </h3>
              <div>
                {[
                  ["speakingCps", "对白单位 / 秒"],
                  ["actionSeconds", "动作秒数"],
                  ["pauseSeconds", "独立停顿秒数"],
                ].map(([k, l]) => (
                  <label key={k}>
                    {l}
                    <input
                      type="number"
                      min={k === "speakingCps" ? 1 : 0}
                      max={
                        k === "speakingCps"
                          ? 9
                          : k === "actionSeconds"
                            ? 180
                            : 60
                      }
                      step="0.1"
                      value={draft[k]}
                      onChange={(e) => change(k, Number(e.target.value))}
                    />
                  </label>
                ))}
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={draft.overlap}
                  onChange={(e) => change("overlap", e.target.checked)}
                />
                动作与对白同时发生（取较长者，再加独立停顿）
              </label>
              <small>对白单位按中文字 / 英文词计。保存后重新估算秒数。</small>
            </div>
            <div className="dialogue-box">
              <h3>对白原句</h3>
              {draft.dialogue.length ? (
                draft.dialogue.map((d, i) => (
                  <p key={i}>
                    <b>{d.speaker}</b> {d.text}
                    <small>原文 L{d.sourceLine}</small>
                  </p>
                ))
              ) : (
                <p>此镜无对白</p>
              )}
              <small>第一版锁定原对白，避免在修改拍法时意外改写剧本。</small>
            </div>
          </>
        ) : (
          <>
            {dirty && (
              <div className="form-message">
                请先保存修改，再复制同步后的提示词。
              </div>
            )}
            <pre className="prompt-text">{draft.prompt}</pre>
            <button
              className="secondary"
              disabled={dirty}
              onClick={() => onCopy(draft.prompt)}
            >
              <Copy size={15} />
              复制完整提示词
            </button>
          </>
        )}
        {error && <div className="form-error">{error}</div>}
      </div>
      <div className="drawer-footer">
        <span>
          {dirty ? "修改尚未保存；保存后恢复待审" : "分镜与提示词已同步"}
        </span>
        <button
          className="primary"
          disabled={busy || !dirty || project.status === "running"}
          onClick={save}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Check size={16} />
          )}
          保存修改
        </button>
      </div>
    </Modal>
  );
}
createRoot(document.getElementById("root")).render(<App />);
