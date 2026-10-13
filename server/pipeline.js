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
    },
  ],
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
  const ask = (system, payload, schema, check) =>
    modelJSON(
      provider,
      system + "\n【优先遵循的用户任务与数据合同】\n" + base,
      JSON.stringify(payload),
      schema,
      { signal, onUsage: usage, call, check },
    );
  const context = {
    script: lines,
    requirements: { style: project.style, aspect: project.aspect },
  };
  project.usage ||= [];
  project.ruleLibrary = ruleProvenance();
  if (!project.outline) {
    checkpoint("outline", "正在理解剧本与场景关系");
    project.outline = await ask(
      rule("01-director"),
      {
        ...context,
        task: "分析全片与连续场次，保留原文行号，返回以下结构",
        format: outlineFormat,
      },
      outlineSchema,
      (o) => validateOutline(o, lines),
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
        task: "为这一场生成完整镜头，不漏原文；保持相邻状态。所有时长是估计。",
        scene,
        script: sceneLines,
        global: project.outline,
        requirements: context.requirements,
        previousExit: project.shots.at(-1)?.continuityOut || null,
        format: draftFormat,
      },
      draftSchema,
      (d) => checkShots(d.shots, lines, scene),
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
        task: "逐镜补齐以下字段，返回所有原镜号，不改动其他内容",
        global: project.outline,
        requirements: context.requirements,
        scene,
        shots,
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
      shots: project.shots.map((s) => ({ ...s, timing: timing(s) })),
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
