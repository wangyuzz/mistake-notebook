import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { decrypt, encrypt } from "./auth.mjs";
import { promptDefaults, recognitionOutputRules } from "./prompts.mjs";
import { splitQuestion } from "../shared/question-text.mjs";
import { eventData } from "./sse.mjs";
export const reasoningLevels = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const promptFields = Object.fromEntries(
  Object.entries(promptDefaults).map(([name, value]) => [
    name,
    z.string().trim().min(1).max(16000).default(value),
  ]),
);
export const fail = (status, message, errorCode) =>
  Object.assign(new Error(message), { status, errorCode });
export const boxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.02).max(1),
    height: z.number().min(0.02).max(1),
  })
  .refine(
    (b) => b.x + b.width <= 1.001 && b.y + b.height <= 1.001,
    "裁图范围必须位于图片内",
  );
export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z
    .string()
    .url()
    .refine(
      (v) => ["https:", "http:"].includes(new URL(v).protocol),
      "API 必须使用 HTTP 或 HTTPS",
    ),
  model: z.string().trim().max(120),
  recognitionModel: z.string().trim().max(120).default(""),
  reasoningEffort: z.enum(reasoningLevels).default("default"),
  recognitionReasoningEffort: z
    .enum(["inherit", ...reasoningLevels])
    .default("inherit"),
  ...promptFields,
  autoRecognize: z.boolean().default(true),
  perMinuteLimit: z.number().int().min(1).max(120).default(12),
  dailyLimit: z.number().int().min(1).max(10000).default(200),
  timeoutMs: z.number().int().min(5000).max(180000).default(90000),
  apiKey: z.string().max(4000).optional(),
  clearApiKey: z.boolean().optional(),
});
export async function effectiveSettings(store, key, defaults = {}) {
  const saved = await store.getSettings();
  if (saved)
    return {
      ...promptDefaults,
      reasoningEffort: "default",
      recognitionReasoningEffort: "inherit",
      ...saved,
      apiKey: decrypt(saved.encryptedApiKey, key),
    };
  return {
    ...promptDefaults,
    reasoningEffort: "default",
    recognitionReasoningEffort: "inherit",
    enabled: true,
    baseUrl:
      defaults.aiBase ||
      process.env.AI_API_BASE_URL ||
      "https://api.openai.com/v1",
    apiKey: defaults.aiKey ?? process.env.AI_API_KEY ?? "",
    model: defaults.aiModel ?? process.env.AI_MODEL ?? "",
    recognitionModel: process.env.AI_RECOGNITION_MODEL || "",
    autoRecognize: true,
    perMinuteLimit: 12,
    dailyLimit: 200,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 90000,
  };
}
export function safeSettings(s) {
  const { apiKey, encryptedApiKey, ...safe } = s;
  return {
    ...safe,
    recognitionOutputRules,
    apiKeyConfigured: !!apiKey,
    apiKeyHint: apiKey ? "•••• " + apiKey.slice(-4) : "",
    configured: !!(s.enabled && apiKey && s.model),
  };
}
export function sealedSettings(parsed, old, key) {
  const { apiKey, clearApiKey, ...rest } = parsed;
  const secret = clearApiKey ? "" : apiKey?.trim() || old.apiKey || "";
  return { ...rest, encryptedApiKey: encrypt(secret, key) };
}
export async function imageUrl(src) {
  return src.startsWith("/samples/")
    ? "data:image/png;base64," +
        (await fs.readFile(path.resolve("public", "." + src))).toString(
          "base64",
        )
    : src;
}
export async function completeAI(
  settings,
  messages,
  res,
  model = settings.model,
  reasoningEffort = settings.reasoningEffort,
  streaming,
) {
  if (!settings.enabled || !settings.apiKey || !model)
    throw fail(
      503,
      "AI 尚未接入，请联系管理员配置识别服务。手动框题和录入仍然可用。",
      "AI_CONFIGURATION",
    );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
  const stop = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.on("close", stop);
  try {
    const response = await fetch(
      settings.baseUrl.replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + settings.apiKey,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages,
          stream: !!streaming,
          ...(reasoningEffort && reasoningEffort !== "default"
            ? { reasoning_effort: reasoningEffort }
            : {}),
        }),
      },
    );
    if (!response.ok) {
      const invalidEffort =
        [400, 422].includes(response.status) &&
        reasoningEffort &&
        reasoningEffort !== "default";
      throw fail(
        502,
        invalidEffort
          ? "AI 服务拒绝了请求参数，请检查模型是否支持当前思考等级；可改为跟随模型默认后重试。"
          : response.status === 401
            ? "AI 服务认证失败，请联系管理员检查密钥。"
            : response.status === 429
              ? "AI 服务繁忙或额度不足，请稍后重试。"
              : "AI 服务请求失败，请检查模型的图片能力和 API 地址。",
        invalidEffort || [401, 403, 404].includes(response.status)
          ? "AI_CONFIGURATION"
          : undefined,
      );
    }
    if (
      streaming &&
      response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      streaming.start();
      let content = "";
      let completed = false;
      let finishReason;
      for await (const payload of eventData(response.body)) {
        if (payload.trim() === "[DONE]") {
          completed = true;
          break;
        }
        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          throw fail(502, "AI 流式数据格式异常，已保留收到的内容，请重试。");
        }
        if (chunk.error)
          throw fail(502, "AI 服务中断了生成，已保留收到的内容，请重试。");
        const choice =
          chunk.choices?.find((c) => c.index === 0) || chunk.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta?.content || choice?.delta?.refusal;
        if (typeof delta === "string" && delta) {
          content += delta;
          await streaming.delta(delta);
        }
      }
      if (!completed && !finishReason)
        throw fail(502, "AI 连接提前断开，已保留收到的内容，请重试。");
      if (finishReason === "length")
        throw fail(
          502,
          "回复达到模型长度上限，已保留收到的内容，可以继续提问。",
        );
      if (finishReason === "content_filter")
        throw fail(502, "AI 服务未能完成这次回复，已保留收到的内容。");
      if (!content.trim()) throw fail(502, "AI 没有返回可用内容，请重新尝试");
      return content;
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
      throw fail(502, "AI 没有返回可用内容，请重新尝试");
    // Some compatible providers ignore stream=true and return one JSON response.
    if (streaming) {
      streaming.start();
      await streaming.delta(content);
    }
    return content;
  } catch (e) {
    if (controller.signal.aborted)
      throw fail(504, "AI 请求已取消或超时，可重试或手动整理");
    if (e.status) throw e;
    throw fail(502, "暂时连接不到 AI 服务，请检查服务地址后重试");
  } finally {
    clearTimeout(timeout);
    res.off("close", stop);
  }
}
export async function streamAI(settings, messages, res) {
  let started = false;
  let heartbeat;
  const send = (event) => {
    if (!res.destroyed && !res.writableEnded)
      res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const start = () => {
    if (started || res.destroyed) return;
    started = true;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    send({ type: "start", model: settings.model });
    heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(": keep-alive\n\n");
    }, 15000);
  };
  try {
    await completeAI(
      settings,
      messages,
      res,
      settings.model,
      settings.reasoningEffort,
      {
        start,
        delta: (text) => send({ type: "delta", text }),
      },
    );
    if (res.destroyed) return;
    send({ type: "done", model: settings.model });
    res.end();
  } catch (error) {
    if (res.destroyed) return;
    if (!started) throw error;
    send({
      type: "error",
      error: error.status
        ? error.message
        : "生成中断，已保留收到的内容，请重试。",
      code: error.errorCode,
    });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
}
export function parseRecognition(raw) {
  let value;
  try {
    const text = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    value = JSON.parse(text);
  } catch {
    throw fail(
      422,
      "AI 返回的拆题格式无法读取。原图已保留，你可以重试或手动框题。",
    );
  }
  const parsed = z
    .object({
      questions: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(120),
            text: z.string().max(30000).default(""),
            options: z.string().max(12000).default(""),
            categoryName: z.string().max(24).default(""),
            tags: z.array(z.string().max(30)).max(12).default([]),
            bbox: boxSchema,
            warning: z.string().max(500).default(""),
          }),
        )
        .min(1)
        .max(10),
    })
    .safeParse(value);
  if (!parsed.success)
    throw fail(422, "AI 没有给出有效的题目范围，请手动框题或重新拍摄。");
  return parsed.data.questions
    .map((question) => ({
      ...question,
      ...splitQuestion(question.text, question.options),
    }))
    .sort((a, b) => a.bbox.y - b.bbox.y);
}
