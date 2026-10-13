import { config } from "./storage.js";
export function selectedProvider() {
  const c = config(),
    p = c[c.provider];
  if (!p?.key || !p?.model)
    throw new Error("请先在模型设置中配置 API Key 和模型 ID。");
  return { ...p, name: c.provider };
}
export function endpoint(name) {
  return name === "openai"
    ? "https://api.openai.com/v1/chat/completions"
    : (
        process.env.DOUBAO_BASE_URL ||
        "https://ark.cn-beijing.volces.com/api/v3"
      ).replace(/\/$/, "") + "/chat/completions";
}
export async function requestJSON(
  provider,
  system,
  user,
  { signal, fetchImpl = fetch, maxTokens = 14000 } = {},
) {
  const body = {
    model: provider.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: maxTokens,
  };
  let r;
  try {
    r = await fetchImpl(endpoint(provider.name), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(240000)])
        : AbortSignal.timeout(240000),
    });
  } catch (e) {
    if (signal?.aborted) throw new Error("任务已取消。");
    throw new Error(
      e.name === "TimeoutError"
        ? "模型响应超时，已完成阶段已保存，可继续。"
        : "模型连接失败，请检查服务端网络和 API 配置。",
    );
  }
  if (!r.ok) {
    const code = r.status;
    throw new Error(
      code === 401 || code === 403
        ? "模型认证失败，请检查 API Key 与模型权限。"
        : code === 429
          ? "模型额度不足或限流，请检查账户后重试。"
          : code === 400
            ? "模型拒绝了请求参数，请确认模型支持 Chat Completions、JSON 输出与 max_completion_tokens。"
            : `模型服务返回 HTTP ${code}，请稍后重试。`,
    );
  }
  const data = await r.json(),
    c = data.choices?.[0];
  if (c?.finish_reason === "length")
    throw new Error("模型输出达到长度上限，请缩短剧本或拆成更小的场次。");
  if (c?.message?.refusal)
    throw new Error("模型未能处理本次内容，请检查剧本或更换有权限的模型。");
  const raw = c?.message?.content;
  if (typeof raw !== "string") throw new Error("模型未返回文本结果。");
  let value;
  try {
    value = JSON.parse(
      raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
    );
  } catch {
    throw new Error("模型未返回有效 JSON，本次阶段未保存。");
  }
  return { value, usage: data.usage || null };
}
export async function modelJSON(
  provider,
  system,
  user,
  schema,
  { signal, onUsage, check, call = requestJSON } = {},
) {
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await call(provider, system, user + feedback, { signal });
    onUsage?.(result.usage);
    try {
      const parsed = schema.parse(result.value);
      check?.(parsed);
      return parsed;
    } catch (e) {
      if (attempt === 1)
        throw new Error(
          "模型结果校验未通过：" +
            (e.issues ? "输出缺少必要字段或字段类型不正确。" : e.message),
        );
      feedback =
        "\n上次输出校验失败，请重建完整 JSON：" +
        (e.issues
          ? e.issues
              .map((x) => x.path.join(".") + ":" + x.message)
              .slice(0, 12)
              .join(";")
          : e.message);
    }
  }
}
