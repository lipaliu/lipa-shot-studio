import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { once } from "node:events";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lipa-shot-test-"));
let child,
  base,
  cookie = "";
async function call(url, body, method = body ? "POST" : "GET", headers = {}) {
  const r = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return r;
}
test.before(async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: tmp,
      APP_PASSWORD: "test-password-2026",
      OPENAI_API_KEY: "",
      ARK_API_KEY: "",
      DOUBAO_API_KEY: "",
      OPENAI_MODEL: "env-default-model",
      DOUBAO_MODEL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("server start timeout")),
      10000,
    );
    child.stdout.on("data", (d) => {
      if (d.toString().includes("http://")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (c) => {
      clearTimeout(timer);
      reject(new Error("server failed " + c));
    });
  });
});
test.after(async () => {
  if (child && child.exitCode === null) {
    const closed = once(child, "close");
    child.kill("SIGTERM");
    await closed;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});
test("authenticated HTTP workflow: configuration, import, review, persistence and export", async () => {
  assert.equal((await call("/api/projects")).status, 401);
  const login = await call("/api/login", { password: "test-password-2026" });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  const imageName = "123e4567-e89b-42d3-a456-426614174000.png";
  fs.mkdirSync(path.join(tmp, "images"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "images", imageName), Buffer.from("test-image"));
  const imageResponse = await call(`/api/images/${imageName}`);
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers.get("content-type"), /image\/png/);
  assert.equal(
    (
      await call("/api/projects", {}, "POST", {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  const settings = await (await call("/api/settings")).json();
  assert.equal(settings.openai.hasKey, false);
  assert.equal(settings.openai.model, "env-default-model");
  const cfg = await (
    await call(
      "/api/settings",
      {
        provider: "doubao",
        openai: { model: "test", key: "do-not-return" },
        doubao: { model: "", key: "" },
      },
      "PUT",
    )
  ).json();
  assert.equal(cfg.openai.hasKey, true);
  assert.equal(cfg.openai.model, "test", "saved UI model overrides environment default");
  assert.equal((await (await call("/api/settings")).json()).openai.model, "test");
  assert.ok(!JSON.stringify(cfg).includes("do-not-return"));
  const imageCfg = await (
    await call(
      "/api/settings",
      {
        provider: "doubao",
        openai: { model: "test", key: "" },
        doubao: { model: "", key: "" },
        image: {
          model: "gpt-image-2",
          baseUrl: "https://toapis.cn/v1",
          useTextKey: true,
        },
      },
      "PUT",
    )
  ).json();
  assert.equal(imageCfg.image.configured, true);
  assert.ok(!JSON.stringify(imageCfg).includes("do-not-return"));
  const input = await (
    await call("/api/import", {
      name: "test.txt",
      base64: Buffer.from("内景 客厅 夜\n甲：你好。").toString("base64"),
    })
  ).json();
  assert.match(input.text, /你好/);
  assert.equal(
    (await call("/api/import", { name: "bad.exe", base64: "AA==" })).status,
    400,
  );
  assert.equal(
    (await call("/api/projects", { script: "内景 客厅 夜\n甲：你好。" }))
      .status,
    400,
  ); // selected provider is not configured
  const p = await (await call("/api/example", {})).json();
  assert.equal(p.shots.length, 4);
  assert.equal(p.isExample, true);
  let shot = p.shots[0];
  let r = await (
    await call(
      `/api/projects/${p.id}/shots/${shot.id}`,
      { ...shot, status: "approved" },
      "PATCH",
    )
  ).json();
  assert.equal(r.shots[0].status, "approved");
  r = await (
    await call(
      `/api/projects/${p.id}/shots/${shot.id}`,
      { ...shot, lighting: "保留冷窗光，桌灯关闭", status: "approved" },
      "PATCH",
    )
  ).json();
  assert.equal(r.shots[0].status, "draft");
  assert.equal(r.auditStale, true);
  assert.match(r.shots[0].prompt, /桌灯关闭/);
  const refreshed = await (await call("/api/projects/" + p.id)).json();
  assert.equal(refreshed.shots[0].lighting, "保留冷窗光，桌灯关闭");
  const image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhJ8AAAAASUVORK5CYII=";
  const changed = {
    ...refreshed.shots[0],
    storyboardImage: image,
    blocking: {
      ...refreshed.shots[0].blocking,
      camera: { ...refreshed.shots[0].blocking.camera, x: 62 },
    },
  };
  assert.equal(
    (await call(`/api/projects/${p.id}/shots/${shot.id}`, changed, "PATCH"))
      .status,
    200,
  );
  const reopened = await (await call("/api/projects/" + p.id)).json();
  assert.equal(reopened.shots[0].storyboardImage, image);
  assert.equal(reopened.shots[0].blocking.camera.x, 62);
  assert.match(reopened.shots[0].prompt, /"x":62/);
  assert.match(reopened.shots[0].camera, /摄影机\(62,/);
  assert.match(reopened.shots[0].coverage, /【机位同步】人物站位/);
  assert.match(reopened.shots[0].lighting, /【机位同步】主光位置/);
  assert.match(reopened.shots[0].prompt, /空间位置和朝向以此最新草图/);
  assert.equal(reopened.shots[1].camera, refreshed.shots[1].camera);
  assert.equal(
    (
      await call(
        `/api/projects/${p.id}/shots/${shot.id}`,
        { ...changed, storyboardImage: "data:image/svg+xml;base64,PHN2Zz4=" },
        "PATCH",
      )
    ).status,
    400,
  );
  const csv = await (
    await call(`/api/projects/${p.id}/export?format=csv`)
  ).text();
  assert.match(csv, /完整提示词/);
  assert.match(csv, /桌灯关闭/);
  const json = await (
    await call(`/api/projects/${p.id}/export?format=json`)
  ).json();
  assert.equal(json.shots.length, 4);
  assert.ok(!JSON.stringify(json).includes("do-not-return"));
  const tampered = {
    ...shot,
    dialogue: [{ sourceLine: 2, speaker: "林乔", text: "不存在的对白" }],
  };
  assert.equal(
    (await call(`/api/projects/${p.id}/shots/${shot.id}`, tampered, "PATCH"))
      .status,
    400,
  );
});

test("on-demand plan uses only the requested shot and waits for the user's edit to persist", async () => {
  const { createServer } = await import("node:http");
  const project = await (await call("/api/example", {})).json();
  const original = project.shots[0];
  let answer = { ...original.blocking, camera:{...original.blocking.camera,x:71} };
  let count = 0;
  const mock = createServer(async (req,res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const sent = JSON.parse(body);
    const context = JSON.parse(sent.messages[1].content);
    assert.equal(context.shot.id, original.id);
    count++;
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({ choices:[{message:{content:JSON.stringify(answer)},finish_reason:"stop"}] }));
  });
  await new Promise(resolve => mock.listen(0,"127.0.0.1",resolve));
  try {
    await call("/api/settings", { provider:"openai",doubao:{model:""},openai:{key:"mock-only",model:"test",baseUrl:`http://127.0.0.1:${mock.address().port}/v1`} }, "PUT");
    const planned = await call(`/api/projects/${project.id}/shots/${original.id}/blocking`, {});
    assert.equal(planned.status, 200);
    const { blocking } = await planned.json();
    assert.equal(blocking.camera.x,71);
    assert.equal(count,1);
    const unchanged = await (await call(`/api/projects/${project.id}`)).json();
    assert.equal(unchanged.shots[0].blocking.camera.x,original.blocking.camera.x);
    const saved = await (await call(`/api/projects/${project.id}/shots/${original.id}`, {...original,blocking}, "PATCH")).json();
    assert.match(saved.shots[0].prompt,/摄影机\(71,/);
    answer = {...answer,camera:{...answer.camera,x:900}};
    assert.equal((await call(`/api/projects/${project.id}/shots/${original.id}/blocking`,{})).status,400);
    assert.equal((await (await call(`/api/projects/${project.id}`)).json()).shots[0].blocking.camera.x,71);
  } finally { await new Promise(resolve => mock.close(resolve)); }
});
