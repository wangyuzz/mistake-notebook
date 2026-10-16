import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  FileText,
  ImagePlus,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { api, imageFromFile, streamAI } from "./lib";
import type { Config, Draft } from "./lib";
import { Markdown } from "./Markdown";
import { Modal, Spinner } from "./components";

export type AnswerFields = Pick<
  Draft,
  "myAnswer" | "answer" | "explanation" | "explanationImages"
>;
type Task = "reading" | "recognizing" | "analyzing";
export default function AnswerEditor({
  value,
  config,
  onChange,
  buildDraft,
  onBusyChange,
  notify,
  disabled = false,
}: {
  value: AnswerFields;
  config: Config | null;
  onChange: (patch: Partial<AnswerFields>) => void;
  buildDraft: () => Draft | Promise<Draft>;
  onBusyChange: (busy: boolean) => void;
  notify: (text: string) => void;
  disabled?: boolean;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      onBusyChange(false);
    };
  }, [onBusyChange]);
  const working = task !== null;
  async function run(kind: "recognizing" | "analyzing", files: File[] = []) {
    if (controller.current || disabled) return;
    if (kind === "analyzing" && !config?.aiConfigured) {
      setError("AI 服务尚未接入，请联系管理员配置。");
      return;
    }
    if (
      kind === "recognizing" &&
      files.length + value.explanationImages.length > 4
    ) {
      setError("每道题最多保留 4 张解析图片，请先移除多余图片。");
      return;
    }
    const request = new AbortController();
    controller.current = request;
    const signal = request.signal;
    let tooLong = false;
    setTask(files.length ? "reading" : kind);
    onBusyChange(true);
    setError("");
    try {
      if (kind === "recognizing") {
        const added = await Promise.all(files.map(imageFromFile));
        if (signal.aborted || !mounted.current) return;
        const images = files.length
          ? [...value.explanationImages, ...added]
          : value.explanationImages;
        if (added.length) onChange({ explanationImages: images });
        if (!config?.recognitionConfigured)
          throw new Error(
            "图片已保留，文字识别服务尚未接入。可以先手动填写解析。",
          );
        if (!images.length) throw new Error("请先选择解析图片。");
        setTask("recognizing");
        const result = await api<{ text: string }>("/recognize-explanation", {
          method: "POST",
          signal,
          body: JSON.stringify({ images: files.length ? added : images }),
        });
        if (signal.aborted || !mounted.current) return;
        const text = [value.explanation.trimEnd(), result.text.trim()]
          .filter(Boolean)
          .join("\n\n");
        if (text.length > 40000)
          throw new Error(
            "图片已保留，但合并后的解析超过 40000 字，请精简文字后重试识别。",
          );
        onChange({ explanation: text });
        notify("图片文字已追加到解析中，可继续核对修改");
      } else {
        const draft = await buildDraft();
        if (signal.aborted || !mounted.current) return;
        if (!draft.text.trim() && !draft.questionImages.length)
          throw new Error("请先填写题目或保留题目图片。");
        const prefix = value.explanation.trim()
          ? value.explanation.trimEnd() + "\n\n### AI 生成解析\n\n"
          : "";
        if (prefix.length >= 40000)
          throw new Error("现有解析过长，请先精简后再生成。");
        await streamAI(
          { action: "analyze", draft },
          (content) => {
            if (signal.aborted || !mounted.current) return;
            const text = prefix + content;
            onChange({ explanation: text.slice(0, 40000) });
            if (text.length > 40000) {
              tooLong = true;
              request.abort();
            }
          },
          signal,
        );
        if (tooLong) throw new Error("解析过长");
        if (!signal.aborted) notify("AI 解析已生成，可继续编辑后收录");
      }
    } catch (e) {
      if (!mounted.current) return;
      if (tooLong) setError("解析已达到 40000 字上限，已保留收到的内容。");
      else if (signal.aborted)
        notify(
          kind === "analyzing"
            ? "已停止生成，收到的解析已保留"
            : "已停止识别，原有解析和已载入图片已保留",
        );
      else setError((e as Error).message);
    } finally {
      if (controller.current === request) controller.current = null;
      if (mounted.current) {
        setTask(null);
        onBusyChange(false);
      }
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <section className="answer-editor" aria-label="答案与解析">
      <div className="answer-editor-heading">
        <Sparkles size={17} />
        <h3>答案与解析</h3>
      </div>
      <div className="answer-editor-comparison">
        <label className="field">
          我的错误答案
          <input
            value={value.myAnswer}
            onChange={(e) => onChange({ myAnswer: e.target.value })}
            maxLength={300}
            readOnly={working}
            disabled={disabled}
            placeholder="例如：C（选填）"
          />
        </label>
        <ArrowRight size={18} />
        <label className="field">
          正确答案
          <input
            value={value.answer}
            onChange={(e) => onChange({ answer: e.target.value })}
            maxLength={300}
            readOnly={working}
            disabled={disabled}
            placeholder="例如：B（选填）"
          />
        </label>
      </div>
      <div className="answer-editor-actions">
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          aria-label="上传解析图片并识别文字"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.currentTarget.value = "";
            if (files.length) void run("recognizing", files);
          }}
        />
        <button
          type="button"
          className="button secondary button-small"
          disabled={disabled || task === "analyzing"}
          onClick={() =>
            task ? controller.current?.abort() : fileInput.current?.click()
          }
        >
          {task && task !== "analyzing" ? (
            <Square size={15} />
          ) : (
            <ImagePlus size={16} />
          )}
          {task && task !== "analyzing" ? "停止识别" : "图片转文字"}
        </button>
        <button
          type="button"
          className="button secondary ai-button button-small"
          disabled={disabled || (working && task !== "analyzing")}
          onClick={() =>
            task === "analyzing"
              ? controller.current?.abort()
              : void run("analyzing")
          }
        >
          {task === "analyzing" ? <Square size={15} /> : <Sparkles size={16} />}
          {task === "analyzing" ? "停止生成" : "AI 生成解析"}
        </button>
      </div>
      <p className="answer-editor-help">
        可直接输入或修改解析；图片转文字和 AI 生成的内容会追加到下方。
      </p>
      {value.explanationImages.length > 0 && (
        <div className="answer-editor-images">
          {value.explanationImages.map((src, index) => (
            <div key={index}>
              <button
                type="button"
                onClick={() => setZoom(src)}
                aria-label={"查看解析图片 " + (index + 1)}
              >
                <img src={src} alt={"解析图片 " + (index + 1)} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={"移除解析图片 " + (index + 1)}
                disabled={disabled || working}
                onClick={() =>
                  onChange({
                    explanationImages: value.explanationImages.filter(
                      (_, i) => i !== index,
                    ),
                  })
                }
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-button"
            disabled={disabled || working}
            onClick={() => void run("recognizing")}
          >
            <RotateCcw size={13} />
            重新识别图片
          </button>
        </div>
      )}
      <label className="field answer-editor-text">
        <span>
          <FileText size={14} />
          答案解析
        </span>
        <textarea
          rows={7}
          value={value.explanation}
          onChange={(e) => onChange({ explanation: e.target.value })}
          readOnly={working}
          disabled={disabled}
          maxLength={40000}
          placeholder="输入或粘贴解析，也可上传解析图片识别文字，或让 AI 根据题目生成解析。"
        />
      </label>
      {working && (
        <p className="answer-editor-status" role="status">
          <Spinner size={14} />
          {task === "reading"
            ? "正在读取解析图片…"
            : task === "recognizing"
              ? "正在识别图片中的解析文字…"
              : value.explanation
                ? "正在生成解析，内容实时显示…"
                : "正在请求 AI 解析…"}
        </p>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {value.explanation && (
        <details
          className="analysis-preview"
          open={task === "analyzing" ? true : undefined}
        >
          <summary>
            {task === "analyzing" ? "正在生成 · 排版预览" : "查看解析排版"}
          </summary>
          <Markdown content={value.explanation} />
        </details>
      )}
      <Modal
        open={!!zoom}
        onClose={() => setZoom(null)}
        title="解析图片"
        description="核对上传图片中的文字和公式。"
        wide
        className="image-modal"
      >
        <div className="image-viewer">
          {zoom && <img src={zoom} alt="解析图片大图" />}
        </div>
      </Modal>
    </section>
  );
}
