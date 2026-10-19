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
  .refine(
    (value) =>
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ||
      /^\/api\/images\/[0-9a-f-]{36}\.(?:png|jpg|webp)$/.test(value),
    "图片地址无效。",
  );
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

const objectValue = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const textValue = (value, fallback, max = 12000) =>
  typeof value === "string" && value.trim()
    ? value.slice(0, max)
    : fallback;
const numberValue = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*(?:秒|s)?$/i);
  return match ? Number(match[1]) : undefined;
};
const integerValue = (value) => {
  const number = numberValue(value);
  return Number.isInteger(number) ? number : undefined;
};
const booleanValue = (value) => {
  if (typeof value === "boolean") return value;
  if (value === 1 || /^(true|是|有|重叠)$/i.test(String(value).trim()))
    return true;
  if (value === 0 || /^(false|否|无|不重叠)$/i.test(String(value).trim()))
    return false;
  return undefined;
};
const clamp = (value, min, max, fallback) => {
  const number = numberValue(value);
  return Math.min(max, Math.max(min, number ?? fallback));
};
const stringList = (value, max) =>
  (Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string")
    .map((item) => item.slice(0, 12000))
    .slice(0, max);

export function normalizeOutlineOutput(value, defaults = {}) {
  const raw = objectValue(value);
  return {
    ...raw,
    title: textValue(raw.title, defaults.title || "未命名剧本"),
    style: textValue(raw.style, defaults.style || "依剧本判断"),
    look: textValue(raw.look, defaults.look || defaults.style || "依剧本判断"),
    characters: stringList(raw.characters, 100),
    assumptions: stringList(raw.assumptions, 100),
    scenes: (Array.isArray(raw.scenes) ? raw.scenes : [])
      .slice(0, 40)
      .map((item, index) => {
        const scene = objectValue(item);
        return {
          ...scene,
          name: textValue(scene.name, `第 ${index + 1} 场`),
          sourceStart: integerValue(scene.sourceStart),
          sourceEnd: integerValue(scene.sourceEnd),
          geography: textValue(scene.geography, "空间关系待导演确认"),
          beat: textValue(scene.beat, "本场行动与信息变化待补充"),
        };
      }),
  };
}

function normalizeBlocking(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const raw = objectValue(value);
  const point = (item, fallback) => {
    const source = objectValue(item);
    return {
      x: clamp(source.x, 5, 95, fallback.x),
      y: clamp(source.y, 5, 95, fallback.y),
    };
  };
  const camera = objectValue(raw.camera);
  return {
    actors: (Array.isArray(raw.actors) ? raw.actors : [])
      .slice(0, 12)
      .map((item, index) => {
        const actor = objectValue(item);
        return {
          name: textValue(actor.name, `人物${index + 1}`, 40),
          ...point(actor, { x: 35 + index * 10, y: 50 }),
        };
      }),
    camera: {
      ...point(camera, { x: 50, y: 85 }),
      targetX: clamp(camera.targetX, 5, 95, 50),
      targetY: clamp(camera.targetY, 5, 95, 50),
    },
    light: point(raw.light, { x: 80, y: 20 }),
    props: (Array.isArray(raw.props) ? raw.props : [])
      .slice(0, 12)
      .map((item, index) => {
        const prop = objectValue(item);
        return {
          name: textValue(prop.name, `道具${index + 1}`, 40),
          ...point(prop, { x: 50, y: 50 }),
          width: clamp(prop.width, 5, 60, 15),
          height: clamp(prop.height, 5, 60, 15),
        };
      }),
    note: textValue(raw.note, "相对位置示意，需导演确认", 1000),
  };
}

export function normalizeDraftOutput(value) {
  const raw = objectValue(value);
  return {
    ...raw,
    shots: (Array.isArray(raw.shots) ? raw.shots : [])
      .slice(0, 80)
      .map((item) => {
        const shot = objectValue(item);
        const dialogue = (Array.isArray(shot.dialogue) ? shot.dialogue : []).map(
          (item) => {
            const line = objectValue(item);
            return {
              ...line,
              sourceLine: integerValue(line.sourceLine),
              speaker: textValue(line.speaker, "未标明角色"),
              text: textValue(line.text, ""),
            };
          },
        );
        const sourceLines = [
          ...new Set(
            (Array.isArray(shot.sourceLines) ? shot.sourceLines : [])
              .map(integerValue)
              .filter((line) => Number.isInteger(line) && line > 0),
          ),
        ].slice(0, 300);
        const rawSpeakingCps = numberValue(shot.speakingCps);
        return {
          ...shot,
          blocking: normalizeBlocking(shot.blocking),
          sourceLines,
          purpose: textValue(shot.purpose, "建立本镜头的叙事信息"),
          description: textValue(shot.description, "画面与动作待补充"),
          performance: textValue(shot.performance, "无明确人物表演"),
          framing: textValue(shot.framing, "景别与焦点待确认"),
          camera: textValue(shot.camera, "固定机位"),
          coverage: textValue(shot.coverage, "本镜头不适用正反打"),
          continuityIn: textValue(shot.continuityIn, "无明确前置状态"),
          continuityOut: textValue(shot.continuityOut, "无明确后续状态"),
          dialogue,
          speakingCps:
            dialogue.length === 0 && (!rawSpeakingCps || rawSpeakingCps <= 0)
              ? 4
              : clamp(rawSpeakingCps, 1, 9, 4),
          actionSeconds: clamp(shot.actionSeconds, 0, 180, 0),
          pauseSeconds: clamp(shot.pauseSeconds, 0, 60, 0),
          overlap: booleanValue(shot.overlap) ?? false,
          timingReason: textValue(
            shot.timingReason,
            dialogue.length
              ? "按对白、动作和停顿分别估算"
              : "无对白，按动作和停顿估算",
          ),
        };
      }),
  };
}

export function normalizeArtOutput(value, shots) {
  const raw = objectValue(value);
  const returned = Array.isArray(raw.shots) ? raw.shots : [];
  const byId = new Map(
    returned
      .map((item) => objectValue(item))
      .filter((item) => typeof item.id === "string")
      .map((item) => [item.id, item]),
  );
  return {
    shots: shots.map((shot, index) => {
      const item = byId.get(shot.id) || objectValue(returned[index]);
      return {
        id: shot.id,
        lighting: textValue(item.lighting, shot.lighting || "待补充"),
        artDirection: textValue(
          item.artDirection,
          shot.artDirection || "待补充",
        ),
        style: textValue(item.style, shot.style || "待补充"),
        ambience: textValue(item.ambience, shot.ambience || "待补充"),
        sfx: textValue(item.sfx, shot.sfx || "无额外音效"),
        music: textValue(item.music, shot.music || "无额外配乐"),
      };
    }),
  };
}

export function normalizeAuditOutput(value, shots) {
  const raw = objectValue(value);
  const ids = new Set(shots.map((shot) => shot.id));
  const severity = (value) =>
    /^(error|错误|严重)$/i.test(String(value).trim()) ? "error" : "warning";
  return {
    issues: (Array.isArray(raw.issues) ? raw.issues : [])
      .slice(0, 300)
      .map((item) => objectValue(item))
      .filter((item) => typeof item.message === "string" && item.message.trim())
      .map((item) => ({
        shotId:
          typeof item.shotId === "string" && ids.has(item.shotId)
            ? item.shotId
            : "",
        severity: severity(item.severity),
        category: textValue(item.category, "综合审阅"),
        message: textValue(item.message, ""),
        suggestion: textValue(item.suggestion, "请人工复核并调整"),
      })),
  };
}
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
  const onlyBlankLines = (start, end) =>
    start > end ||
    lines
      .slice(start - 1, end)
      .every((line) => line.text.trim().length === 0);
  let next = 1;
  for (const scene of outline.scenes) {
    // Models commonly leave blank separator lines between scene ranges, or
    // include the same blank separator on both sides. Assign those separators
    // deterministically while keeping omissions/overlaps of real text fatal.
    if (
      scene.sourceStart > next &&
      onlyBlankLines(next, scene.sourceStart - 1)
    )
      scene.sourceStart = next;
    else if (
      scene.sourceStart < next &&
      onlyBlankLines(scene.sourceStart, next - 1)
    )
      scene.sourceStart = next;
    if (
      scene.sourceStart !== next ||
      scene.sourceEnd < scene.sourceStart ||
      scene.sourceEnd > lines.length
    )
      throw new Error("分场原文范围不连续或越界，请完整覆盖原文。");
    next = scene.sourceEnd + 1;
  }
  if (
    next <= lines.length &&
    onlyBlankLines(next, lines.length) &&
    outline.scenes.length
  ) {
    outline.scenes.at(-1).sourceEnd = lines.length;
    next = lines.length + 1;
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
      "；空间位置和朝向以此最新草图及【机位同步】文字为准，保留原镜头的动作与运镜意图。"
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
      /标题|场景|地点|时间|人物|内景|外景|第.+场|画面|音效|旁注|角色/.test(
        m[1],
      )
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
