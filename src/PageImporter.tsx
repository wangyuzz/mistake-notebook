import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  ScanLine,
  Camera,
  ImagePlus,
  ArrowRight,
  Plus,
  Trash2,
  RotateCw,
  Sparkles,
  Check,
  CheckCircle2,
  Square,
  Undo2,
  Maximize2,
  Image,
  FileText,
  ShieldCheck,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { Modal, Spinner } from "./components";
import { api, emptyDraft, splitQuestion } from "./lib";
import AnswerEditor from "./AnswerEditor";
import type { AnswerFields } from "./AnswerEditor";
import { createId } from "./id";
import type { Box, Category, Config, Question } from "./lib";
import { readOriginal, orientedPreview, cropOriginal } from "./imaging";
type Source = {
  image: string;
  width: number;
  height: number;
  filename: string;
  rotation: number;
};
type Segment = AnswerFields & {
  id: string;
  title: string;
  text: string;
  options: string;
  categoryId: string;
  tags: string;
  bbox: Box;
  warning: string;
  selected: boolean;
};
type PageDraft = {
  id: string;
  source: Source;
  preview: string;
  segments: Segment[];
  origin: "manual" | "ai";
  active: number;
};
type Recognized = {
  title: string;
  text: string;
  options?: string;
  categoryName: string;
  tags: string[];
  bbox: Box;
  warning: string;
};
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export default function PageImporter({
  categories,
  config,
  onClose,
  onManual,
  onImported,
  notify,
}: {
  categories: Category[];
  config: Config | null;
  onClose: () => void;
  onManual: () => void;
  onImported: (questions: Question[]) => void;
  notify: (s: string) => void;
}) {
  const [pages, setPages] = useState<PageDraft[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const fileMode = useRef<"replace" | "append">("replace");
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [active, setActive] = useState(0);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState<"manual" | "ai">("manual");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [historyCount, setHistoryCount] = useState(0);
  const history = useRef<Segment[][]>([]);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const loadVersion = useRef(0);
  const drag = useRef<{
    index: number;
    startX: number;
    startY: number;
    box: Box;
    mode: string;
  } | null>(null);
  const selected = segments.filter((s) => s.selected);
  const current = segments[active];
  const allPages = source
    ? pages.map((p, i) =>
        i === pageIndex
          ? { ...p, source, preview, segments, origin, active }
          : p,
      )
    : pages;
  const totalSelected = allPages.reduce(
    (n, p) => n + p.segments.filter((s) => s.selected).length,
    0,
  );
  const geometryKey = JSON.stringify(segments.map((s) => [s.id, s.bbox]));
  useEffect(
    () => () => {
      controller.current?.abort();
      loadVersion.current++;
    },
    [],
  );
  useEffect(() => {
    if (!preview) return;
    let live = true;
    const timer = setTimeout(() => {
      void Promise.all(
        segments.map(
          async (s) =>
            [s.id, await cropOriginal(preview, 0, s.bbox, 520, 0.86)] as const,
        ),
      )
        .then((entries) => {
          if (live) setThumbs(Object.fromEntries(entries));
        })
        .catch(() => {});
    }, 100);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [preview, geometryKey]);
  function checkpoint() {
    history.current = [
      ...history.current.slice(-14),
      structuredClone(segments),
    ];
    setHistoryCount(history.current.length);
  }
  function undo() {
    if (answerBusy) return;
    const previous = history.current.pop();
    if (previous) {
      setSegments((latest) =>
        previous.map((segment) => {
          const current = latest.find((s) => s.id === segment.id);
          return current ? { ...current, bbox: segment.bbox } : segment;
        }),
      );
      setActive((i) => Math.min(i, Math.max(0, previous.length - 1)));
      setHistoryCount(history.current.length);
    }
  }
  function patch(index: number, data: Partial<Segment>) {
    setSegments((ss) =>
      ss.map((s, i) => (i === index ? { ...s, ...data } : s)),
    );
  }
  function fresh(bbox: Box, title = "新收录的图形题"): Segment {
    return {
      id: createId(),
      title,
      text: "",
      options: "",
      myAnswer: "",
      answer: "",
      explanation: "",
      explanationImages: [],
      categoryId: categories.find((c) => c.name === "图形推理")?.id || "",
      tags: "",
      bbox,
      warning: "",
      selected: true,
    };
  }
  async function recognize(ready: Source, view: string, remember = true) {
    if (answerBusy) return;
    if (!config?.recognitionConfigured) {
      setError(
        "识别服务尚未接入。可先手动框题，管理员配置 AI 后即可自动识别。",
      );
      return;
    }
    controller.current?.abort();
    controller.current = new AbortController();
    const signal = controller.current.signal;
    const version = loadVersion.current;
    setRecognizing(true);
    setError("");
    try {
      const rotated = ready.rotation % 180 !== 0;
      const result = await api<{ questions: Recognized[] }>("/recognize", {
        method: "POST",
        signal,
        body: JSON.stringify({
          image: view,
          width: rotated ? ready.height : ready.width,
          height: rotated ? ready.width : ready.height,
        }),
      });
      if (version !== loadVersion.current || signal.aborted) return;
      if (remember) checkpoint();
      setSegments(
        result.questions.map((q) => ({
          ...fresh(q.bbox, q.title),
          ...splitQuestion(q.text, q.options),
          categoryId:
            categories.find((c) => c.name === q.categoryName)?.id || "",
          tags: q.tags.join("，"),
          warning: q.warning,
        })),
      );
      setActive(0);
      setOrigin("ai");
      notify("已识别 " + result.questions.length + " 道，请核对裁框和选项");
    } catch (e) {
      if ((e as Error).name !== "AbortError" && version === loadVersion.current)
        setError((e as Error).message);
    } finally {
      if (
        version === loadVersion.current &&
        controller.current?.signal === signal
      )
        setRecognizing(false);
    }
  }
  async function acceptFile(file: File) {
    if (answerBusy) return;
    const version = ++loadVersion.current;
    controller.current?.abort();
    setRecognizing(false);
    setBusy(true);
    setError("");
    try {
      const ready = await readOriginal(file);
      const view = await orientedPreview(ready.image, 0);
      if (version !== loadVersion.current) return;
      const nextSegments: Segment[] = [];
      const nextOrigin = "manual";
      const draft: PageDraft = {
        id: createId(),
        source: ready,
        preview: view,
        segments: nextSegments,
        origin: nextOrigin,
        active: 0,
      };
      const append = fileMode.current === "append";
      const nextPages = append
        ? [...allPages, draft]
        : allPages.length
          ? allPages.map((p, i) => (i === pageIndex ? draft : p))
          : [draft];
      if (nextPages.length > 20) throw new Error("一次最多整理 20 张图片");
      if (
        nextPages.reduce((n, p) => n + p.source.image.length, 0) >
        40 * 1024 * 1024
      )
        throw new Error("本批原图较大，请先收录已有图片，再继续导入");
      setPages(nextPages);
      setPageIndex(append ? nextPages.length - 1 : pageIndex);
      setSource(ready);
      setPreview(view);
      setSegments(nextSegments);
      setOrigin(nextOrigin);
      setStep(1);
      setActive(0);
      history.current = [];
      setHistoryCount(0);
      setThumbs({});
      if (config?.autoRecognize && config.recognitionConfigured)
        void recognize(ready, view, false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (version === loadVersion.current) setBusy(false);
      if (gallery.current) gallery.current.value = "";
      if (camera.current) camera.current.value = "";
    }
  }
  function addBox() {
    if (answerBusy) return;
    if (segments.length >= 10) {
      notify("每次最多导入 10 道题");
      return;
    }
    checkpoint();
    const end = segments.length
      ? Math.max(...segments.map((s) => s.bbox.y + s.bbox.height)) + 0.01
      : 0.06;
    const y = end < 0.85 ? end : 0.15;
    setSegments((ss) => [
      ...ss,
      fresh(
        { x: 0.04, y, width: 0.92, height: Math.min(0.22, 0.98 - y) },
        "第 " + (ss.length + 1) + " 道错题",
      ),
    ]);
    setActive(segments.length);
    setOrigin("manual");
  }
  async function rotate() {
    if (!source || busy || answerBusy) return;
    controller.current?.abort();
    loadVersion.current++;
    setRecognizing(false);
    setBusy(true);
    try {
      const next = { ...source, rotation: (source.rotation + 90) % 360 };
      setPreview(await orientedPreview(next.image, next.rotation));
      setSource(next);
      setSegments([]);
      history.current = [];
      setHistoryCount(0);
      setActive(0);
      setOrigin("manual");
      setError("");
      notify("已旋转，请重新识别或添加裁框");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function startDrag(
    e: PointerEvent<HTMLDivElement>,
    index: number,
    mode = "move",
  ) {
    if (recognizing || saving || answerBusy) return;
    e.preventDefault();
    e.stopPropagation();
    setActive(index);
    checkpoint();
    drag.current = {
      index,
      startX: e.clientX,
      startY: e.clientY,
      box: { ...segments[index].bbox },
      mode,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveDrag(e: PointerEvent<HTMLDivElement>) {
    if (answerBusy) return;
    const d = drag.current;
    if (!d || !canvas.current) return;
    const rect = canvas.current.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / rect.width,
      dy = (e.clientY - d.startY) / rect.height;
    let b: Box;
    if (d.mode === "move")
      b = {
        ...d.box,
        x: clamp(d.box.x + dx, 0, 1 - d.box.width),
        y: clamp(d.box.y + dy, 0, 1 - d.box.height),
      };
    else {
      const left = d.mode.includes("w")
        ? clamp(d.box.x + dx, 0, d.box.x + d.box.width - 0.03)
        : d.box.x;
      const top = d.mode.includes("n")
        ? clamp(d.box.y + dy, 0, d.box.y + d.box.height - 0.03)
        : d.box.y;
      const right = d.mode.includes("e")
        ? clamp(d.box.x + d.box.width + dx, left + 0.03, 1)
        : d.box.x + d.box.width;
      const bottom = d.mode.includes("s")
        ? clamp(d.box.y + d.box.height + dy, top + 0.03, 1)
        : d.box.y + d.box.height;
      b = { x: left, y: top, width: right - left, height: bottom - top };
    }
    patch(d.index, { bbox: b });
  }
  function endDrag() {
    drag.current = null;
  }
  function choosePhoto(mode: "replace" | "append") {
    if (answerBusy) return;
    fileMode.current = mode;
    gallery.current?.click();
  }
  function switchPage(index: number) {
    if (busy || saving || recognizing || answerBusy || index === pageIndex)
      return;
    const d = allPages[index];
    if (!d) return;
    controller.current?.abort();
    loadVersion.current++;
    setPages(allPages);
    setPageIndex(index);
    setSource(d.source);
    setPreview(d.preview);
    setSegments(d.segments);
    setOrigin(d.origin);
    setActive(d.active);
    setThumbs({});
    history.current = [];
    setHistoryCount(0);
    setError("");
  }
  function selectSegment(index: number) {
    if (answerBusy) return;
    setActive(index);
    const el = canvas.current?.children[index + 1] as HTMLElement | undefined;
    const scroll = canvas.current?.parentElement;
    if (el && scroll)
      scroll.scrollTo({
        top: Math.max(0, el.offsetTop - 30),
        behavior: "smooth",
      });
  }
  async function save() {
    if (!source || !totalSelected || answerBusy) return;
    setSaving(true);
    setError("");
    try {
      const entries = [];
      for (const draft of allPages) {
        const selected = draft.segments.filter((s) => s.selected);
        if (!selected.length) continue;
        const questions = [];
        for (const s of selected) {
          const crop = await cropOriginal(
            draft.source.image,
            draft.source.rotation,
            s.bbox,
          );
          questions.push({
            ...emptyDraft(),
            title: s.title.trim() || "图片错题",
            text: s.text,
            options: s.options,
            myAnswer: s.myAnswer,
            answer: s.answer,
            explanation: s.explanation,
            explanationImages: s.explanationImages,
            categoryId: s.categoryId,
            tags: [
              ...new Set(
                s.tags
                  .split(/[,，、]/)
                  .map((t) => t.trim())
                  .filter(Boolean),
              ),
            ].slice(0, 12),
            questionImages: [crop],
            sourceBounds: s.bbox,
          });
        }
        entries.push({ source: draft.source, questions });
      }
      const body = JSON.stringify({ pages: entries });
      if (new Blob([body]).size > 58 * 1024 * 1024)
        throw new Error("本批图片较大，请减少图片数量后收录");
      const result = await api<{ questions: Question[] }>("/import-batch", {
        method: "POST",
        body,
      });
      onImported(result.questions);
      notify(
        "已收录 " +
          result.questions.length +
          " 道错题，" +
          entries.length +
          " 张来源原图也已保留",
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      title="把整页错题，整理成自己的进步"
      description="保留原图，单题收藏。图形、选项、手写批注，一个都不丢。"
      wide
      className="import-modal"
    >
      <div className="import-content">
        <div className="import-stepper">
          {["拍照或上传", "框选并整理"].map((s, i) => (
            <div
              className={step === i ? "active" : step > i ? "done" : ""}
              key={s}
            >
              <span>{step > i ? <Check size={13} /> : i + 1}</span>
              <strong>{s}</strong>
              {i < 1 && <ChevronRight size={13} />}
            </div>
          ))}
        </div>
        <input
          ref={gallery}
          className="sr-only"
          type="file"
          aria-label="上传整页照片"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void acceptFile(file);
          }}
        />
        <input
          ref={camera}
          className="sr-only"
          type="file"
          aria-label="拍摄整页照片"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void acceptFile(file);
          }}
        />
        {step === 0 ? (
          <div className="import-start">
            <div className="import-start-heading">
              <span className="import-main-icon">
                <ScanLine size={32} strokeWidth={1.4} />
              </span>
              <h2>一页拍下来，错题分开存。</h2>
              <p>
                适合图形推理、整页练习和带有手写批注的题目。
                <br />
                先确认每道题的范围，再选出想留下的。
              </p>
            </div>
            <div className="import-upload-options">
              <button
                disabled={busy}
                onClick={() => {
                  fileMode.current = "replace";
                  camera.current?.click();
                }}
              >
                <Camera size={29} strokeWidth={1.4} />
                <strong>拍一张照片</strong>
                <span>题干、图形与选项一起拍全</span>
                <ArrowRight size={16} />
              </button>
              <button disabled={busy} onClick={() => choosePhoto("replace")}>
                <ImagePlus size={29} strokeWidth={1.4} />
                <strong>从相册选择</strong>
                <span>保留原图，不先压缩整页</span>
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="import-privacy">
              <ShieldCheck size={14} />
              <span>
                确认收录时保存原图。仅在识别时，向配置的 AI 服务发送图片。
              </span>
            </div>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
            <button className="text-button manual-entry" onClick={onManual}>
              <FileText size={15} />
              只录一道题？手动填写
              <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <>
            <div className="import-toolbar">
              <div className="import-source-name">
                <Image size={15} />
                <span>{source?.filename}</span>
                <small>原图保留</small>
              </div>
              <div>
                <button
                  className="button secondary button-small"
                  disabled={saving || recognizing || busy || answerBusy}
                  onClick={() => void rotate()}
                >
                  <RotateCw size={15} />
                  <span>旋转</span>
                </button>
                <button
                  className="button secondary button-small"
                  disabled={saving || recognizing || busy || answerBusy}
                  onClick={() => choosePhoto("replace")}
                >
                  <ImagePlus size={15} />
                  <span>换一张</span>
                </button>
              </div>
            </div>
            <div className="import-pages" aria-label="待导入图片">
              <div className="import-page-tabs">
                {allPages.map((p, i) => (
                  <button
                    key={p.id}
                    className={i === pageIndex ? "active" : ""}
                    disabled={saving || recognizing || busy || answerBusy}
                    onClick={() => switchPage(i)}
                    aria-label={"切换到第 " + (i + 1) + " 张图片"}
                  >
                    <img src={p.preview} alt="" />
                    <span>
                      图片 {i + 1}
                      <small>
                        {p.segments.filter((s) => s.selected).length} 道已选
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              <span className="import-pages-hint">最多 20 张图片</span>
            </div>
            {error && (
              <div className="error-box import-error" role="alert">
                {error}
              </div>
            )}
            <div className="import-editor-layout">
              <section className="import-source-panel">
                <div className="source-panel-label">
                  <span>
                    <Maximize2 size={14} />
                    整页照片
                  </span>
                  <small>拖动框体移动 · 拖动四角缩放</small>
                </div>
                <div className="source-scroll">
                  <div className="crop-canvas" ref={canvas}>
                    <img
                      src={preview}
                      alt="待拆分的整页原图"
                      draggable={false}
                    />
                    {segments.map((s, i) => (
                      <div
                        key={s.id}
                        className={
                          "crop-box " +
                          (active === i ? "active" : "") +
                          (!s.selected ? " unselected" : "")
                        }
                        role="group"
                        aria-label={"第 " + (i + 1) + " 题裁框"}
                        tabIndex={0}
                        style={{
                          left: s.bbox.x * 100 + "%",
                          top: s.bbox.y * 100 + "%",
                          width: s.bbox.width * 100 + "%",
                          height: s.bbox.height * 100 + "%",
                        }}
                        onPointerDown={(e) => startDrag(e, i)}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onKeyDown={(e) => {
                          if (
                            ![
                              "ArrowUp",
                              "ArrowDown",
                              "ArrowLeft",
                              "ArrowRight",
                            ].includes(e.key)
                          )
                            return;
                          e.preventDefault();
                          checkpoint();
                          patch(i, {
                            bbox: {
                              ...s.bbox,
                              x: clamp(
                                s.bbox.x +
                                  (e.key === "ArrowRight"
                                    ? 0.005
                                    : e.key === "ArrowLeft"
                                      ? -0.005
                                      : 0),
                                0,
                                1 - s.bbox.width,
                              ),
                              y: clamp(
                                s.bbox.y +
                                  (e.key === "ArrowDown"
                                    ? 0.005
                                    : e.key === "ArrowUp"
                                      ? -0.005
                                      : 0),
                                0,
                                1 - s.bbox.height,
                              ),
                            },
                          });
                        }}
                      >
                        <span className="crop-box-label">
                          <span>{String(i + 1).padStart(2, "0")}</span>
                          {s.selected ? "已选" : "未选"}
                        </span>
                        {["nw", "ne", "sw", "se"].map((c) => (
                          <div
                            key={c}
                            className={"crop-handle " + c}
                            onPointerDown={(e) => startDrag(e, i, c)}
                            onPointerMove={moveDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="crop-actions">
                  <button
                    className="button secondary button-small"
                    disabled={
                      segments.length >= 10 || recognizing || answerBusy
                    }
                    onClick={addBox}
                  >
                    <Plus size={15} />
                    添加裁框
                  </button>
                  <button
                    className="icon-button"
                    disabled={!historyCount || recognizing || answerBusy}
                    aria-label="撤销裁框调整"
                    onClick={undo}
                  >
                    <Undo2 size={17} />
                  </button>
                  <span>{segments.length}/10 道</span>
                </div>
              </section>
              <aside className="segments-panel">
                <div className="segments-heading">
                  <div>
                    <h3>这一页，要留下哪几道？</h3>
                    <p>
                      {origin === "ai"
                        ? "AI 建议裁框 · 请核对是否包含全部选项"
                        : "手动框选 · 你来决定题目的范围"}
                    </p>
                  </div>
                  <span className="pill sage">已选 {selected.length}</span>
                </div>
                <button
                  className="recognize-button"
                  disabled={busy || saving || answerBusy}
                  onClick={() => {
                    if (recognizing) {
                      controller.current?.abort();
                      setRecognizing(false);
                    } else if (source) void recognize(source, preview);
                  }}
                >
                  {recognizing ? (
                    <>
                      <Spinner size={17} />
                      <span>AI正在识别题目中</span>
                      <Square size={13} />
                    </>
                  ) : (
                    <>
                      <Sparkles size={17} />
                      <span>
                        {config?.recognitionConfigured
                          ? "AI 识别并拆题"
                          : "AI 识别 · 待管理员配置"}
                      </span>
                      <ArrowRight size={14} />
                    </>
                  )}
                </button>
                {!segments.length ? (
                  <div className="no-segments">
                    <ScanLine size={29} strokeWidth={1.3} />
                    <h4>先给题目画个框</h4>
                    <p>点击“添加裁框”，把题干、图形和所有选项一起框进去。</p>
                    <button
                      className="button secondary button-small"
                      onClick={addBox}
                    >
                      <Plus size={15} />
                      添加第一道题
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="segment-select-all">
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={selected.length === segments.length}
                          onChange={(e) =>
                            setSegments((ss) =>
                              ss.map((s) => ({
                                ...s,
                                selected: e.target.checked,
                              })),
                            )
                          }
                        />
                        全部选择
                      </label>
                      <span>点击卡片调整裁框</span>
                    </div>
                    <div className="segment-list">
                      {segments.map((s, i) => (
                        <div
                          key={s.id}
                          className={
                            "segment-row " + (i === active ? "active" : "")
                          }
                        >
                          <label className="segment-checkbox">
                            <input
                              type="checkbox"
                              aria-label={"收录第 " + (i + 1) + " 题"}
                              checked={s.selected}
                              onChange={(e) =>
                                patch(i, { selected: e.target.checked })
                              }
                            />
                          </label>
                          <button
                            className="segment-row-main"
                            disabled={answerBusy}
                            onClick={() => selectSegment(i)}
                          >
                            <span className="segment-thumbnail">
                              {thumbs[s.id] ? (
                                <img
                                  src={thumbs[s.id]}
                                  alt={"第 " + (i + 1) + " 题裁图预览"}
                                />
                              ) : (
                                <ScanLine size={20} />
                              )}
                            </span>
                            <span>
                              <small>第 {i + 1} 题</small>
                              <strong>{s.title}</strong>
                              <span>
                                {s.warning ? (
                                  <>
                                    <AlertCircle size={11} />
                                    待核对
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 size={11} />
                                    保留题目与选项
                                  </>
                                )}
                              </span>
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {current && (
                  <section className="active-question-editor">
                    <div className="active-question-heading">
                      <strong>整理第 {active + 1} 题</strong>
                      <button
                        className="icon-button"
                        aria-label="删除当前裁框"
                        disabled={recognizing || saving || answerBusy}
                        onClick={() => {
                          checkpoint();
                          setSegments((ss) =>
                            ss.filter((_, i) => i !== active),
                          );
                          setActive((i) => Math.max(0, i - 1));
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <fieldset
                      className="confirm-fields inline-question-fields"
                      disabled={saving || recognizing || busy}
                    >
                      <label className="field">
                        题目标题
                        <input
                          value={current.title}
                          onChange={(e) =>
                            patch(active, { title: e.target.value })
                          }
                          maxLength={120}
                        />
                      </label>
                      <div className="two-columns">
                        <label className="field">
                          所属分类
                          <select
                            aria-label="所属分类"
                            value={current.categoryId}
                            onChange={(e) =>
                              patch(active, { categoryId: e.target.value })
                            }
                          >
                            <option value="">暂不分类</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          知识点标签
                          <input
                            value={current.tags}
                            onChange={(e) =>
                              patch(active, { tags: e.target.value })
                            }
                            maxLength={360}
                            placeholder="用逗号分隔"
                          />
                        </label>
                      </div>
                      <label className="field">
                        题目
                        <textarea
                          aria-label={"第 " + (active + 1) + " 题题目"}
                          value={current.text}
                          onChange={(e) =>
                            patch(active, { text: e.target.value })
                          }
                          rows={4}
                          maxLength={30000}
                          placeholder="图形题可只保留图片，模糊文字不要猜填。"
                        />
                      </label>
                      <label className="field">
                        题目选项
                        <textarea
                          value={current.options}
                          onChange={(e) =>
                            patch(active, { options: e.target.value })
                          }
                          rows={4}
                          maxLength={12000}
                          placeholder={
                            "每个选项单独一行，例如：\nA. 选项一\nB. 选项二\n图形选项可保留在原图中。"
                          }
                        />
                      </label>
                      {current.warning && (
                        <p className="recognition-warning">
                          <AlertCircle size={12} />
                          {current.warning}
                        </p>
                      )}
                      <AnswerEditor
                        key={current.id}
                        value={current}
                        config={config}
                        onChange={(data) => patch(active, data)}
                        onBusyChange={setAnswerBusy}
                        notify={notify}
                        buildDraft={async () => {
                          if (!source) throw new Error("请先上传题目图片");
                          const crop = await cropOriginal(
                            source.image,
                            source.rotation,
                            current.bbox,
                            2600,
                            0.92,
                          );
                          return {
                            ...emptyDraft(),
                            title: current.title,
                            text: current.text,
                            options: current.options,
                            myAnswer: current.myAnswer,
                            answer: current.answer,
                            explanation: current.explanation,
                            explanationImages: current.explanationImages,
                            questionImages: [crop],
                          };
                        }}
                      />
                    </fieldset>
                  </section>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
      <footer className="modal-footer import-footer">
        {step === 0 ? (
          <>
            <span className="muted">每张最多 10 道，原图最大 20MB。</span>
            <button className="button secondary" onClick={onClose}>
              稍后再来
            </button>
          </>
        ) : (
          <>
            <span className="import-footer-count">
              {allPages.length} 张图片 · 已选 <strong>{totalSelected}</strong>{" "}
              道
            </span>
            <button
              className="button secondary import-continue-button"
              disabled={
                saving ||
                recognizing ||
                busy ||
                answerBusy ||
                pages.length >= 20
              }
              onClick={() => choosePhoto("append")}
            >
              <ImagePlus size={16} />
              继续导入图片
            </button>
            <button
              className="button primary"
              disabled={
                !totalSelected || saving || recognizing || busy || answerBusy
              }
              onClick={() => void save()}
            >
              {saving ? <Spinner /> : <Check size={17} />}{" "}
              {saving ? "正在保留原图…" : "收录 " + totalSelected + " 道错题"}
            </button>
          </>
        )}
      </footer>
    </Modal>
  );
}
