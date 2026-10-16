export type Category = { id: string; name: string; color: string };
export type Question = {
  id: string;
  title: string;
  categoryId: string;
  text: string;
  options?: string;
  explanation: string;
  questionImages: string[];
  explanationImages: string[];
  answer: string;
  myAnswer: string;
  notes: string;
  tags: string[];
  status: "pending" | "reviewing" | "mastered";
  favorite: boolean;
  reviews: number;
  createdAt: string;
  updatedAt: string;
  sourcePageId?: string;
  sourceBounds?: Box;
  sourceRotation?: number;
};
export type Draft = Omit<Question, "id" | "createdAt" | "updatedAt">;
export type Config = {
  mode: "demo" | "postgres";
  aiConfigured: boolean;
  aiModel: string;
  autoRecognize: boolean;
  recognitionConfigured: boolean;
  user: User;
};
export type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  questionId?: string;
  status?: "streaming" | "complete" | "stopped" | "error";
};
export const emptyDraft = (): Draft => ({
  title: "",
  categoryId: "",
  text: "",
  options: "",
  explanation: "",
  questionImages: [],
  explanationImages: [],
  answer: "",
  myAnswer: "",
  notes: "",
  tags: [],
  status: "pending",
  favorite: false,
  reviews: 0,
});
export const statusLabels = {
  pending: "待复习",
  reviewing: "巩固中",
  mastered: "已掌握",
};
export { splitQuestion } from "../shared/question-text.mjs";
export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + url, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const body = await response
    .json()
    .catch(() => ({ error: "服务暂时不可用，请检查连接" }));
  if (response.status === 401 && !url.startsWith("/auth/"))
    window.dispatchEvent(new Event("shiti:unauthorized"));
  if (!response.ok)
    throw Object.assign(new Error(body.error || "请求失败"), {
      status: response.status,
      code: body.code,
    });
  return body as T;
}
export async function streamAI(
  input: Record<string, unknown>,
  onContent: (content: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch("/api/ai", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ ...input, stream: true }),
    signal,
  });
  if (response.status === 401)
    window.dispatchEvent(new Event("shiti:unauthorized"));
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || "AI 服务暂时不可用，请重试"), {
      status: response.status,
      code: body.code,
    });
  }
  if (
    !response.headers.get("content-type")?.includes("text/event-stream") ||
    !response.body
  )
    throw new Error("服务未返回流式回复，请刷新页面后重试");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let complete = false;
  const frame = (raw: string) => {
    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    const event = JSON.parse(data) as {
      type: string;
      text?: string;
      error?: string;
      code?: string;
    };
    if (event.type === "error")
      throw Object.assign(new Error(event.error || "生成中断，请重试"), {
        code: event.code,
      });
    if (event.type === "delta" && event.text) {
      content += event.text;
      onContent(content);
    }
    if (event.type === "done") complete = true;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        frame(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator[0].length);
      }
      if (complete) return content;
      if (buffer.length > 2 * 1024 * 1024)
        throw new Error("AI 回复数据异常，请重试");
      if (done) {
        if (buffer.trim()) frame(buffer);
        if (!complete)
          throw new Error("连接已中断，已保留收到的回复，可以重试。");
        return content;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export const dateLabel = (date: string) =>
  new Date(date)
    .toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })
    .replace("/", ".");
export async function imageFromFile(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "请使用 JPG、PNG 或 WebP 图片。iPhone 可在相机设置中选择“兼容性最佳”。",
    );
  if (file.size > 20 * 1024 * 1024) throw new Error("单张图片请小于 20MB");
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器无法处理图片");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/jpeg", 0.85);
    if (result.length > 3 * 1024 * 1024)
      throw new Error("图片压缩后仍过大，请裁剪后重试");
    return result;
  } finally {
    bitmap.close();
  }
}

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  active: boolean;
  createdAt: string;
};
export type Box = { x: number; y: number; width: number; height: number };
export type SourcePage = {
  id: string;
  image: string;
  filename: string;
  width: number;
  height: number;
  rotation: number;
  createdAt: string;
};
