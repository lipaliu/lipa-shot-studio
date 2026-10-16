const imageTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function imageUrl(baseUrl, taskId = "") {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    throw new Error("图片 API 地址必须是 HTTPS Base URL。");
  const path = base.pathname.replace(/\/$/, "");
  return `${base.origin}${path}/images/generations${taskId ? `/${encodeURIComponent(taskId)}` : ""}`;
}

async function responseJSON(response) {
  if (!response.ok) {
    if ([401, 403].includes(response.status))
      throw new Error("图片 API 认证失败，请检查密钥及模型权限。");
    if (response.status === 429)
      throw new Error("图片 API 额度不足或被限流。");
    throw new Error(`图片 API 返回 HTTP ${response.status}，请检查模型 ID 与参数。`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("图片 API 没有返回有效 JSON。");
  }
}

function resultUrl(task) {
  return task.result?.data?.[0]?.url || task.data?.[0]?.url || task.url;
}

const request = (fetchImpl, url, options = {}) =>
  fetchImpl(url, { ...options, signal: AbortSignal.timeout(30000) });

export async function startImageTask(
  image,
  prompt,
  aspect,
  { fetchImpl = fetch } = {},
) {
  if (!image.key || !image.model) throw new Error("请先在设置中配置图片模型。");
  const headers = {
    Authorization: `Bearer ${image.key}`,
    "Content-Type": "application/json",
  };
  const task = await responseJSON(
    await request(fetchImpl, imageUrl(image.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: image.model,
        prompt,
        size: aspect,
        n: 1,
        ...(/^(qwen-image-3\.0(?:-pro)?)$/.test(image.model)
          ? { resolution: "1K", metadata: { prompt_extend: true, watermark: false } }
          : /^doubao-seedream-5-0(?:-pro)?$/.test(image.model)
            ? { metadata: { resolution: "2K" } }
            : { resolution: "1k", response_format: "url" }),
      }),
    }),
  );
  if (!task.id) throw new Error("图片 API 没有返回任务 ID。");
  return task;
}

export async function finishImageTask(
  image,
  initialTask,
  { fetchImpl = fetch, sleep = wait, attempts = 240, onProgress } = {},
) {
  const headers = { Authorization: `Bearer ${image.key}` };
  let task = initialTask;
  for (let i = 0; i < attempts && task.status !== "completed"; i++) {
    if (task.status === "failed")
      throw new Error(`图片生成失败：${task.error?.message || "模型没有返回图片"}`);
    if (!task.id) throw new Error("图片 API 没有返回任务 ID。");
    await sleep(3000);
    task = await responseJSON(
      await request(fetchImpl, imageUrl(image.baseUrl, task.id), { headers }),
    );
    if (task.status !== "completed") onProgress?.(task);
  }
  if (task.status !== "completed") throw new Error("图片生成等待超时，可稍后查看任务日志。");
  const remote = resultUrl(task);
  if (typeof remote !== "string") throw new Error("图片任务已完成，但没有返回图片地址。");
  return downloadImage(remote, { fetchImpl });
}

export async function downloadImage(remote, { fetchImpl = fetch } = {}) {
  const url = new URL(remote);
  if (
    url.protocol !== "https:" ||
    !["toapis.com", "toapis.cn"].some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    )
  )
    throw new Error("图片结果地址不属于 ToAPIs，已停止下载。");
  const response = await request(fetchImpl, url, { redirect: "error" });
  if (!response.ok) throw new Error("图片已生成，但下载到本地失败。");
  const mime = response.headers.get("content-type")?.split(";")[0].toLowerCase();
  if (!imageTypes[mime]) throw new Error("图片结果不是受支持的 PNG、JPEG 或 WebP。");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("生成图片超过 8 MB，请降低分辨率。");
    }
    chunks.push(value);
  }
  return { bytes: Buffer.concat(chunks), mime, extension: imageTypes[mime] };
}

export async function generateImage(image, prompt, aspect, options = {}) {
  const task = await startImageTask(image, prompt, aspect, options);
  return finishImageTask(image, task, options);
}
