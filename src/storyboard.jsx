import React, { useEffect, useRef, useState, useId } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Copy,
  ImagePlus,
  Map,
  Maximize2,
  Save,
  X,
} from "lucide-react";

export const blankBlocking = () => ({
  actors: [],
  props: [],
  camera: { x: 50, y: 85, targetX: 50, targetY: 40 },
  light: { x: 80, y: 20 },
  note: "手动机位草图；相对位置，非实测尺寸。",
});
const clamp = (n) => Math.min(95, Math.max(5, Math.round(n)));
const colors = ["#d5b56f", "#87b5c6", "#c5a5cf", "#a5c693"];

// A deliberately schematic composition. Uploaded art always takes precedence.
export function StoryFrame({ shot, aspect = "16:9", small = false }) {
  const id = useId().replace(/:/g, "");
  if (shot.storyboardImage)
    return (
      <img
        className="story-image"
        src={shot.storyboardImage}
        alt={`${shot.id} 分镜图`}
      />
    );
  const W = aspect === "9:16" ? 360 : 640,
    H = aspect === "9:16" ? 640 : aspect === "1:1" ? 640 : 360;
  const actors = shot.blocking?.actors || [];
  const close = /近景|特写|CU/.test(shot.framing),
    pair = /双人|全景|远景/.test(shot.framing);
  const camera = shot.blocking?.camera;
  const dx = camera ? camera.targetX - camera.x : 0,
    dy = camera ? camera.targetY - camera.y : -1;
  const len = Math.hypot(dx, dy) || 1;
  const ordered = actors
    .map((a, i) => ({
      ...a,
      i,
      across:
        ((a.x - camera.targetX) * -dy + (a.y - camera.targetY) * dx) / len,
      depth: Math.hypot(a.x - camera.x, a.y - camera.y),
    }))
    .sort((a, b) => b.depth - a.depth);
  return (
    <svg
      className="story-frame"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${shot.id} 构图占位示意，非生成分镜图`}
    >
      <defs>
        <pattern
          id={`grid-${id}`}
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <path d="M40 0H0V40" fill="none" stroke="#34332f" strokeWidth="1" />
        </pattern>
        <clipPath id={`clip-${id}`}>
          <rect width={W} height={H} rx="4" />
        </clipPath>
      </defs>
      <g clipPath={`url(#clip-${id})`}>
        <rect width={W} height={H} fill="#20211f" />
        <rect width={W} height={H} fill={`url(#grid-${id})`} />
        <path
          d={`M0 ${H * 0.68}H${W}M${W / 3} 0V${H}M${(W * 2) / 3} 0V${H}`}
          stroke="#6a6658"
          strokeDasharray="4 8"
          opacity=".45"
        />
        {ordered.map((a) => {
          const x = Math.max(
            65,
            Math.min(
              W - 65,
              W / 2 + a.across * (W / 640) * (close && !pair ? 8 : 5),
            ),
          );
          const scale = close && !pair ? 1.55 : 0.95;
          return (
            <g
              key={a.i}
              transform={`translate(${x} ${H * 0.43}) scale(${scale})`}
            >
              <circle r="33" fill={colors[a.i % colors.length]} opacity=".78" />
              <path
                d={`M-30 44Q0 30 30 44L55 ${(H * 0.65) / scale}H-55Z`}
                fill={colors[a.i % colors.length]}
                opacity=".45"
              />
              {!small && (
                <text y="-48" textAnchor="middle" fill="#f2eee4" fontSize="17">
                  {a.name}
                </text>
              )}
            </g>
          );
        })}
        {!actors.length && (
          <text
            x={W / 2}
            y={H / 2}
            fill="#bdb8aa"
            fontSize="22"
            textAnchor="middle"
          >
            等待分镜图
          </text>
        )}
        <rect
          x="0"
          y={H - 36}
          width={W}
          height="36"
          fill="#141513"
          opacity=".95"
        />
        <text x="18" y={H - 12} fill="#ddd4c2" fontSize="15">
          {small ? shot.id : "构图示意 · 非生成画面"}
        </text>
        <text
          x={W - 18}
          y={H - 12}
          fill="#ddd4c2"
          fontSize="15"
          textAnchor="end"
        >
          {aspect}
        </text>
      </g>
    </svg>
  );
}

export function FloorPlan({ value, onChange, readonly = false }) {
  const svg = useRef(),
    drag = useRef(null),
    [object, setObject] = useState("camera");
  const id = useId().replace(/:/g, "");
  if (!value)
    return (
      <div className="plan-empty">
        <Map size={32} />
        <p>这份旧分镜还没有机位数据</p>
        <small>可手动建立草图；新生成的分镜会请求模型提供站位。</small>
        {!readonly && (
          <button
            className="secondary"
            onClick={() => onChange(blankBlocking())}
          >
            创建机位草图
          </button>
        )}
      </div>
    );
  function move(key, x, y) {
    x = clamp(x);
    y = clamp(y);
    if (key.startsWith("actor-"))
      onChange({
        ...value,
        actors: value.actors.map((a, i) =>
          i === Number(key.slice(6)) ? { ...a, x, y } : a,
        ),
      });
    else if (key.startsWith("prop-"))
      onChange({
        ...value,
        props: value.props.map((a, i) =>
          i === Number(key.slice(5)) ? { ...a, x, y } : a,
        ),
      });
    else if (key === "target")
      onChange({
        ...value,
        camera: { ...value.camera, targetX: x, targetY: y },
      });
    else onChange({ ...value, [key]: { ...value[key], x, y } });
  }
  const item = object.startsWith("actor-")
    ? value.actors[Number(object.slice(6))]
    : object.startsWith("prop-")
      ? value.props[Number(object.slice(5))]
      : object === "target"
        ? { x: value.camera.targetX, y: value.camera.targetY }
        : value[object];
  function start(e, key) {
    if (readonly) return;
    setObject(key);
    drag.current = key;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointer(e) {
    if (!drag.current) return;
    const point = svg.current.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const p = point.matrixTransform(svg.current.getScreenCTM().inverse());
    move(drag.current, p.x / 6, p.y / 4);
  }
  function keyMove(e, key, p) {
    if (readonly) return;
    const offsets = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (offsets[e.key]) {
      e.preventDefault();
      move(key, p.x + offsets[e.key][0], p.y + offsets[e.key][1]);
    }
  }
  const handle = (key, label, p) => ({
    tabIndex: readonly ? undefined : 0,
    role: readonly ? "img" : "button",
    "aria-label": label,
    onPointerDown: (e) => start(e, key),
    onKeyDown: (e) => keyMove(e, key, p),
    onClick: () => setObject(key),
    className: `plan-handle ${object === key ? "selected" : ""}`,
  });
  const c = value.camera,
    a = value.actors,
    angle =
      (Math.atan2((c.targetY - c.y) * 4, (c.targetX - c.x) * 6) * 180) /
      Math.PI;
  return (
    <div className="floor-plan">
      <svg
        ref={svg}
        className="plan-svg"
        viewBox="0 0 600 400"
        onPointerMove={pointer}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        role="group"
        aria-label="俯视机位图，相对站位非实测尺寸"
      >
        <defs>
          <pattern
            id={`plan-${id}`}
            width="30"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path d="M30 0H0V20" fill="none" stroke="#363833" />
          </pattern>
          <marker
            id={`arrow-${id}`}
            markerWidth="7"
            markerHeight="7"
            refX="5"
            refY="3.5"
            orient="auto"
          >
            <path d="M0 0L7 3.5L0 7" fill="#d5b56f" />
          </marker>
        </defs>
        <rect width="600" height="400" rx="10" fill="#20231f" />
        <rect
          x="18"
          y="12"
          width="564"
          height="376"
          rx="8"
          fill={`url(#plan-${id})`}
          stroke="#73796c"
          strokeWidth="3"
        />
        {value.props.map((p, i) => (
          <g key={i} {...handle(`prop-${i}`, `移动道具 ${p.name}`, p)}>
            <rect
              x={(p.x - p.width / 2) * 6}
              y={(p.y - p.height / 2) * 4}
              width={p.width * 6}
              height={p.height * 4}
              rx="5"
              fill="#4c4a3c"
              stroke="#92917d"
            />
            <text
              x={p.x * 6}
              y={(p.y - p.height / 2) * 4 - 10}
              textAnchor="middle"
              fill="#e1dccb"
              fontSize="16"
            >
              {p.name}
            </text>
          </g>
        ))}
        {a.length >= 2 && (
          <line
            x1={a[0].x * 6}
            y1={a[0].y * 4}
            x2={a[1].x * 6}
            y2={a[1].y * 4}
            stroke="#b48d9b"
            strokeDasharray="8 6"
            strokeWidth="2"
          />
        )}
        <line
          x1={c.x * 6}
          y1={c.y * 4}
          x2={c.targetX * 6}
          y2={c.targetY * 4}
          stroke="#d5b56f"
          strokeWidth="2"
          markerEnd={`url(#arrow-${id})`}
        />
        <g
          {...handle("target", "移动镜头朝向", { x: c.targetX, y: c.targetY })}
        >
          <circle
            cx={c.targetX * 6}
            cy={c.targetY * 4}
            r="13"
            fill="#22261f"
            stroke="#d5b56f"
            strokeDasharray="3 3"
          />
          <path
            d={`M${c.targetX * 6 - 6} ${c.targetY * 4}h12M${c.targetX * 6} ${c.targetY * 4 - 6}v12`}
            stroke="#d5b56f"
          />
        </g>
        {a.map((p, i) => (
          <g key={i} {...handle(`actor-${i}`, `移动人物 ${p.name}`, p)}>
            <circle
              cx={p.x * 6}
              cy={p.y * 4}
              r="20"
              fill={colors[i % colors.length]}
              stroke="#161815"
              strokeWidth="3"
            />
            <text
              x={p.x * 6}
              y={p.y * 4 + 5}
              textAnchor="middle"
              fill="#181b16"
              fontSize="15"
              fontWeight="700"
            >
              {i + 1}
            </text>
            <text
              x={p.x * 6}
              y={p.y * 4 + 39}
              textAnchor="middle"
              fill="#f1ecdf"
              fontSize="17"
            >
              {p.name}
            </text>
          </g>
        ))}
        <g {...handle("camera", "移动摄影机", c)}>
          <g transform={`translate(${c.x * 6} ${c.y * 4}) rotate(${angle})`}>
            <rect
              x="-14"
              y="-12"
              width="25"
              height="24"
              rx="4"
              fill="#d5b56f"
            />
            <path d="M12 -9L24 -15V15L12 9Z" fill="#d5b56f" />
          </g>
          <text
            x={c.x * 6}
            y={c.y * 4 + 33}
            fill="#f1ecdf"
            fontSize="16"
            textAnchor="middle"
          >
            机位
          </text>
        </g>
        <g {...handle("light", "移动主光", value.light)}>
          <circle
            cx={value.light.x * 6}
            cy={value.light.y * 4}
            r="16"
            fill="#dccd91"
          />
          <text
            x={value.light.x * 6}
            y={value.light.y * 4 + 5}
            fill="#26261a"
            textAnchor="middle"
            fontSize="14"
          >
            光
          </text>
        </g>
      </svg>
      <div className="plan-legend">
        <span>
          <i />
          相机与朝向
        </span>
        <span>虚线：前两位人物轴线</span>
        <span>相对位置 · 非实测</span>
      </div>
      {!readonly && (
        <div className="plan-controls">
          <label>
            调整对象
            <select
              aria-label="机位图对象"
              value={object}
              onChange={(e) => setObject(e.target.value)}
            >
              <option value="camera">摄影机</option>
              <option value="target">镜头朝向</option>
              <option value="light">主光</option>
              {a.map((p, i) => (
                <option key={i} value={`actor-${i}`}>
                  {p.name}
                </option>
              ))}
              {value.props.map((p, i) => (
                <option key={i} value={`prop-${i}`}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {item &&
            ["x", "y"].map((k) => (
              <label key={k}>
                {k.toUpperCase()}
                <input
                  aria-label={`位置 ${k.toUpperCase()}`}
                  type="number"
                  min="5"
                  max="95"
                  value={item[k]}
                  onChange={(e) =>
                    move(
                      object,
                      k === "x" ? +e.target.value : item.x,
                      k === "y" ? +e.target.value : item.y,
                    )
                  }
                />
              </label>
            ))}
          <button
            className="secondary"
            disabled={a.length >= 12}
            onClick={() => {
              onChange({
                ...value,
                actors: [...a, { name: `人物 ${a.length + 1}`, x: 35, y: 45 }],
              });
              setObject(`actor-${a.length}`);
            }}
          >
            ＋人物
          </button>
          {object.startsWith("actor-") && item && (
            <label className="plan-name">
              人物名
              <input
                maxLength="40"
                value={item.name}
                onChange={(e) =>
                  onChange({
                    ...value,
                    actors: a.map((p, i) =>
                      i === +object.slice(6)
                        ? { ...p, name: e.target.value }
                        : p,
                    ),
                  })
                }
              />
            </label>
          )}
          {object.startsWith("actor-") && (
            <button
              className="text-button"
              onClick={() => {
                onChange({
                  ...value,
                  actors: a.filter((_, i) => i !== +object.slice(6)),
                });
                setObject("camera");
              }}
            >
              移除人物
            </button>
          )}
        </div>
      )}
      <p className="plan-note">
        {value.note} 修改草图后，请同时核对摄影与轴线文字。
      </p>
    </div>
  );
}

export function Storyboard({
  shots,
  project,
  onSave,
  onEdit,
  onCopy,
  onApprove,
  busy,
  onDirtyChange,
}) {
  const [active, setActive] = useState(shots[0]?.id),
    [mode, setMode] = useState("frame");
  const shot = shots.find((s) => s.id === active) || shots[0];
  const [draft, setDraft] = useState(null),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const upload = useRef(),
    strip = useRef();
  useEffect(() => {
    onDirtyChange(dirty);
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      onDirtyChange(false);
    };
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    setDraft(shot ? structuredClone(shot) : null);
    setDirty(false);
    setError("");
  }, [shot]);
  useEffect(() => {
    const el = strip.current?.querySelector('[aria-current="true"]');
    if (el)
      strip.current.scrollTo({
        left: el.offsetLeft - strip.current.offsetLeft,
      });
  }, [shot?.id]);
  const view = draft?.id === shot?.id ? draft : shot;
  if (!view) return <div className="empty-table">当前筛选下没有镜头。</div>;
  const index = shots.findIndex((s) => s.id === shot.id),
    locked = project.status === "running" || saving;
  function change(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }
  function select(id) {
    if (dirty) {
      setError("请先保存镜头，或点击撤销修改，再切换镜头。");
      return;
    }
    setActive(id);
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(view);
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function image(file) {
    if (!file) return;
    try {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 2 * 1024 * 1024
      )
        throw new Error("请选择 2 MB 以内的 PNG、JPEG 或 WebP 图片。");
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error("图片读取失败"));
        r.readAsDataURL(file);
      });
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = () =>
          reject(new Error("图片无法打开，请换一张有效图片。"));
        img.src = data;
      });
      change("storyboardImage", data);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="storyboard-studio">
      <div className="board-title">
        <div>
          <span className="board-number">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <strong>{shot.id}</strong>
            <span>
              {project.outline?.scenes[shot.sceneIndex]?.name ||
                `第 ${shot.sceneIndex + 1} 场`}
            </span>
          </div>
        </div>
        <div className="board-meta">
          <span>{shot.timing.seconds} 秒</span>
          <span className={`status-pill ${shot.status}`}>
            {shot.status === "approved"
              ? "已通过"
              : shot.status === "changes"
                ? "待修改"
                : "待审核"}
          </span>
        </div>
      </div>
      <div className="board-workspace">
        <section className="board-stage">
          <div className="stage-toolbar">
            <div className="view-switch">
              <button
                aria-pressed={mode === "frame"}
                onClick={() => setMode("frame")}
              >
                <Maximize2 size={15} />
                故事板
              </button>
              <button
                aria-pressed={mode === "plan"}
                onClick={() => setMode("plan")}
              >
                <Map size={15} />
                机位图
              </button>
            </div>
            <span>
              {project.aspect} · {mode === "plan" ? "俯视" : "画面"}
            </span>
          </div>
          {mode === "frame" ? (
            <>
              <div className="main-frame">
                <StoryFrame shot={view} aspect={project.aspect} />
              </div>
              <div className="frame-caption">
                <Camera size={16} />
                <span>{shot.framing}</span>
              </div>
              <div className="frame-tools">
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={() => upload.current.click()}
                >
                  <ImagePlus size={16} />
                  {view.storyboardImage ? "替换分镜图" : "上传分镜图"}
                </button>
                {view.storyboardImage ? (
                  <button
                    className="text-button"
                    disabled={locked}
                    onClick={() => change("storyboardImage", undefined)}
                  >
                    <X size={14} />
                    移除图片
                  </button>
                ) : (
                  <span>未接生图 · 示意图用于组织镜头</span>
                )}
              </div>
              <input
                ref={upload}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  image(e.target.files[0]);
                  e.target.value = "";
                }}
              />
              <div className="board-description">
                <strong>这一镜发生什么</strong>
                <p>{shot.description}</p>
                {shot.dialogue.map((d, i) => (
                  <blockquote key={i}>
                    <b>{d.speaker}</b>“{d.text}”
                  </blockquote>
                ))}
              </div>
            </>
          ) : (
            <FloorPlan
              value={view.blocking}
              readonly={locked}
              onChange={(v) => change("blocking", v)}
            />
          )}
        </section>
        <aside className="shot-notes">
          <div className="notes-heading">
            镜头手记
            <button
              className="text-button"
              disabled={dirty || locked}
              onClick={() => onEdit(shot)}
            >
              编辑 <ArrowRight size={14} />
            </button>
          </div>
          {[
            ["performance", "人物表演"],
            ["camera", "摄影与运镜"],
            ["coverage", "正反打与轴线"],
            ["lighting", "氛围光线"],
            ["sfx", "音效"],
            ["timingReason", "估时依据"],
          ].map(([k, label]) => (
            <div className="note-section" key={k}>
              <h4>{label}</h4>
              <p>{shot[k]}</p>
            </div>
          ))}
          <details>
            <summary>原文 / 美术 / 完整声音</summary>
            <div className="note-section">
              {shot.source.map((l) => (
                <p key={l.id}>
                  L{l.id} · {l.text}
                </p>
              ))}
              <h4>画风与美术</h4>
              <p>
                {shot.style}；{shot.artDirection}
              </p>
              <h4>环境声 / 配乐</h4>
              <p>
                {shot.ambience}；{shot.music}
              </p>
            </div>
          </details>
        </aside>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="board-actions">
        <div>
          <button
            className="icon-button bordered"
            aria-label="上一镜"
            disabled={index === 0 || locked}
            onClick={() => select(shots[index - 1].id)}
          >
            <ArrowLeft size={17} />
          </button>
          <span>
            {index + 1} / {shots.length}
          </span>
          <button
            className="icon-button bordered"
            aria-label="下一镜"
            disabled={index === shots.length - 1 || locked}
            onClick={() => select(shots[index + 1].id)}
          >
            <ArrowRight size={17} />
          </button>
        </div>
        <div>
          {dirty ? (
            <>
              <button
                className="text-button"
                disabled={locked}
                onClick={() => {
                  setDraft(structuredClone(shot));
                  setDirty(false);
                  setError("");
                }}
              >
                撤销修改
              </button>
              <button className="primary" disabled={locked} onClick={save}>
                <Save size={15} />
                {saving ? "保存中…" : "保存镜头"}
              </button>
            </>
          ) : (
            <>
              <button className="secondary" onClick={() => onCopy(shot.prompt)}>
                <Copy size={15} />
                提示词
              </button>
              <button
                className="primary"
                disabled={busy || locked}
                onClick={() => onApprove(shot)}
              >
                <Check size={16} />
                {shot.status === "approved" ? "恢复待审" : "通过此镜"}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="filmstrip" ref={strip} aria-label="故事板镜头序列">
        {shots.map((s, i) => (
          <button
            key={s.id}
            className={`film-card ${s.id === shot.id ? "active" : ""}`}
            aria-current={s.id === shot.id}
            aria-label={`查看镜头 ${s.id}`}
            disabled={locked}
            onClick={() => select(s.id)}
          >
            <StoryFrame
              shot={s.id === shot.id ? view : s}
              small
              aspect={project.aspect}
            />
            <div>
              <strong>{String(i + 1).padStart(2, "0")}</strong>
              <span>{s.timing.seconds}s</span>
              {s.status === "approved" && <Check size={13} />}
            </div>
            <p>{s.purpose}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
