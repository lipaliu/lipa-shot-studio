import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  timing,
  scriptLines,
  checkShots,
  validateOutline,
  compilePrompt,
  draftSchema,
  blockingSchema,
  storyboardImageSchema,
  artSchema,
  auditSchema,
  normalizeDraftOutput,
  normalizeArtOutput,
  normalizeAuditOutput,
} from "../server/schema.js";
import { runPipeline } from "../server/pipeline.js";
import { requestJSON, modelJSON, parseModelJSON } from "../server/provider.js";
import { ruleProvenance } from "../server/rules.js";
const fixture = JSON.parse(
  fs.readFileSync(new URL("../examples/example.json", import.meta.url)),
);
const clone = () => structuredClone(fixture);
test("blocking coordinates are bounded; legacy shots remain compatible", () => {
  const p = clone(),
    s = p.shots[0];
  assert.equal(blockingSchema.parse(s.blocking).actors[0].name, "林乔");
  assert.throws(() =>
    blockingSchema.parse({
      ...s.blocking,
      camera: { ...s.blocking.camera, x: 200 },
    }),
  );
  delete s.blocking;
  assert.equal(draftSchema.parse({ shots: [s] }).shots[0].blocking, undefined);
  assert.throws(() =>
    storyboardImageSchema.parse("data:image/svg+xml;base64,PHN2Zz4="),
  );
  assert.throws(() =>
    storyboardImageSchema.parse("https://example.com/image.png"),
  );
});
test("updated floor plan is included in the copied production prompt", () => {
  const p = clone();
  p.shots[0].blocking.camera.x = 61;
  assert.match(compilePrompt(p.shots[0], p), /机位草图/);
  assert.match(compilePrompt(p.shots[0], p), /"x":61/);
});
test("timing counts concurrent action only once and keeps pauses", () => {
  const s = {
    dialogue: [{ text: "一二三四五六七八" }],
    speakingCps: 4,
    actionSeconds: 3,
    pauseSeconds: 1,
    overlap: true,
  };
  assert.equal(timing(s).seconds, 4);
  s.overlap = false;
  assert.equal(timing(s).seconds, 6);
  assert.equal(timing(s).measured, false);
});
test("script line IDs preserve blank lines and exact text", () => {
  assert.deepEqual(scriptLines("甲\r\n\r\n乙"), [
    { id: 1, text: "甲" },
    { id: 2, text: "" },
    { id: 3, text: "乙" },
  ]);
});
test("outline must cover the source with continuous ranges", () => {
  assert.throws(() =>
    validateOutline(
      { scenes: [{ sourceStart: 2, sourceEnd: 7 }] },
      scriptLines(fixture.script),
    ),
  );
});
test("outline absorbs blank-only gaps and trailing separators", () => {
  const outline = {
    scenes: [
      { sourceStart: 1, sourceEnd: 1 },
      { sourceStart: 3, sourceEnd: 3 },
    ],
  };
  validateOutline(outline, scriptLines("甲\n\n乙\n\n"));
  assert.deepEqual(
    outline.scenes.map(({ sourceStart, sourceEnd }) => [sourceStart, sourceEnd]),
    [
      [1, 1],
      [2, 5],
    ],
  );
});
test("outline still rejects gaps containing source text", () => {
  assert.throws(() =>
    validateOutline(
      {
        scenes: [
          { sourceStart: 1, sourceEnd: 1 },
          { sourceStart: 3, sourceEnd: 3 },
        ],
      },
      scriptLines("甲\n漏掉的原文\n乙"),
    ),
  );
});
test("model output normalization repairs common compatible-provider values", () => {
  const shot = structuredClone(fixture.shots[0]);
  shot.dialogue = [];
  shot.continuityIn = null;
  shot.continuityOut = null;
  shot.speakingCps = 0;
  shot.actionSeconds = "3秒";
  shot.pauseSeconds = "1";
  shot.overlap = "否";
  shot.blocking.camera.x = 100;
  shot.blocking.light.y = 0;
  const parsed = draftSchema.parse(normalizeDraftOutput({ shots: [shot] }));
  assert.equal(parsed.shots[0].continuityIn, "无明确前置状态");
  assert.equal(parsed.shots[0].speakingCps, 4);
  assert.equal(parsed.shots[0].actionSeconds, 3);
  assert.equal(parsed.shots[0].pauseSeconds, 1);
  assert.equal(parsed.shots[0].overlap, false);
  assert.equal(parsed.shots[0].blocking.camera.x, 95);
  assert.equal(parsed.shots[0].blocking.light.y, 5);
});
test("art and review normalization keep valid identities and fill harmless omissions", () => {
  const shots = fixture.shots.slice(0, 2);
  const art = artSchema.parse(
    normalizeArtOutput(
      { shots: [{ id: shots[0].id, lighting: null, music: null }] },
      shots,
    ),
  );
  assert.deepEqual(
    art.shots.map((shot) => shot.id),
    shots.map((shot) => shot.id),
  );
  assert.equal(art.shots[0].lighting, shots[0].lighting);
  const audit = auditSchema.parse(
    normalizeAuditOutput(
      {
        issues: [
          {
            shotId: "不存在的镜号",
            severity: "错误",
            category: null,
            message: "需要复核",
            suggestion: null,
          },
        ],
      },
      shots,
    ),
  );
  assert.deepEqual(audit.issues[0], {
    shotId: "",
    severity: "error",
    category: "综合审阅",
    message: "需要复核",
    suggestion: "请人工复核并调整",
  });
});
test("fabricated or altered dialogue is rejected", () => {
  const p = clone();
  p.shots[1].dialogue[0].text = "你没有想清楚。";
  assert.throws(() => checkShots(p.shots, scriptLines(p.script)), /不一致/);
});
test("missing source and duplicated dialogue create specific review issues", () => {
  const p = clone();
  p.shots.splice(2, 1);
  assert.ok(
    checkShots(p.shots, scriptLines(p.script)).some(
      (x) => x.category === "对白覆盖",
    ),
  );
  const q = clone();
  q.shots.push({ ...q.shots[1], id: "duplicate" });
  assert.ok(
    checkShots(q.shots, scriptLines(q.script)).some(
      (x) => x.category === "对白重复",
    ),
  );
});
test("script metadata labels are not mistaken for spoken dialogue", () => {
  const lines = scriptLines("标题：最后一班公交");
  const shot = {
    ...structuredClone(fixture.shots[0]),
    sourceLines: [1],
    dialogue: [],
  };
  assert.equal(
    checkShots([shot], lines).some((issue) => issue.category === "对白覆盖"),
    false,
  );
});
test("prompt is rebuilt from current editable fields", () => {
  const p = clone();
  p.shots[0].lighting = "桌灯关闭，只保留窗外冷光";
  assert.match(compilePrompt(p.shots[0], p), /桌灯关闭/);
});
test("reference example contains valid source mapping without missing dialogue", () => {
  assert.deepEqual(checkShots(fixture.shots, scriptLines(fixture.script)), []);
});
test("both providers use server-side authorization and JSON contract", async () => {
  for (const name of ["openai", "doubao"]) {
    let recorded;
    await requestJSON(
      { name, model: "test-model", key: "test-secret" },
      "JSON",
      "test",
      {
        fetchImpl: async (url, init) => {
          recorded = { url, ...init };
          return new Response(
            JSON.stringify({
              choices: [
                { message: { content: '{"ok":true}' }, finish_reason: "stop" },
              ],
            }),
          );
        },
      },
    );
    assert.equal(recorded.headers.Authorization, "Bearer test-secret");
    assert.equal(JSON.parse(recorded.body).response_format.type, "json_object");
    assert.ok(
      recorded.url.includes(
        name === "openai" ? "api.openai.com" : "volces.com",
      ),
    );
  }
});

