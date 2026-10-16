import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import mammoth from "mammoth";
import {
  dataDir,
  saveProject,
  getProject,
  listProjects,
  config,
  publicConfig,
  saveConfig,
  recoverJobs,
} from "./storage.js";
import { selectedProvider, requestJSON } from "./provider.js";
import { startImageTask, finishImageTask } from "./image.js";
import {
  projectInput,
  shotSchema,
  scriptLines,
  checkShots,
  timing,
  compilePrompt,
} from "./schema.js";
import { ruleProvenance } from "./rules.js";
import { runPipeline } from "./pipeline.js";
const app = express(),
  port = Number(process.env.PORT || 4318),
  host = process.env.HOST || "127.0.0.1";
const password = process.env.APP_PASSWORD || "";
if (!["127.0.0.1", "localhost", "::1"].includes(host) && password.length < 12)
  throw new Error("非回环地址部署必须设置至少 12 位 APP_PASSWORD。");
const sessions = new Map(),
  jobs = new Map();
let activeJob = null;
let activeImageJob = false;
const imageDir = path.join(dataDir, "images");
fs.mkdirSync(imageDir, { recursive: true, mode: 0o700 });
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (
    ["127.0.0.1", "localhost", "::1"].includes(host) &&
    !["127.0.0.1", "localhost", "[::1]"].includes(req.hostname)
  )
    return res.status(403).json({ error: "本地服务不接受此主机名。" });
  next();
});
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  res.set("X-Frame-Options", "DENY");
  res.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  next();
});
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!["GET", "HEAD"].includes(req.method)) {
    const origin = req.headers.origin;
    if (
      req.headers["sec-fetch-site"] === "cross-site" ||
      (origin && new URL(origin).host !== req.headers.host)
    )
      return res.status(403).json({ error: "请求来源不受信任。" });
    if (!req.is("application/json"))
      return res.status(415).json({ error: "请求需要 application/json。" });
  }
  next();
});
app.use(express.json({ limit: "12mb" }));
const authenticated = (req) =>
  !password ||
  [...sessions].some(([token, until]) => {
    if (until < Date.now()) {
      sessions.delete(token);
      return false;
    }
    return req.headers.cookie
      ?.split(";")
      .some((c) => c.trim() === `studio_session=${token}`);
  });
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "lipa-shot-studio" }),
);
app.get("/api/session", (req, res) =>
  res.json({ authenticated: authenticated(req), passwordRequired: !!password }),
);
const loginAttempts = new Map();
app.post("/api/login", (req, res) => {
  const ip = req.socket.remoteAddress,
    now = Date.now(),
    a = loginAttempts.get(ip) || { n: 0, until: now + 60000 };
  if (a.until < now) {
    a.n = 0;
    a.until = now + 60000;
  }
  a.n++;
  loginAttempts.set(ip, a);
  if (a.n > 10)
    return res.status(429).json({ error: "尝试过于频繁，请稍后再试。" });
  const given = typeof req.body.password === "string" ? req.body.password : "";
  if (
    password &&
    (Buffer.byteLength(given) !== Buffer.byteLength(password) ||
      !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(password)))
  )
    return res.status(401).json({ error: "访问密码不正确。" });
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, now + 12 * 3600000);
  res.setHeader(
    "Set-Cookie",
    `studio_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
  );
  res.json({ ok: true });
});
app.use("/api", (req, res, next) =>
  authenticated(req)
    ? next()
    : res.status(401).json({ error: "请先输入访问密码。" }),
);
const serialize = (p) => {
  const lines = scriptLines(p.script);
  let issues = [];
  try {
    issues = checkShots(p.shots, lines);
  } catch (e) {
    issues = [{ severity: "error", category: "原文", message: e.message }];
  }
  const total = p.shots.reduce((n, s) => n + timing(s).seconds, 0);
  return {
    ...p,
    shots: p.shots.map((s) => ({
      ...s,
      source: s.sourceLines.map((id) => ({
        id,
        text: lines[id - 1]?.text || "",
      })),
      timing: timing(s),
      prompt: compilePrompt(s, p),
    })),
    issues: [...issues, ...(p.aiIssues || [])],
    totalSeconds: Math.round(total * 10) / 10,
  };
};
app.get("/api/rules", (_req, res) => res.json(ruleProvenance()));
app.get("/api/settings", (_req, res) => res.json(publicConfig()));
const settingsSchema = z.object({
  provider: z.enum(["openai", "doubao"]),
  openai: z.object({
    model: z.string().max(200),
    baseUrl: z.string().max(500).optional(),
    key: z.string().max(1000).optional(),
    clearKey: z.boolean().optional(),
  }),
  doubao: z.object({
    model: z.string().max(200),
    baseUrl: z.string().max(500).optional(),
    key: z.string().max(1000).optional(),
    clearKey: z.boolean().optional(),
  }),
  image: z
    .object({
      model: z.string().max(200),
      baseUrl: z.string().url().max(500).refine((value) => new URL(value).protocol === "https:"),
      useTextKey: z.boolean(),
      key: z.string().max(1000).optional(),
      clearKey: z.boolean().optional(),
    })
    .optional(),
});
app.put("/api/settings", (req, res) =>
  res.json(saveConfig(settingsSchema.parse(req.body))),
);
app.post("/api/settings/test", async (req, res) => {
  const name = z.enum(["openai", "doubao"]).parse(req.body.provider);
  const c = config()[name];
  if (!c.key || !c.model)
    return res.status(400).json({ error: "请先保存该模型的配置。" });
  const r = await requestJSON(
    { ...c, name },
    "只返回 JSON 对象。",
    '返回 {"ok":true}',
    { maxTokens: 256 },
  );
  res.json({ ok: r.value.ok === true, model: c.model });
});
app.get("/api/projects", (_req, res) => res.json(listProjects()));
app.get("/api/projects/:id", (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "项目不存在。" });
  res.json(serialize(p));
});
app.post("/api/import", async (req, res) => {
  const { name, base64 } = z
    .object({ name: z.string().max(250), base64: z.string().max(10000000) })
    .parse(req.body);
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > 5 * 1024 * 1024)
    return res.status(413).json({ error: "文件不能超过 5 MB。" });
  let text = "";
  if (/\.docx$/i.test(name)) {
    const r = await mammoth.extractRawText({ buffer });
    text = r.value;
  } else if (/\.(txt|md)$/i.test(name)) text = buffer.toString("utf8");
  else
    return res
      .status(400)
      .json({ error: "支持 TXT、Markdown 和 DOCX。PDF 请先提取为文本。" });
  if (text.length > 30000)
    return res
      .status(400)
      .json({ error: "单次最多 30,000 字符，请按集或场次导入。" });
  res.json({ text });
});
function start(p) {
  if (activeJob)
    throw Object.assign(new Error("已有分镜任务运行中，请等待完成或取消。"), {
      status: 409,
    });
  const provider = selectedProvider(),
    controller = new AbortController();
  activeJob = p.id;
  jobs.set(p.id, controller);
  p.status = "running";
  p.error = null;
  p.provider = { name: provider.name, model: provider.model };
  saveProject(p);
  const savePipelineProject = (next) => {
    const latest = getProject(next.id);
    if (latest) {
      const savedShots = new Map(
        (latest.shots || []).map((shot) => [shot.id, shot]),
      );
      next.shots = (next.shots || []).map(
        (shot) => savedShots.get(shot.id) || shot,
      );
      next.imageTasks = {
        ...(next.imageTasks || {}),
        ...(latest.imageTasks || {}),
      };
    }
    return saveProject(next);
  };
  runPipeline(p, provider, {
    save: savePipelineProject,
    signal: controller.signal,
  })
    .catch((e) => {
      p.status = controller.signal.aborted ? "cancelled" : "failed";
      p.error = e.message;
      savePipelineProject(p);
    })
    .finally(() => {
      jobs.delete(p.id);
      activeJob = null;
    });
}
app.post("/api/projects", (req, res) => {
  const input = projectInput.parse(req.body);
  selectedProvider();
  if (activeJob)
    return res.status(409).json({ error: "已有分镜任务运行中，请稍后再试。" });
  const p = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    shots: [],
    status: "queued",
    stage: "outline",
    progress: "正在准备",
    usage: [],
    completedScenes: [],
    aiIssues: [],
  };
  start(p);
  res.status(202).json(serialize(p));
});
app.post("/api/projects/:id/resume", (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.sendStatus(404);
  if (p.isExample)
    return res
      .status(400)
      .json({ error: "示例不支持继续生成，请创建真实项目。" });
  if (p.status === "ready")
    return res.status(409).json({ error: "该项目已完成。" });
  start(p);
  res.json(serialize(p));
});
app.post("/api/projects/:id/cancel", (req, res) => {
  jobs.get(req.params.id)?.abort();
  res.json({ ok: true });
});
app.post("/api/projects/:id/review", (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.sendStatus(404);
  if (p.isExample)
    return res
      .status(400)
      .json({ error: "示例不调用模型，请新建真实剧本项目。" });
  if (p.status !== "ready" || !p.outline)
    return res.status(409).json({ error: "请先完成镜头生成。" });
  start(p);
  res.json(serialize(p));
});
app.patch("/api/projects/:id/shots/:shotId", (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.sendStatus(404);
  const i = p.shots.findIndex((s) => s.id === req.params.shotId);
  if (i < 0) return res.sendStatus(404);
  const status = z
    .enum(["draft", "approved", "changes"])
    .parse(req.body.status || "draft");
  const next = shotSchema.parse(req.body);
  checkShots([{ ...next, id: req.params.shotId }], scriptLines(p.script));
  const prev = p.shots[i],
    changed = JSON.stringify(shotSchema.parse(prev)) !== JSON.stringify(next);
  if (
    p.status === "running" &&
    (!p.completedScenes?.includes(prev.sceneIndex) || changed)
  )
    return res
      .status(409)
      .json({ error: "生成期间可审核已完成场次，文字内容请在全片完成后修改。" });
  if (changed) {
    p.auditStale = true;
    p.aiIssues = [];
    for (const n of [i - 1, i + 1])
      if (p.shots[n]?.status === "approved") p.shots[n].status = "changes";
  }
  p.shots[i] = {
    ...next,
    id: prev.id,
    sceneIndex: prev.sceneIndex,
    status: changed ? "draft" : status,
  };
  saveProject(p);
  res.json(serialize(p));
});
app.get("/api/images/:name", (req, res) => {
  if (!/^[0-9a-f-]{36}\.(?:png|jpg|webp)$/.test(req.params.name))
    return res.sendStatus(404);
  const file = path.join(imageDir, req.params.name);
  res.sendFile(file, { dotfiles: "allow" }, (error) => {
    if (error && !res.headersSent) res.sendStatus(error.status || 404);
  });
});
async function completeImageTask(projectId, shotId, image, task) {
  try {
    const generated = await finishImageTask(image, task, {
      onProgress: (state) => {
        const current = getProject(projectId);
        const pending = current?.imageTasks?.[shotId];
        if (!pending || pending.id !== task.id) return;
        if (pending.status !== state.status || pending.progress !== state.progress) {
          pending.status = state.status;
          pending.progress = state.progress || 0;
          saveProject(current);
        }
      },
    });
    const fresh = getProject(projectId);
    const target = fresh?.shots.find((s) => s.id === shotId);
    if (!target) throw new Error("原镜头已不存在，无法保存生成图片。");
    const name = `${crypto.randomUUID()}.${generated.extension}`;
    fs.writeFileSync(path.join(imageDir, name), generated.bytes, { mode: 0o600 });
    target.storyboardImage = `/api/images/${name}`;
    fresh.imageTasks[shotId] = {
      ...fresh.imageTasks[shotId],
      status: "completed",
      progress: 100,
      error: "",
    };
    saveProject(fresh);
  } catch (error) {
    const fresh = getProject(projectId);
    if (fresh?.imageTasks?.[shotId]?.id === task.id) {
      fresh.imageTasks[shotId].status = "failed";
      fresh.imageTasks[shotId].error = error.message || "图片生成失败。";
      saveProject(fresh);
    }
  } finally {
    activeImageJob = false;
  }
}
app.post("/api/projects/:id/shots/:shotId/image", async (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.sendStatus(404);
  const shot = p.shots.find((s) => s.id === req.params.shotId);
  if (!shot) return res.sendStatus(404);
  const sceneComplete = p.completedScenes?.includes(shot.sceneIndex);
  if (p.status !== "ready" && !(p.status === "running" && sceneComplete))
    return res.status(409).json({ error: "请等待这一场文字分镜生成完成。" });
  const image = config().image;
  if (!image.key || !image.model)
    return res.status(400).json({ error: "请先在设置中配置图片模型。" });
  if (activeImageJob)
    return res.status(409).json({ error: "另一张图片正在生成，请稍后再试。" });
  activeImageJob = true;
  try {
    const prompt = [
      "生成一张电影分镜静帧，只画一个镜头。保留人物身份、道具及光源连续性；不要添加文字、水印、分格或镜头标注。",
      `画幅：${p.aspect}。影像基准：${p.outline?.look || p.style}。`,
      `场景：${p.outline?.scenes[shot.sceneIndex]?.name || ""}。`,
      `画面：${shot.description}`,
      `表演：${shot.performance}`,
      `摄影：${shot.framing}；${shot.camera}`,
      `美术与光线：${shot.style}；${shot.artDirection}；${shot.lighting}`,
    ].join("\n").slice(0, 12000);
    const task = await startImageTask(image, prompt, p.aspect);
    p.imageTasks ||= {};
    p.imageTasks[shot.id] = {
      id: task.id,
      status: task.status || "queued",
      progress: task.progress || 0,
      model: image.model,
      baseUrl: image.baseUrl,
      error: "",
    };
    saveProject(p);
    res.status(202).json(serialize(p));
    void completeImageTask(p.id, shot.id, image, task);
  } catch (error) {
    activeImageJob = false;
    throw error;
  }
});
app.post("/api/example", (_req, res) => {
  const raw = JSON.parse(
    fs.readFileSync(
      new URL("../examples/example.json", import.meta.url),
      "utf8",
    ),
  );
  const p = {
    ...raw,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    isExample: true,
    status: "ready",
    stage: "done",
    progress: "示例项目",
    usage: [],
    aiIssues: [],
  };
  saveProject(p);
  res.json(serialize(p));
});
const csvSafe = (v) => {
  let s = String(v ?? "");
  if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
app.get("/api/projects/:id/export", (req, res) => {
  const raw = getProject(req.params.id);
  if (!raw) return res.sendStatus(404);
  const p = serialize(raw);
  res.attachment(
    `storyboard-${p.id}.${req.query.format === "csv" ? "csv" : "json"}`,
  );
  if (req.query.format !== "csv") return res.json(p);
  const columns = [
    "镜号",
    "审核状态",
    "对应剧本",
    "预计秒数",
    "估算范围",
    "估时依据",
    "镜头目的",
    "画面描述",
    "人物表演",
    "景别/机位/焦点",
    "运镜",
    "正反打/轴线",
    "画风",
    "美术",
    "光线",
    "对白",
    "环境声",
    "音效",
    "配乐",
    "入口状态",
    "出口状态",
    "完整提示词",
  ];
  const rows = p.shots.map((s) => [
    s.id,
    s.status,
    s.source.map((x) => `L${x.id} ${x.text}`).join("\n"),
    s.timing.seconds,
    `${s.timing.min}–${s.timing.max}`,
    s.timingReason,
    s.purpose,
    s.description,
    s.performance,
    s.framing,
    s.camera,
    s.coverage,
    s.style,
    s.artDirection,
    s.lighting,
    s.dialogue.map((d) => `${d.speaker}：${d.text}`).join("\n"),
    s.ambience,
    s.sfx,
    s.music,
    s.continuityIn,
    s.continuityOut,
    s.prompt,
  ]);
  res
    .type("text/csv; charset=utf-8")
    .send(
      "\ufeff" +
        [columns, ...rows].map((r) => r.map(csvSafe).join(",")).join("\r\n"),
    );
});
app.use(express.static(path.resolve("dist")));
app.get("/{*splat}", (_req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
app.use((err, _req, res, _next) => {
  res
    .status(err.status || 400)
    .json({
      error:
        err instanceof z.ZodError
          ? "输入不完整或格式不正确，请检查必填字段。"
          : err.message?.includes("ENOENT")
            ? "请先执行 npm run build。"
            : err.message || "操作失败，请重试。",
    });
});
recoverJobs();
for (const summary of listProjects()) {
  if (activeImageJob) break;
  const project = getProject(summary.id);
  const pending = Object.entries(project.imageTasks || {}).find(([, task]) =>
    ["queued", "in_progress"].includes(task.status),
  );
  if (pending) {
    activeImageJob = true;
    const [shotId, task] = pending;
    void completeImageTask(project.id, shotId, {
      ...config().image,
      model: task.model,
      baseUrl: task.baseUrl,
    }, task);
  }
}
const server = app.listen(port, host, () =>
  console.log(`Lipa 分镜工作台 http://${host}:${port}`),
);
process.on("SIGTERM", () => {
  for (const c of jobs.values()) c.abort();
  server.close(() => process.exit(0));
});
