import fs from "node:fs";
import { skillContext, ruleProvenance } from "./rules.js";
import { modelJSON } from "./provider.js";
import {
  outlineSchema,
  draftSchema,
  artSchema,
  auditSchema,
  validateOutline,
  scriptLines,
  checkShots,
  timing,
  normalizeOutlineOutput,
  normalizeDraftOutput,
  normalizeArtOutput,
  normalizeAuditOutput,
} from "./schema.js";
const localRule = (n) =>
  fs.readFileSync(new URL(`../prompts/${n}.md`, import.meta.url), "utf8");
const roleSkills = {
  "01-director": ["higgsfield-shotlist-director", "higgsfield-acting"],
  "02-performance-camera": ["higgsfield-camera"],
  "03-art-sound": ["higgsfield-style", "higgsfield-audio"],
  "04-review": [
    "higgsfield-shotlist-director",
    "higgsfield-acting",
    "higgsfield-camera",
    "higgsfield-style",
    "higgsfield-audio",
  ],
};
const rule = (n) =>
  skillContext(roleSkills[n] || []) +
  "\n【网页工作流适配要求】\n" +
  localRule(n);
const base = rule("00-contract");
const outlineFormat = {
  title: "片名",
  style: "画风",
  look: "全片光色/美术基准",
  characters: ["人物及已知身份"],
  assumptions: ["未知信息的可改建议"],
  scenes: [
    {
      name: "场次名",
      sourceStart: 1,
      sourceEnd: 10,
      geography: "空间/轴线/进出路径与道具关系",
      beat: "本场行动与信息变化",
    },
  ],
};
const outlineContract = {
  nullRule: "所有字段必须给出；未知文字用待补充或空数组，不能使用 null",
  rangeRule:
    "sourceStart/sourceEnd 是正整数；首场从 1 开始，场次首尾连续并覆盖最后一行",
  counts: "scenes 为 1 到 40 项；characters/assumptions 各不超过 100 项",
};
const draftFormat = {
  shots: [
    {
      sourceLines: [1, 2],
      purpose: "切镜/观看目的",
      description: "起始画面到结束动作",
      performance: "谁受到什么触发，采取什么可见行为",
      framing: "景别、视点、焦点",
      camera: "起幅、主运动、停止条件、落幅",
      coverage: "正反打对象与视线/轴线，或不适用的理由",
      continuityIn: "入镜状态",
      continuityOut: "出镜状态",
      dialogue: [{ sourceLine: 2, speaker: "角色", text: "严格摘取原文" }],
      speakingCps: 4,
      actionSeconds: 3,
      pauseSeconds: 1,
      overlap: true,
      timingReason: "对白/动作/反应的秒数依据与不确定性",
      blocking: {
        actors: [{ name: "本场人物名", x: 30, y: 45 }],
        camera: { x: 50, y: 85, targetX: 50, targetY: 45 },
        light: { x: 80, y: 20 },
        props: [
          { name: "剧本已有的桌子", x: 50, y: 45, width: 25, height: 15 },
        ],
        note: "建议机位的依据，未知空间需注明是假设",
      },
    },
  ],
};
const draftContract = {
  nullRule: "所有字段必须给出且不能为 null；无内容时使用明确说明、0、false 或空数组",
  sourceLines:
    "1 到 300 个正整数，只能引用本场行号；dialogue.sourceLine 必须也在 sourceLines 中",
  dialogue:
    "dialogue 为数组；text 必须是对应原文行中的连续原句，不得润色或改写",
  speakingCps: "数字 1 到 9；无对白镜头也填写默认值 4，不能填写 0",
  actionSeconds: "数字 0 到 180，不要带秒字",
  pauseSeconds: "数字 0 到 60，不要带秒字",
  overlap: "只能是 JSON 布尔值 true 或 false",
  strings:
    "purpose/description/performance/framing/camera/coverage/continuityIn/continuityOut/timingReason 均为非空字符串",
  blocking:
    "可省略；如提供，所有坐标为 5 到 95，道具宽高为 5 到 60，actors/props 各不超过 12 项",
  counts:
    "镜头数量以完整覆盖剧情所需的最少数量为准；短场景通常 3 到 6 镜，禁止按句机械拆镜",
  brevity:
    "严格精简 JSON：purpose/framing 不超过 24 个汉字；description 不超过 70 个汉字；performance/camera/coverage/continuityIn/continuityOut/timingReason/blocking.note 各不超过 40 个汉字；人物和道具 name 不超过 16 个汉字。不要在多个字段重复同一信息",
};
const artContract = {
  identity: "逐一返回输入中的全部镜号，数量相同，不新增、不遗漏、不重复",
  nullRule:
    "lighting/artDirection/style/ambience/sfx/music 都是非空字符串；没有内容时明确写无额外内容，不能使用 null",
  brevity:
    "严格精简 JSON：每个文字字段不超过 45 个汉字，只写这一字段需要的新增信息，不复述镜头描述",
};
const auditContract = {
  shotId: "只能使用输入中存在的镜号；整场问题使用空字符串",
  severity: "只能使用英文 warning 或 error",
  fields: "category/message/suggestion 都必须是字符串",
  counts: "issues 最多 300 项；没有问题时返回空数组",
  brevity:
    "只报告会影响原文忠实、连续性、可拍性或时长的实际问题；每个文字字段不超过 45 个汉字",
};
export async function runPipeline(
  project,
  provider,
  { save, signal, call, onProgress = () => {} },
) {
  const lines = scriptLines(project.script);
  const checkpoint = (stage, message) => {
    if (signal.aborted) throw new Error("任务已取消。");
    project.stage = stage;
    project.progress = message;
    save(project);
    onProgress(message);
  };
  const usage = (u) => {
    if (u) project.usage.push(u);
  };
  const ask = (system, payload, schema, check, normalize) => {
    const stageProgress = project.progress;
    return modelJSON(
      provider,
      system + "\n【优先遵循的用户任务与数据合同】\n" + base,
      JSON.stringify(payload),
      schema,
      {
        signal,
        onUsage: usage,
        call,
        check,
        normalize,
        onRetry: ({ attempt, maxRetries, code, message, kind }) => {
          project.retries ||= [];
          project.retries.push({
            stage: project.stage,
            attempt,
            maxRetries,
            code,
            message,
            kind,
            at: new Date().toISOString(),
          });
          project.progress = `${stageProgress} · ${
            kind === "transport" ? "连接异常，自动重试" : "模型结果异常，自动修复"
          } ${attempt}/${maxRetries}`;
          save(project);
          onProgress(project.progress);
        },
      },
    );
  };
  const context = {
    script: lines,
    requirements: { style: project.style, aspect: project.aspect },
  };
  project.usage ||= [];
  project.retries ||= [];
  project.ruleLibrary = ruleProvenance();
  if (!project.outline) {
    checkpoint("outline", "正在理解剧本与场景关系");
    project.outline = await ask(
      rule("01-director"),
      {
        ...context,
        script: lines.map((line) => ({
          ...line,
          isBlank: line.text.trim().length === 0,
        })),
        task: "分析全片与连续场次，保留原文行号，返回以下结构",
        sourceRangeContract: {
          firstSourceStart: 1,
          lastSourceEnd: lines.length,
          nextSceneRule: "下一场 sourceStart 必须等于上一场 sourceEnd + 1",
          blankLineRule: "空行也占用行号，必须包含在前后某一场的连续范围内",
        },
        contract: outlineContract,
        format: outlineFormat,
      },
      outlineSchema,
      (o) => validateOutline(o, lines),
      (value) =>
        normalizeOutlineOutput(value, {
          title: project.title,
          style: project.style,
          look: project.style,
        }),
    );
    if (project.title === "未命名剧本") project.title = project.outline.title;
    project.completedScenes = [];
    project.shots = [];
    save(project);
  }
  for (let i = 0; i < project.outline.scenes.length; i++) {
    if (project.completedScenes.includes(i)) continue;
    const scene = project.outline.scenes[i];
    checkpoint(
      "director",
      `正在拆解第 ${i + 1}/${project.outline.scenes.length} 场的镜头与表演`,
    );
    const sceneLines = lines.filter(
      (l) => l.id >= scene.sourceStart && l.id <= scene.sourceEnd,
    );
    const draft = await ask(
      rule("01-director") + "\n" + rule("02-performance-camera"),
      {
        task:
          "为这一场生成完整且精简的镜头 JSON，不漏原文；保持相邻状态。所有时长是估计。用最少镜头覆盖剧情，严格遵守 contract.brevity，禁止解释或复述字段要求。",
        scene,
        script: sceneLines,
        global: project.outline,
        requirements: context.requirements,
        previousExit:
          project.shots.at(-1)?.continuityOut || "无明确前置状态",
        contract: draftContract,
        format: draftFormat,
      },
      draftSchema,
      (d) => checkShots(d.shots, lines, scene),
      normalizeDraftOutput,
    );
    const shots = draft.shots.map((s, j) => ({
      ...s,
      id: `S${String(i + 1).padStart(2, "0")}-${String(j + 1).padStart(3, "0")}`,
      sceneIndex: i,
      status: "draft",
    }));
    checkpoint("art", `正在补齐第 ${i + 1} 场的光线、美术和声音`);
    const art = await ask(
      rule("03-art-sound"),
      {
        task:
          "逐镜精简补齐以下字段，返回所有原镜号，不改动其他内容；严格遵守 contract.brevity，禁止复述已有镜头内容",
        global: project.outline,
        requirements: context.requirements,
        scene,
        shots,
        contract: artContract,
        format: {
          shots: [
            {
              id: shots[0].id,
              lighting: "光源方向软硬与层级",
              artDirection: "美术/空间/材质/道具",
              style: "画风及局部视觉风格",
              ambience: "环境声",
              sfx: "音效/触发点/画内画外",
              music: "配乐或无额外配乐",
            },
          ],
        },
      },
      artSchema,
      (a) => {
        if (
          a.shots.length !== shots.length ||
          new Set(a.shots.map((s) => s.id)).size !== shots.length ||
          a.shots.some((s) => !shots.some((x) => x.id === s.id))
        )
          throw new Error("美术阶段镜号与导演阶段不一致。");
      },
      (value) => normalizeArtOutput(value, shots),
    );
    project.shots.push(
      ...shots.map((s) => ({ ...s, ...art.shots.find((a) => a.id === s.id) })),
    );
    project.completedScenes.push(i);
    save(project);
  }
  checkpoint("review", "正在复核台词、秒数、轴线与前后衔接");
  const review = await ask(
    rule("04-review"),
    {
      script: lines,
      global: project.outline,
      shots: project.shots.map(({ storyboardImage, ...s }) => ({
        ...s,
        timing: timing(s),
      })),
      contract: auditContract,
      format: {
        issues: [
          {
            shotId: "已存在的镜号，整场问题可留空",
            severity: "warning",
            category: "连续性",
            message: "具体问题",
            suggestion: "可执行改法",
          },
        ],
      },
    },
    auditSchema,
    (a) => {
      if (
        a.issues.some(
          (x) => x.shotId && !project.shots.some((s) => s.id === x.shotId),
        )
      )
        throw new Error("审阅引用了不存在的镜号。");
    },
    (value) => normalizeAuditOutput(value, project.shots),
  );
  project.aiIssues = review.issues.map((x) => ({ ...x, origin: "model" }));
  project.status = "ready";
  project.stage = "done";
  project.progress = "分镜已生成，等待逐镜审核";
  project.error = null;
  project.auditStale = false;
  save(project);
  return project;
}