test("GPT and domestic compatible models use their documented token parameter", async () => {
  for (const [model, parameter] of [
    ["gpt-5.4-mini-official", "max_completion_tokens"],
    ["deepseek-v4-flash", "max_tokens"],
    ["glm-5.3-flash", "max_tokens"],
    ["qwen3.5-flash", "max_tokens"],
  ]) {
    let body;
    await requestJSON({ name: "openai", model, key: "test-secret" }, "JSON", "test", {
      fetchImpl: async (_url, options) => {
        body = JSON.parse(options.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
      },
    });
    assert.equal(body[parameter], model === "deepseek-v4-flash" ? 32000 : 14000);
    assert.equal(body[parameter === "max_tokens" ? "max_completion_tokens" : "max_tokens"], undefined);
  }
});
test("provider errors do not echo keys or upstream error payload", async () => {
  await assert.rejects(
    () =>
      requestJSON({ name: "openai", model: "m", key: "private" }, "JSON", "x", {
        fetchImpl: async () =>
          new Response("private account detail", { status: 401 }),
      }),
    (e) => !e.message.includes("private") && e.message.includes("认证"),
  );
});
test("truncated completion is a failure, not successful partial data", async () => {
  await assert.rejects(
    () =>
      requestJSON({ name: "openai", model: "m", key: "x" }, "JSON", "x", {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: { content: '{"ok":true}' },
                  finish_reason: "length",
                },
              ],
            }),
          ),
      }),
    (error) =>
      error.code === "length" &&
      error.repairable === true &&
      error.message.includes("长度上限"),
  );
});
test("compatible JSON parser accepts complete fenced or wrapped objects", () => {
  assert.deepEqual(parseModelJSON('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(parseModelJSON('<think>分析中</think>结果：\n{"ok":true}\n完成'), { ok: true });
  assert.throws(() => parseModelJSON('说明：{"ok":true'), /有效 JSON/);
});
test("invalid structured output receives bounded repair attempts", async () => {
  let n = 0;
  const parsed = await modelJSON({}, "JSON", "request", draftSchema, {
    call: async () => ({ value: ++n === 1 ? {} : { shots: fixture.shots } }),
  });
  assert.equal(n, 2);
  assert.equal(parsed.shots.length, 4);
});
test("invalid JSON and truncated output are rebuilt while failed usage is retained", async () => {
  for (const code of ["invalid_json", "length"]) {
    let calls = 0;
    const prompts = [];
    const usage = [];
    const retries = [];
    const parsed = await modelJSON({}, "JSON", "request", draftSchema, {
      call: async (_provider, _system, user) => {
        prompts.push(user);
        if (calls++ === 0)
          throw Object.assign(new Error("bad output"), {
            code,
            repairable: true,
            usage: { total_tokens: 9 },
          });
        return { value: { shots: fixture.shots }, usage: { total_tokens: 10 } };
      },
      onUsage: (value) => usage.push(value.total_tokens),
      onRetry: (value) => retries.push(value),
    });
    assert.equal(parsed.shots.length, 4);
    assert.deepEqual(usage, [9, 10]);
    assert.equal(retries[0].code, code);
    assert.match(prompts[1], code === "length" ? /长度上限截断/ : /完整 JSON/);
  }
});
test("transient provider failures retry once and authentication failures do not retry", async () => {
  let transientCalls = 0;
  const parsed = await modelJSON({}, "JSON", "request", draftSchema, {
    call: async () => {
      if (transientCalls++ === 0)
        throw Object.assign(new Error("temporary"), {
          code: "http_429",
          retryable: true,
        });
      return { value: { shots: fixture.shots } };
    },
    sleep: async () => {},
  });
  assert.equal(parsed.shots.length, 4);
  assert.equal(transientCalls, 2);

  let authCalls = 0;
  await assert.rejects(
    () =>
      modelJSON({}, "JSON", "request", draftSchema, {
        call: async () => {
          authCalls++;
          throw Object.assign(new Error("认证失败"), { code: "http_401" });
        },
        sleep: async () => {},
      }),
    /认证失败/,
  );
  assert.equal(authCalls, 1);
});
test("persistent schema failures stop after two repair attempts", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      modelJSON({}, "JSON", "request", draftSchema, {
        call: async () => {
          calls++;
          return { value: {} };
        },
      }),
    /自动修复两次/,
  );
  assert.equal(calls, 3);
});
test("pipeline orchestrates four stages, stores checkpoints and marks ready only after review (mock model)", async () => {
  const p = {
    ...clone(),
    outline: null,
    shots: [],
    completedScenes: [],
    usage: [],
    status: "running",
  };
  let calls = 0;
  const outputs = [
    fixture.outline,
    { shots: fixture.shots },
    { shots: fixture.shots },
    { issues: [] },
  ];
  const snapshots = [];
  await runPipeline(
    p,
    { name: "openai", model: "mock", key: "test" },
    {
      signal: new AbortController().signal,
      save: (p) => snapshots.push(structuredClone(p)),
      call: async () => ({
        value: outputs[calls++],
        usage: { total_tokens: 1 },
      }),
    },
  );
  assert.equal(calls, 4);
  assert.equal(p.status, "ready");
  assert.equal(p.shots.length, 4);
  assert.ok(
    snapshots.some(
      (s) => s.completedScenes.length === 1 && s.status === "running",
    ),
  );
  assert.equal(p.usage.length, 4);
});
test("resume keeps completed scene edits and only repeats review (mock model)", async () => {
  const p = { ...clone(), completedScenes: [0], usage: [], status: "running" };
  p.shots[0].description = "保留的人工修改";
  let calls = 0;
  await runPipeline(
    p,
    {},
    {
      signal: new AbortController().signal,
      save: () => {},
      call: async () => {
        calls++;
        return { value: { issues: [] } };
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(p.shots[0].description, "保留的人工修改");
});
test("real skill excerpts reach the model at each stage; runtime is never targeted (mock model)", async () => {
  const p = {
    ...clone(),
    targetSeconds: 15,
    outline: null,
    shots: [],
    completedScenes: [],
    usage: [],
    status: "running",
  };
  const outputs = [
      fixture.outline,
      { shots: fixture.shots },
      { shots: fixture.shots },
      { issues: [] },
    ],
    requests = [];
  await runPipeline(
    p,
    {},
    {
      signal: new AbortController().signal,
      save: () => {},
      call: async (_provider, system, user) => {
        requests.push({ system, user });
        return { value: outputs[requests.length - 1] };
      },
    },
  );
  assert.match(
    requests[0].system,
    /Higgsfield 创作参考：higgsfield-shotlist-director/,
  );
  assert.match(
    requests[1].system,
    /Truthful behavior under imaginary circumstances/,
  );
  assert.match(requests[1].system, /Dolly In/);
  assert.match(requests[2].system, /Motivated lighting/);
  assert.match(requests[2].system, /The Four Audio Layers/);
  for (const r of requests) {
    assert.ok(!r.user.includes("targetSeconds"));
    assert.match(r.system, /不反推预算/);
  }
  assert.deepEqual(p.ruleLibrary, ruleProvenance());
  assert.equal(p.ruleLibrary.skills.length, 5);
});
