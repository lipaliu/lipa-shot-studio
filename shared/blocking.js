// Shared by the editor and server so the visible preview matches persisted text.
const marker = "【机位同步】";
const point = (p) => `(${p.x}, ${p.y})`;
const base = (text = "") => text.split(marker)[0].trim();
export function blockingText(b) {
  const c = b.camera;
  const actors = b.actors.map(a => `${a.name}${point(a)}`).join("；") || "未标注人物";
  let axis = "未建立双人轴线";
  if (b.actors.length >= 2) {
    const [a, d] = b.actors;
    const cross = (d.x-a.x)*(c.y-a.y)-(d.y-a.y)*(c.x-a.x);
    axis = `${a.name}→${d.name}为轴，摄影机位于${Math.abs(cross) < 1 ? "轴线上" : cross > 0 ? "图面顺时针侧" : "图面逆时针侧"}`;
  }
  return {
    camera: `俯视相对坐标：摄影机${point(c)}，朝向(${c.targetX}, ${c.targetY})。`,
    coverage: `人物站位：${actors}。${axis}；相邻镜头仍需核对连续性。`,
    lighting: `主光位置${point(b.light)}；图面上方为场景上侧，不代表地理北方。`,
  };
}
export function syncBlocking(shot, blocking) {
  const summary = blockingText(blocking);
  return { ...shot, blocking,
    ...Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, `${base(shot[k])}\n${marker}${v}`])),
  };
}
