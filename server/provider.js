import { config } from "./storage.js";
export function selectedProvider() {
  const c = config(),
    p = c[c.provider];
  if (!p?.key || !p?.model)
    throw new Error("请先在模型设置中配置 API Key 和模型 ID。");
  return { ...p, name: c.provider };
}
export function endpoint(name, baseUrl) {
  const base =
    baseUrl || (name === "openai"
      ? process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
      : process.env.DOUBAO_BASE_URL ||
        "https://ark.cn-beijing.volces.com/api/v3");
  return base.replace(/\/$/, "") + "/chat/completions";
}
export function parseModelJSON(raw) {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const candidates = [
    cleaned,
    cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  // Some compatible gateways prepend or append prose despite JSON mode.
  // Only accept a complete, balanced JSON object; schema validation follows.
  for (let start = 0; start < cleaned.length; start++) {
    if (cleaned[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < cleaned.length; end++) {
      const char = cleaned[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, end + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error("模型未返回有效 JSON，本次阶段未保存。");
}
function providerError(message, code, options = {}) {
  return Object.assign(new Error(message), {
    code,
    retryable: false,
    repairable: false,
    usage: null,
    delayMs: 0,
    ...options,
  });
}
export async function requestJSON(
  provider,
  system,
  user,
  { signal, fetchImpl = fetch, maxTokens } = {},
) {
  // DeepSeek V4 Flash counts reasoning tokens against the same output budget.
  // Its multi-shot JSON can exhaust the generic cap before the JSON is done.
  const outputLimit = maxTokens ?? (provider.model === "deepseek-v4-flash" ? 32000 : 14000);
  const body = {
    model: provider.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  };
  // GPT reasoning models use max_completion_tokens; the other compatible
  // providers documented by ToAPIs use max_tokens.
  body[/^(gpt-|o\d)/i.test(provider.model) ? "max_completion_tokens" : "max_tokens"] = outputLimit;
  let r;
  try {
    r = await fetchImpl(endpoint(provider.name, provider.baseUrl), {
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
    if (signal?.aborted) throw providerError("任务已取消。", "cancelled");
    const timeout = e.name === "TimeoutError";
    throw providerError(
      timeout
        ? "模型响应超时，已完成阶段已保存。"
        : "模型连接失败，请检查服务端网络和 API 配置。",
      timeout ? "timeout" : "network",
      { retryable: true, delayMs: 1500 },
    );
  }
  if (!r.ok) {
    const code = r.status;
    const retryAfter = Number(r.headers.get("retry-after"));
    throw providerError(
      code === 401 || code === 403
        ? "模型认证失败，请检查 API Key 与模型权限。"
        : code === 429
          ? "模型额度不足或限流，请检查账户。"
          : code === 400
            ? "模型拒绝了请求参数，请确认模型支持 Chat Completions、JSON 输出与输出长度参数。"
            : `模型服务返回 HTTP ${code}。`,
      `http_${code}`,
      {
        retryable: code === 429 || code >= 500,
        delayMs: Number.isFinite(retryAfter)
          ? Math.min(5000, Math.max(500, retryAfter * 1000))
          : 1500,
      },
    );
  }
  let data;
  try {
    data = await r.json();
  } catch {
    throw providerError("模型服务没有返回有效响应。", "response_json", {
      retryable: true,
      delayMs: 1000,
    });
  }
  const c = data.choices?.[0];
  if (c?.finish_reason === "length")
    throw providerError(
      "模型输出达到长度上限。",
      "length",
      { repairable: true, usage: data.usage || null },
    );
  if (c?.message?.refusal)
    throw providerError(
      "模型未能处理本次内容，请检查剧本或更换有权限的模型。",
      "refusal",
      { usage: data.usage || null },
    );
  const raw = c?.message?.content;
  if (typeof raw !== "string")
    throw providerError("模型未返回文本结果。", "missing_content", {
      repairable: true,
      usage: data.usage || null,
    });
  let value;
  try {
    value = parseModelJSON(raw);
  } catch {
    throw providerError("模型未返回完整有效的 JSON。", "invalid_json", {
      repairable: true,
      usage: data.usage || null,
    });
  }
  return { value, usage: data.usage || null };
}
export async function modelJSON(
  provider,
  system,
  user,
  schema,
  {
    signal,
    onUsage,
    onRetry,
    check,
    normalize,
    call = requestJSON,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  let feedback = "";
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let result;
    try {
      result = await call(provider, system, user + feedback, { signal });
    } catch (e) {
      onUsage?.(e.usage);
      const allowedAttempts = e.retryable ? 2 : maxAttempts;
      if (
        signal?.aborted ||
        (!e.retryable && !e.repairable) ||
        attempt + 1 >= allowedAttempts
      ) {
        if ((e.retryable || e.repairable) && attempt > 0)
          throw Object.assign(
            new Error(`自动重试 ${attempt} 次后仍失败：${e.message}`),
            { code: e.code },
          );
        throw e;
      }
      feedback = e.repairable
        ? e.code === "length"
          ? "\n上次输出被长度上限截断。请从头重建完整 JSON，使用更少镜头和更短字段，不要解释，不要延续残缺内容。"
          : "\n上次响应不是完整 JSON。请从头重建一个完整、精简、可解析的 JSON 对象，不加解释或 Markdown。"
        : "";
      onRetry?.({
        attempt: attempt + 1,
        maxRetries: allowedAttempts - 1,
        code: e.code || "provider",
        message: e.message,
        kind: e.retryable ? "transport" : "output",
      });
      if (e.retryable) await sleep(e.delayMs || 1000);
      continue;
    }
    onUsage?.(result.usage);
    try {
      const parsed = schema.parse(normalize ? normalize(result.value) : result.value);
      check?.(parsed);
      return parsed;
    } catch (e) {
      if (attempt === maxAttempts - 1)
        throw new Error(
          "模型结果自动修复两次后仍未通过校验：" +
            (e.issues
              ? e.issues
                  .map((x) => x.path.join(".") + "：" + x.message)
                  .slice(0, 8)
                  .join("；")
              : e.message),
        );
      feedback =
        "\n上次输出校验失败。请根据下面错误从头重建完整且精简的 JSON，不要只返回局部修补：" +
        (e.issues
          ? e.issues
              .map((x) => x.path.join(".") + ":" + x.message)
              .slice(0, 12)
              .join(";")
          : e.message);
      onRetry?.({
        attempt: attempt + 1,
        maxRetries: maxAttempts - 1,
        code: "validation",
        message: e.message,
        kind: "validation",
      });
    }
  }
}
