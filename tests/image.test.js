import test from "node:test";
import assert from "node:assert/strict";
import { generateImage, startImageTask } from "../server/image.js";
import { storyboardImageSchema } from "../server/schema.js";

const settings = {
  model: "gpt-image-2",
  key: "private-test-key",
  baseUrl: "https://toapis.cn/v1",
};

test("ToAPIs image request polls its task and downloads a supported image", async () => {
  const calls = [];
  const replies = [
    { id: "task-1", status: "queued" },
    { id: "task-1", status: "in_progress" },
    {
      id: "task-1",
      status: "completed",
      result: { data: [{ url: "https://files.toapis.com/generated/frame.jpg" }] },
    },
  ];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length <= 3)
      return new Response(JSON.stringify(replies[calls.length - 1]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    return new Response(Buffer.from("jpeg-bytes"), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  };
  const result = await generateImage(settings, "一张雨夜咖啡馆分镜", "9:16", {
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(result.extension, "jpg");
  assert.equal(result.bytes.toString(), "jpeg-bytes");
  assert.equal(calls[0].url, "https://toapis.cn/v1/images/generations");
  assert.equal(calls[1].url, "https://toapis.cn/v1/images/generations/task-1");
  assert.equal(JSON.parse(calls[0].options.body).size, "9:16");
  assert.equal(calls[0].options.headers.Authorization, "Bearer private-test-key");
  assert.equal(calls[3].url, "https://files.toapis.com/generated/frame.jpg");
});

test("image results cannot make the server download an unrelated host", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({ id: "task-unsafe", status: "completed", result: { data: [{ url: "https://example.com/secret" }] } }),
      { status: 200 },
    );
  await assert.rejects(
    generateImage(settings, "test", "1:1", { fetchImpl }),
    /不属于 ToAPIs/,
  );
});

test("Qwen and Seedream presets send their model-specific image options", async () => {
  for (const [model, expected] of [
    ["qwen-image-3.0", { resolution: "1K", metadata: { prompt_extend: true, watermark: false } }],
    ["doubao-seedream-5-0", { metadata: { resolution: "2K" } }],
  ]) {
    let body;
    await startImageTask({ ...settings, model }, "测试图", "16:9", {
      fetchImpl: async (_url, options) => {
        body = JSON.parse(options.body);
        return new Response(JSON.stringify({ id: "task-1", status: "queued" }));
      },
    });
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(body[key], value);
    assert.equal(body.response_format, undefined);
    assert.equal(body.size, "16:9");
  }
});

test("saved generated image paths are accepted but external image URLs are rejected", () => {
  assert.equal(
    storyboardImageSchema.parse("/api/images/123e4567-e89b-42d3-a456-426614174000.jpg"),
    "/api/images/123e4567-e89b-42d3-a456-426614174000.jpg",
  );
  assert.throws(() => storyboardImageSchema.parse("https://example.com/image.jpg"));
});
