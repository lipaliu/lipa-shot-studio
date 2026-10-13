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
} from "../server/schema.js";
import { runPipeline } from "../server/pipeline.js";
import { requestJSON, modelJSON } from "../server/provider.js";
import { ruleProvenance } from "../server/rules.js";
const fixture = JSON.parse(
  fs.readFileSync(new URL("../examples/example.json", import.meta.url)),
);
const clone = () => structuredClone(fixture);
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
    /长度上限/,
  );
});
test("invalid structured output receives one bounded repair attempt", async () => {
  let n = 0;
  const parsed = await modelJSON({}, "JSON", "request", draftSchema, {
    call: async () => ({ value: ++n === 1 ? {} : { shots: fixture.shots } }),
  });
  assert.equal(n, 2);
  assert.equal(parsed.shots.length, 4);
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
