import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Clapperboard,
  Plus,
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
  PanelLeftClose,
  Film,
  Clock3,
  CheckCheck,
  BookOpen,
  RotateCcw,
  Square,
  Eye,
  Sparkles,
} from "lucide-react";
import "./style.css";
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
const providers = { openai: "GPT", doubao: "豆包" };
function App() {
  const [session, setSession] = useState(null),
    [password, setPassword] = useState(""),
    [projects, setProjects] = useState([]),
    [project, setProject] = useState(null),
    [settings, setSettings] = useState(null),
    [showSettings, setShowSettings] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [side, setSide] = useState(
      () => !window.matchMedia("(max-width:800px)").matches,
    ),
    [selected, setSelected] = useState(null),
    [filter, setFilter] = useState("all"),
    [sceneFilter, setSceneFilter] = useState("all");
  const [title, setTitle] = useState(""),
    [script, setScript] = useState(""),
    [style, setStyle] = useState("写实影像，具体光色和氛围依剧本判断"),
    [aspect, setAspect] = useState("9:16");
  const upload = useRef();
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
    if (project?.status !== "running") return;
    const id = setInterval(async () => {
      try {
        const p = await api("/projects/" + project.id);
        setProject(p);
        if (p.status !== "running") load();
      } catch (e) {
        setError(e.message);
      }
    }, 1800);
    return () => clearInterval(id);
  }, [project?.id, project?.status]);
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
    await act(async () => {
      setProject(await api("/projects/" + id));
      setSelected(null);
      setFilter("all");
      setSceneFilter("all");
      if (window.matchMedia("(max-width:800px)").matches) setSide(false);
    });
  }
  async function generate(e) {
    e.preventDefault();
    if (!settings?.[settings.provider]?.configured) {
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
    await act(async () => {
      setProject(await post("/example"));
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
          <h1>进入分镜工作台</h1>
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
    <div className={cn("app", !side && "collapsed")}>
      {side && (
        <button
          className="mobile-nav-backdrop"
          aria-label="收起项目列表"
          onClick={() => setSide(false)}
        />
      )}
      <aside className="sidebar">
        <Logo />
        <button
          className="new-project"
          onClick={() => {
            setProject(null);
            setSelected(null);
            setError("");
            if (window.matchMedia("(max-width:800px)").matches) setSide(false);
          }}
        >
          <Plus size={17} /> 新建分镜
        </button>
        <div className="nav-label">
          我的剧本 <span>{projects.length}</span>
        </div>
        <nav>
          {projects.map((p) => (
            <button
              key={p.id}
              className={cn("project-link", project?.id === p.id && "active")}
              onClick={() => open(p.id)}
            >
              <FileText size={16} />
              <span>
                <strong>{p.title}</strong>
                <small>
                  {p.isExample ? "示例项目" : projectStatus[p.status]} ·{" "}
                  {p.shots} 镜
                </small>
              </span>
            </button>
          ))}
          {!projects.length && (
            <p className="nav-empty">
              你的剧本与分镜
              <br />
              会保存在这里。
            </p>
          )}
        </nav>
        <div className="side-bottom">
          <span className="rule-dot" /> 导演 · 摄影 · 美术 · 声音
          <small>一份剧本，一套连贯的拍法。</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button"
              aria-label="切换侧栏"
              onClick={() => setSide(!side)}
            >
              <PanelLeftClose size={18} />
            </button>
            <span>创作工作台</span>
            <ChevronRight size={14} />
            <strong>{project?.title || "新建分镜"}</strong>
          </div>
          <button
            className="model-button"
            onClick={() => setShowSettings(true)}
          >
            <span
              className={cn(
                "dot",
                settings?.[settings?.provider]?.configured && "online",
              )}
            />
            {providers[settings?.provider] || "模型"}
            {settings?.[settings?.provider]?.configured ? " 已配置" : " 待配置"}
            <Settings2 size={15} />
          </button>
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
        {!project ? (
          <div className="new-view">
            <div className="intro">
              <div className="eyebrow">
                <span /> LIPA DIRECTOR'S DESK
              </div>
              <h1>让剧本，成为镜头。</h1>
              <p>放入剧本。把画面、表演、光线与声音，一起想清楚。</p>
            </div>
            <form onSubmit={generate} className="composer">
              <section className="script-pane">
                <div className="pane-heading">
                  <h2>
                    <FileText size={19} /> 输入剧本
                  </h2>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => upload.current.click()}
                  >
                    <Upload size={15} /> 导入文件
                  </button>
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
                </div>
                <input
                  className="title-input"
                  aria-label="剧本名称"
                  placeholder="给这个故事一个名字（选填）"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={100}
                />
                <textarea
                  className="script-input"
                  aria-label="剧本正文"
                  placeholder={
                    "在这里粘贴完整剧本…\n\n场次、动作、对白都可以直接保留。\n系统会按戏剧动作拆镜，并保留每个镜头对应的原文。"
                  }
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  maxLength={30000}
                  required
                  minLength={10}
                />
                <div className="script-footer">
                  <span>支持 TXT / Markdown / Word</span>
                  <span>{script.length.toLocaleString()} / 30,000 字符</span>
                </div>
              </section>
              <aside className="brief-pane">
                <div className="pane-heading">
                  <h2>拍摄设定</h2>
                  <span className="optional">可选</span>
                </div>
                <label>
                  画幅
                  <div className="aspect-options">
                    {["9:16", "16:9", "1:1"].map((x) => (
                      <button
                        type="button"
                        key={x}
                        className={cn(aspect === x && "selected")}
                        onClick={() => setAspect(x)}
                      >
                        <span style={{ aspectRatio: x.replace(":", "/") }} />
                        {x}
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  画风与整体风格
                  <textarea
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                    rows={3}
                    maxLength={1000}
                  />
                </label>
                <div className="auto-timing">
                  <span>时长 · 自动估算</span>
                  <p>根据对白语速、动作与表演停顿逐镜判断，再汇总整段时长。</p>
                </div>
                <div className="brief-note">
                  <Eye size={16} />
                  <p>
                    保留原对白和剧情。
                    <br />
                    生成后，每一镜都可以修改、审核。
                  </p>
                </div>
              </aside>
              <div className="composer-bottom">
                <span>
                  <span className="tiny-square" /> Higgsfield Skills · 导演 /
                  表演 / 摄影 / 风格 / 声音
                </span>
                <button
                  className="primary"
                  disabled={busy || script.trim().length < 10}
                >
                  {busy ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <Sparkles size={17} />
                  )}
                  生成分镜
                  <ArrowRight size={17} />
                </button>
              </div>
            </form>
            <div className="example-line">
              <div>
                <span className="sample-label">先看成品</span>
                <strong>一场深夜的办公室对话，如何拆成四个镜头？</strong>
                <p>查看表格、逐镜修改与完整提示词。此为预先编写的示例。</p>
              </div>
              <button className="secondary" onClick={example} disabled={busy}>
                打开示例 <ArrowUpRight size={16} />
              </button>
            </div>
            <div className="output-preview">
              <div>
                <span>01</span>
                <h3>看清每一镜</h3>
                <p>画面、表演与摄影，共同服务这场戏。</p>
              </div>
              <div>
                <span>02</span>
                <h3>始终对照原文</h3>
                <p>对白有出处，切镜有理由，时长有依据。</p>
              </div>
              <div>
                <span>03</span>
                <h3>审核后交给制作</h3>
                <p>复制提示词，或导出完整分镜表。</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="project-view">
            <div className="project-heading">
              <div>
                <div className="eyebrow">
                  STORYBOARD /{" "}
                  {project.isExample
                    ? "示例 · 非实时模型生成"
                    : providers[project.provider?.name] || "导演分镜"}
                </div>
                <h1>{project.title}</h1>
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
                  {project.shots.filter((s) => s.status === "approved").length}{" "}
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
                  <p>你可以离开页面，任务会在本地服务运行期间继续。</p>
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
                      setProject(await post(`/projects/${project.id}/resume`));
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
                    onClick={() => setFilter(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <select
                aria-label="筛选场次"
                value={sceneFilter}
                onChange={(e) => setSceneFilter(e.target.value)}
              >
                <option value="all">全部场次</option>
                {project.outline?.scenes.map((s, i) => (
                  <option value={i} key={i}>
                    第 {i + 1} 场 · {s.name}
                  </option>
                ))}
              </select>
            </div>
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
                          disabled={busy || project.status === "running"}
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
            <div className="table-foot">
              <span>点击镜号，查看估时依据与完整提示词。</span>
              <span>
                {project.isExample ? "预先编写的演示内容" : "已保存到服务端"} ·{" "}
                {new Date(project.updatedAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </div>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {showSettings && settings && (
        <Settings
          value={settings}
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
    <div className="logo">
      <div className="logo-symbol">
        <span />
        <span />
        <span />
      </div>
      <strong>
        LIPA<span>分镜工作台</span>
      </strong>
    </div>
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
function Settings({ value, onClose, onSave }) {
  const [form, setForm] = useState({
      provider: value.provider,
      openai: { model: value.openai.model, key: "" },
      doubao: { model: value.doubao.model, key: "" },
    }),
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
        配置一次，创作时自动使用。新任务按当前模型运行。
      </p>
      <details className="rule-library">
        <summary>导演规则库 · Higgsfield Skills</summary>
        <p>OSideMedia 社区版，已随项目保存；由下方选择的 GPT 或豆包执行。</p>
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
          <label>
            模型 ID
            <input
              placeholder={
                n === "openai"
                  ? "填写账户可用的 GPT 模型 ID"
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
          <p className="field-note">
            {value[n].envManaged
              ? "当前环境变量优先于页面配置。"
              : n === "openai"
                ? "使用 OpenAI 官方 API；ChatGPT 会员不等于 API 额度。"
                : "使用火山方舟官方 API（北京区域）。模型需要支持 JSON 输出。"}
          </p>
        </div>
      ))}
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
          测试连接会产生一次少量模型调用。
          <br />
          使用 Higgsfield 社区 Skills，不调用其付费 API。
        </p>
        <div>
          <button className="secondary" disabled={busy} onClick={test}>
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Play size={14} />
            )}
            保存并测试
          </button>
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
