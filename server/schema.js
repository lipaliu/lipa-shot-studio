import { z } from "zod";
const text = z.string().max(12000);
const coordinate = z.number().finite().min(5).max(95);
const point = z.object({ x: coordinate, y: coordinate });
export const blockingSchema = z.object({
  actors: z.array(point.extend({ name: z.string().min(1).max(40) })).max(12),
  camera: point.extend({ targetX: coordinate, targetY: coordinate }),
  light: point,
  props: z
    .array(
      point.extend({
        name: z.string().min(1).max(40),
        width: z.number().min(5).max(60),
        height: z.number().min(5).max(60),
      }),
    )
    .max(12),
  note: z.string().max(1000),
});
export const storyboardImageSchema = z
  .string()
  .max(2800000)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
export const dialogueSchema = z.object({
  sourceLine: z.number().int().positive(),
  speaker: text,
  text: text.min(1),
});
export const shotSchema = z.object({
  blocking: blockingSchema.optional(),
  storyboardImage: storyboardImageSchema.optional(),
  sourceLines: z.array(z.number().int().positive()).min(1).max(300),
  purpose: text.min(1),
  description: text.min(1),
  performance: text.min(1),
  framing: text.min(1),
  camera: text.min(1),
  coverage: text.min(1),
  continuityIn: text.min(1),
  continuityOut: text.min(1),
  dialogue: z.array(dialogueSchema).max(100),
  speakingCps: z.number().min(1).max(9),
  actionSeconds: z.number().min(0).max(180),
  pauseSeconds: z.number().min(0).max(60),
  overlap: z.boolean(),
  timingReason: text.min(1),
  lighting: text.default("待补充"),
  artDirection: text.default("待补充"),
  style: text.default("待补充"),
  ambience: text.default("待补充"),
  sfx: text.default("待补充"),
  music: text.default("无额外配乐"),
});
export const sceneSchema = z.object({
  name: text.min(1),
  sourceStart: z.number().int().positive(),
  sourceEnd: z.number().int().positive(),
  geography: text.min(1),
  beat: text.min(1),
});
export const outlineSchema = z.object({
  title: text.min(1),
  style: text.min(1),
  look: text.min(1),
  characters: z.array(text).max(100),
  assumptions: z.array(text).max(100),
  scenes: z.array(sceneSchema).min(1).max(40),
});
export const draftSchema = z.object({
  shots: z.array(shotSchema).min(1).max(80),
});
export const artSchema = z.object({
  shots: z
    .array(
      z.object({
        id: text,
        lighting: text.min(1),
        artDirection: text.min(1),
        style: text.min(1),
        ambience: text.min(1),
        sfx: text.min(1),
        music: text.min(1),
      }),
    )
    .min(1),
});
export const auditSchema = z.object({
  issues: z
    .array(
      z.object({
        shotId: text,
        severity: z.enum(["warning", "error"]),
        category: text,
        message: text,
        suggestion: text,
      }),
    )
    .max(300),
});
export const projectInput = z.object({
  title: z.string().max(100).default("未命名剧本"),
  script: z.string().min(10).max(30000),
  style: z.string().max(1000).default("依剧本判断，未明确时采用写实影像"),
  aspect: z.enum(["16:9", "9:16", "1:1"]).default("9:16"),
});
export function scriptLines(script) {
  return script
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((text, i) => ({ id: i + 1, text }));
}
export function validateOutline(outline, lines) {
  let next = 1;
  for (const scene of outline.scenes) {
    if (
      scene.sourceStart !== next ||
      scene.sourceEnd < scene.sourceStart ||
      scene.sourceEnd > lines.length
    )
      throw new Error("分场原文范围不连续或越界，请完整覆盖原文。");
    next = scene.sourceEnd + 1;
  }
  if (next !== lines.length + 1) throw new Error("分场未覆盖全部剧本。");
}
export function speechUnits(s) {
  return (
    (s.match(/[\u3400-\u9fff]/g) || []).length +
    (s.match(/[A-Za-z0-9]+(?:['’-][A-Za-z]+)*/g) || []).length
  );
}
export function timing(shot) {
  const units = speechUnits(shot.dialogue.map((x) => x.text).join(" "));
  const speech = units / shot.speakingCps;
  const seconds =
    (shot.overlap
      ? Math.max(speech, shot.actionSeconds)
      : speech + shot.actionSeconds) + shot.pauseSeconds;
  const round = (n) => Math.round(n * 10) / 10;
  return {
    speechSeconds: round(speech),
    seconds: round(Math.max(0.5, seconds)),
    min: round(Math.max(0.5, seconds * 0.8)),
    max: round(Math.max(0.5, seconds * 1.25)),
    measured: false,
  };
}
export function compilePrompt(shot, project) {
  const t = timing(shot);
  const plan = shot.blocking
    ? "\n【机位草图】相对平面坐标，非米制尺寸；" +
      JSON.stringify(shot.blocking) +
      "；与摄影文字相互核对，如冲突需人工确认。"
    : "";
  return `【画面规格】${project.aspect}；成片镜头预计 ${t.seconds} 秒（估算，非生成平台时长参数）。\n【主体与动作】${shot.description}\n【人物表演】${shot.performance}\n【摄影】${shot.framing}；${shot.camera}\n【空间与正反打】${shot.coverage}\n【画风与美术】${project.style}；${project.outline?.look || ""}；${shot.style}；${shot.artDirection}\n【光线】${shot.lighting}\n【对白】${shot.dialogue.length ? shot.dialogue.map((d) => `${d.speaker}：“${d.text}”`).join("\n") : "无对白"}\n【声音】环境：${shot.ambience}；音效：${shot.sfx}；配乐：${shot.music}\n【衔接】起始：${shot.continuityIn}；结束：${shot.continuityOut}\n【连续性要求】人物身份、服装、道具归属和光源方向随剧情连续；保持所述视线与动作方向。${plan}`;
}
export function checkShots(shots, lines, scene = null) {
  const issues = [],
    ids = new Set(lines.map((x) => x.id)),
    textById = new Map(lines.map((x) => [x.id, x.text]));
  const add = (s, category, message, severity = "warning") =>
    issues.push({
      shotId: s?.id || "",
      category,
      message,
      severity,
      suggestion: "请对照原文与相邻镜头复核。",
      origin: "rules",
    });
  for (const s of shots) {
    if (
      s.sourceLines.some(
        (id) =>
          !ids.has(id) ||
          (scene && (id < scene.sourceStart || id > scene.sourceEnd)),
      )
    )
      throw new Error("镜头引用了不存在或不属于本场的原文行。");
    for (const d of s.dialogue) {
      if (
        !s.sourceLines.includes(d.sourceLine) ||
        !textById.get(d.sourceLine)?.includes(d.text)
      )
        throw new Error("镜头对白与所引原文不一致；已停止保存，防止改写台词。");
    }
    if (timing(s).seconds > 30)
      add(
        s,
        "时长",
        "单镜预计超过 30 秒，请检查是否需要按动作拆镜；长镜头可保留。",
      );
    if (s.speakingCps > 5.5)
      add(s, "语速", "语速估计偏快，请复核台词能否自然说完。");
  }
  const covered = new Set(shots.flatMap((s) => s.sourceLines));
  for (const l of lines.filter(
    (l) =>
      l.text.trim() &&
      (!scene || (l.id >= scene.sourceStart && l.id <= scene.sourceEnd)),
  ))
    if (!covered.has(l.id))
      add(null, "原文覆盖", `第 ${l.id} 行尚未被镜头引用。`, "error");
  const spoken = new Map();
  for (const s of shots)
    for (const d of s.dialogue) {
      const k = d.sourceLine + ":" + d.text;
      if (spoken.has(k))
        add(
          s,
          "对白重复",
          `与 ${spoken.get(k)} 重复使用同一句对白，请确认是否有意重叠。`,
        );
      else spoken.set(k, s.id);
    }
  // Conventional “角色：台词” lines receive an extra exact-coverage check.
  for (const l of lines) {
    const m = l.text.match(
      /^\s*([^：:\n]{1,12})[：:]\s*[“"「『]?(.+?)[”"」』]?\s*$/,
    );
    if (
      !m ||
      /场景|地点|时间|人物|内景|外景|第.+场|画面|音效|旁注|角色/.test(m[1])
    )
      continue;
    const content = m[2].replace(/[”"」』]$/, "");
    const rendered = shots
      .flatMap((s) => s.dialogue)
      .filter((d) => d.sourceLine === l.id)
      .map((d) => d.text)
      .join("");
    const norm = (s) => s.replace(/[\s\p{P}]/gu, "");
    if (!norm(rendered).includes(norm(content)))
      add(
        null,
        "对白覆盖",
        `第 ${l.id} 行疑似对白未完整分配，需人工核对。`,
        "error",
      );
  }
  return issues;
}
