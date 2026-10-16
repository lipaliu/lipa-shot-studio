import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
export const dataDir = path.resolve(process.env.DATA_DIR || ".data");
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(dataDir, "studio.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, body TEXT NOT NULL, updated TEXT NOT NULL);",
);
try {
  fs.chmodSync(path.join(dataDir, "studio.sqlite"), 0o600);
} catch {}
export function saveProject(p) {
  p.updatedAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO projects VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated=excluded.updated",
  ).run(p.id, JSON.stringify(p), p.updatedAt);
  return p;
}
export function getProject(id) {
  const r = db.prepare("SELECT body FROM projects WHERE id=?").get(id);
  return r ? JSON.parse(r.body) : null;
}
export function listProjects() {
  return db
    .prepare("SELECT body FROM projects ORDER BY updated DESC")
    .all()
    .map((r) => {
      const p = JSON.parse(r.body);
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        updatedAt: p.updatedAt,
        shots: p.shots?.length || 0,
        isExample: !!p.isExample,
      };
    });
}
export function recoverJobs() {
  for (const row of db.prepare("SELECT body FROM projects").all()) {
    const p = JSON.parse(row.body);
    if (["running", "queued"].includes(p.status)) {
      p.status = "interrupted";
      p.error = "服务重启中断了任务；已完成阶段保留，可继续。";
      saveProject(p);
    }
  }
}
const configFile = path.join(dataDir, "config.json");
const defaultTextModel = "claude-opus-5-5";
const defaultImageModel = "gpt-image-2";
function stored() {
  try {
    return JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch {
    return {};
  }
}
export function config() {
  const s = stored();
  const openaiKey = process.env.OPENAI_API_KEY || s.openai?.key || "";
  const imageUsesTextKey = s.image?.useTextKey !== false;
  return {
    provider: s.provider || process.env.DEFAULT_PROVIDER || "openai",
    openai: {
      key: openaiKey,
      model: process.env.OPENAI_MODEL || s.openai?.model || defaultTextModel,
      baseUrl:
        s.openai?.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    },
    doubao: {
      key:
        process.env.DOUBAO_API_KEY ||
        process.env.ARK_API_KEY ||
        s.doubao?.key ||
        "",
      model: process.env.DOUBAO_MODEL || s.doubao?.model || "",
      baseUrl:
        s.doubao?.baseUrl ||
        process.env.DOUBAO_BASE_URL ||
        "https://ark.cn-beijing.volces.com/api/v3",
    },
    image: {
      model: s.image?.model || process.env.IMAGE_MODEL || defaultImageModel,
      baseUrl:
        s.image?.baseUrl || process.env.IMAGE_BASE_URL || "https://toapis.cn/v1",
      useTextKey: imageUsesTextKey,
      key:
        process.env.IMAGE_API_KEY ||
        (imageUsesTextKey ? openaiKey : s.image?.key || ""),
    },
  };
}
export function publicConfig() {
  const c = config();
  return {
    provider: c.provider,
    ...Object.fromEntries(
      ["openai", "doubao"].map((n) => [
        n,
        {
          model: c[n].model,
          baseUrl: c[n].baseUrl,
          configured: !!(c[n].key && c[n].model),
          hasKey: !!c[n].key,
          envManaged: !!(n === "openai"
            ? process.env.OPENAI_API_KEY
            : process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY),
        },
      ]),
    ),
    image: {
      model: c.image.model,
      baseUrl: c.image.baseUrl,
      useTextKey: c.image.useTextKey,
      configured: !!(c.image.key && c.image.model),
      hasKey: !!c.image.key,
      envManaged: !!process.env.IMAGE_API_KEY,
    },
  };
}
export function saveConfig(input) {
  const s = stored();
  s.provider = input.provider;
  for (const n of ["openai", "doubao"]) {
    s[n] ||= {};
    s[n].model = input[n].model.trim();
    if (input[n].baseUrl) s[n].baseUrl = input[n].baseUrl.trim().replace(/\/$/, "");
    if (input[n].key?.trim()) s[n].key = input[n].key.trim();
    if (input[n].clearKey) s[n].key = "";
  }
  if (input.image) {
    s.image ||= {};
    s.image.model = input.image.model.trim();
    s.image.baseUrl = input.image.baseUrl.trim().replace(/\/$/, "");
    s.image.useTextKey = input.image.useTextKey;
    if (input.image.key?.trim()) s.image.key = input.image.key.trim();
    if (input.image.clearKey) s.image.key = "";
  }
  fs.writeFileSync(configFile, JSON.stringify(s, null, 2), { mode: 0o600 });
  return publicConfig();
}
