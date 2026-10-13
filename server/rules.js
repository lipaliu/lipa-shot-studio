import fs from "node:fs";
import crypto from "node:crypto";

const directory = new URL("../vendor/higgsfield/", import.meta.url);
const manifest = JSON.parse(
  fs.readFileSync(new URL("manifest.json", directory), "utf8"),
);
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const excerpts = new Map(
  manifest.skills.map((skill) => {
    const raw = fs.readFileSync(new URL(skill.file, directory));
    if (digest(raw) !== skill.sha256)
      throw new Error(`规则快照校验失败：${skill.name}`);
    const lines = raw.toString("utf8").split("\n");
    const text = skill.ranges
      .map(([start, end]) => {
        if (start < 1 || end > lines.length || start > end)
          throw new Error("规则摘录范围无效");
        return `原文 L${start}–L${end}\n${lines.slice(start - 1, end).join("\n")}`;
      })
      .join("\n\n");
    return [
      skill.name,
      `【Higgsfield 创作参考：${skill.name} v${skill.version}】\n${text}`,
    ];
  }),
);

export function skillContext(names) {
  return [...new Set(names)]
    .map((name) => {
      if (!excerpts.has(name)) throw new Error(`未找到创作规则：${name}`);
      return excerpts.get(name);
    })
    .join("\n\n");
}

export function ruleProvenance() {
  const adapters = fs
    .readdirSync(new URL("../prompts/", import.meta.url))
    .sort()
    .map((name) => ({
      name,
      sha256: digest(
        fs.readFileSync(new URL(`../prompts/${name}`, import.meta.url)),
      ),
    }));
  return {
    ...manifest,
    adapterVersion: "1.0.0",
    adapters,
    timingMode: "script-estimated",
  };
}
