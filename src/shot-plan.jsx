import React, { useEffect, useRef, useState } from "react";
import { Map, X, LoaderCircle } from "lucide-react";
import { FloorPlan, StoryFrame, blankBlocking } from "./storyboard.jsx";
import { syncBlocking } from "../shared/blocking.js";

export function ShotPlan({ shot, project, onSave, onGenerate, onClose, onDirtyChange }) {
  const [blocking, setBlocking] = useState(shot.blocking || null);
  const [dragging, setDragging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const root = useRef(null), latest = useRef({ shot, onSave });
  latest.current = { shot, onSave };
  const locked = saving || generating || project.status === "running";
  const view = blocking ? syncBlocking(shot, blocking) : shot;
  useEffect(() => { root.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);
  useEffect(() => {
    onDirtyChange(dirty || saving || generating);
    const warn = e => { if (dirty || saving) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); onDirtyChange(false); };
  }, [dirty, saving, generating, onDirtyChange]);
  useEffect(() => {
    if (!dirty || dragging || saving || error || !blocking) return;
    const timer = setTimeout(async () => {
      setSaving(true);
      try {
        await latest.current.onSave(syncBlocking(latest.current.shot, blocking));
        setDirty(false);
        setSaved(true);
      } catch (e) { setError(e.message); }
      finally { setSaving(false); }
    }, 700);
    return () => clearTimeout(timer);
  }, [blocking, dirty, dragging, saving, error]);
  function change(value) { setBlocking(value); setDirty(true); setSaved(false); setError(""); }
  async function generate() {
    setGenerating(true); setError("");
    try { change(await onGenerate(shot)); }
    catch (e) { setError(e.message); }
    finally { setGenerating(false); }
  }
  return <section className="inline-plan" ref={root} aria-label={`${shot.id} 机位编辑`}>
    <header className="inline-plan-header">
      <div><Map size={18}/><strong>{shot.id} · 机位图</strong></div>
      <div><span role="status">{generating ? "正在规划此镜…" : saving ? "正在同步…" : error ? "未保存" : dirty ? "等待同步…" : saved ? "已同步到分镜表与提示词" : "仅编辑这一镜"}</span>
        <button className="icon-button" aria-label="收起机位图" disabled={dirty || locked} onClick={onClose}><X size={18}/></button></div>
    </header>
    {blocking ? <div className="inline-plan-grid">
      <div><p className="field-note">拖动相机、十字朝向或人物。也可选中后用方向键微调；停下后自动同步。</p>
        <FloorPlan value={blocking} onChange={change} readonly={locked} onInteraction={setDragging}/></div>
      <aside className="plan-live-preview">
        <h3>当前机位 · 构图示意</h3>
        <StoryFrame shot={{ ...view, storyboardImage: undefined }} aspect={project.aspect}/>
        <p className="field-note">简化人物位置示意，非真实镜头预览。已有分镜图片不会自动重绘。</p>
        <h4>摄影与运镜</h4><p>{view.camera}</p>
        <h4>人物站位与轴线</h4><p>{view.coverage}</p>
      </aside>
    </div> : <div className="plan-on-demand">
      <Map size={28}/><h3>需要这一镜的机位，再展开规划。</h3>
      <p>按本镜文字安排摄影机、人物和朝向；生成后可以直接拖动调整。</p>
      <button className="primary" disabled={locked} onClick={generate}>{generating && <LoaderCircle size={16} className="spin"/>}{generating ? "规划中…" : "生成此镜机位图"}</button>
      <button className="text-button" disabled={locked} onClick={() => change(blankBlocking())}>手动建立草图</button>
      <small>生成机位使用一次文字模型调用，不调用图片模型。</small>
    </div>}
    {error && <div className="form-error" role="alert">{error} {dirty && <button className="secondary compact" onClick={() => setError("")}>重试同步</button>}</div>}
    {dirty && !saving && <button className="text-button" onClick={() => { setBlocking(shot.blocking || null); setDirty(false); setError(""); }}>撤销未保存的调整</button>}
  </section>;
}
