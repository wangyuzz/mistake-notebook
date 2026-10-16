import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Sparkles,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  PencilLine,
  Bookmark,
  Trash2,
  RotateCcw,
  Eye,
  FileText,
  Save,
  X,
} from "lucide-react";
import { Modal, Upload, Spinner, Photo } from "./components";
import { api, emptyDraft, statusLabels, splitQuestion } from "./lib";
import { Markdown } from "./Markdown";
import AnswerEditor from "./AnswerEditor";
import type { SourcePage } from "./lib";
import { orientedPreview } from "./imaging";
import type { Question, Draft, Category, Config } from "./lib";

type Notify = (s: string) => void;
export function Editor({
  initial,
  categories,
  config,
  onClose,
  onSave,
  notify,
}: {
  initial?: Question;
  categories: Category[];
  config: Config | null;
  onClose: () => void;
  onSave: (d: Draft, id?: string) => Promise<void>;
  notify: Notify;
}) {
  const [draft, setDraft] = useState<Draft>(
    initial
      ? { ...initial, ...splitQuestion(initial.text, initial.options) }
      : emptyDraft(),
  );
  const [tags, setTags] = useState(initial?.tags.join("，") || "");
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (analyzing || saving) return;
    if (!draft.text.trim() && !draft.questionImages.length) {
      setError("先输入题目文字，或上传一张题目图片");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(
        {
          ...draft,
          tags: [
            ...new Set(
              tags
                .split(/[,，、]/)
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ],
        },
        initial?.id,
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
      onClose={onClose}
      title={initial ? "编辑这道错题" : "收录一份新的进步"}
      description="把题目和解析放在一起，让复习更有条理。"
      wide
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="modal-body editor-body">
          <div className="editor-intro">
            <span className="step-number">01</span>
            <div>
              <h3>先把题目留下来</h3>
              <p>拍一张，或直接写下来。</p>
            </div>
            <span className="pill soft">题目 + 解析，一起收录</span>
          </div>
          <label className="field">
            题目标题
            <input
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
              maxLength={120}
              placeholder="给这道题起个名字（选填）"
            />
          </label>
          <div className="two-columns">
            <label className="field">
              所属分类
              <div className="select-wrap">
                <select
                  value={draft.categoryId}
                  onChange={(e) => set("categoryId", e.target.value)}
                >
                  <option value="">暂不分类</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
            <label className="field">
              知识点标签
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="例如：削弱论证，另有他因"
                maxLength={360}
              />
            </label>
          </div>
          <Upload
            label="题目图片"
            images={draft.questionImages}
            onChange={(v) => set("questionImages", v)}
            notify={notify}
          />
          <label className="field">
            题目 <span className="optional">有图片时可不填</span>
            <textarea
              rows={4}
              value={draft.text}
              onChange={(e) => set("text", e.target.value)}
              maxLength={30000}
              placeholder="输入题干；选项填写在下方，也可以只上传图片。"
            />
          </label>
          <label className="field">
            题目选项
            <textarea
              rows={4}
              value={draft.options || ""}
              onChange={(e) => set("options", e.target.value)}
              maxLength={12000}
              placeholder="每个选项单独一行；图形选项可保留在题目图片中。"
            />
          </label>
          <AnswerEditor
            value={draft}
            config={config}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            buildDraft={() => draft}
            onBusyChange={setAnalyzing}
            notify={notify}
            disabled={saving}
          />
          <label className="field">
            给未来的自己留一句提醒
            <textarea
              rows={2}
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              maxLength={20000}
              placeholder="这次为什么错？下次要注意什么？"
            />
          </label>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <span className="muted editor-footer-hint">
            每一道错题，都有被理解的价值。
          </span>
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={saving || analyzing}>
            {saving ? <Spinner /> : <Check size={18} />}{" "}
            {saving ? "正在保存" : "保存错题"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function Detail({
  question: q,
  category,
  reviewMode = false,
  onClose,
  onEdit,
  onUpdate,
  onDelete,
  onAI,
  onNext,
  position = 1,
  total = 1,
  onPreviousQuestion,
  onNextQuestion,
  notify,
}: {
  question: Question;
  category?: Category;
  reviewMode?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onUpdate: (data: Partial<Question>) => Promise<void>;
  onDelete: () => Promise<void>;
  onAI: () => void;
  onNext?: () => void;
  position?: number;
  total?: number;
  onPreviousQuestion?: () => void;
  onNextQuestion?: () => void;
  notify: Notify;
}) {
  const [showAnswer, setShowAnswer] = useState(!reviewMode);
  const [zoom, setZoom] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(q.notes);
  useEffect(() => {
    setNotes(q.notes);
  }, [q.id, q.notes]);
  async function update(d: Partial<Question>) {
    setBusy(true);
    try {
      await onUpdate(d);
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function mark(mastered: boolean) {
    const saved = await update({
      status: mastered ? "mastered" : "reviewing",
      reviews: q.reviews + 1,
      ...(notes !== q.notes ? { notes } : {}),
    });
    if (!saved) return;
    notify(mastered ? "又掌握了一道，继续积累！" : "已加入巩固，慢慢来就好");
    onNext?.();
  }
  async function changeQuestion(move?: () => void) {
    if (!move || busy) return;
    if (notes !== q.notes && !(await update({ notes }))) return;
    move();
  }
  return (
    <>
      <Modal
        open
        onClose={() => {
          if (!busy) onClose();
        }}
        title={reviewMode ? "专注复习" : "错题详情"}
        description={
          (category?.name || "未分类") + " · " + statusLabels[q.status]
        }
        wide
        className="detail-modal"
      >
        <div className="modal-body">
          <div className="detail-title">
            <div>
              <span className={"pill " + (category?.color || "sage")}>
                {category?.name || "未分类"}
              </span>
              <h2>{q.title}</h2>
              <div className="detail-meta">
                <span>
                  收录于 {new Date(q.createdAt).toLocaleDateString("zh-CN")}
                </span>
                <span>已复习 {q.reviews} 次</span>
              </div>
            </div>
            <button
              className={"icon-button favorite " + (q.favorite ? "active" : "")}
              aria-label={q.favorite ? "取消收藏" : "收藏题目"}
              onClick={() => void update({ favorite: !q.favorite })}
            >
              <Bookmark size={21} fill={q.favorite ? "currentColor" : "none"} />
            </button>
          </div>
          {q.sourcePageId && (
            <button
              className="source-page-link"
              onClick={async () => {
                try {
                  const page = await api<SourcePage>(
                    "/pages/" + q.sourcePageId,
                  );
                  setZoom(
                    await orientedPreview(page.image, page.rotation, 10000),
                  );
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              <FileText size={15} />
              <span>来自整页导入 · 查看来源原图</span>
              <ArrowRight size={14} />
            </button>
          )}
          <div className="detail-question">
            <h3 className="content-label">
              <FileText size={17} />
              题目
            </h3>
            {q.questionImages.map((src, i) => (
              <Photo
                key={i}
                src={src}
                alt={"题目图片 " + (i + 1)}
                onZoom={setZoom}
              />
            ))}
            {q.text && <div className="prose question-prose">{q.text}</div>}
            {q.options && (
              <section className="question-options">
                <h4>题目选项</h4>
                <div className="prose">{q.options}</div>
              </section>
            )}
            {q.tags.length > 0 && (
              <div className="tags">
                {q.tags.map((t) => (
                  <span key={t}># {t}</span>
                ))}
              </div>
            )}
          </div>
          {!showAnswer ? (
            <button
              className="reveal-answer"
              onClick={() => setShowAnswer(true)}
            >
              <Eye size={20} />
              <div>
                <strong>先独立想一想，再看解析</strong>
                <span>点击展开答案与思路</span>
              </div>
              <ChevronDown size={18} />
            </button>
          ) : (
            <>
              <div className="answer-section">
                <h3 className="content-label">
                  <Sparkles size={17} />
                  答案与解析
                </h3>
                {(q.answer || q.myAnswer) && (
                  <div className="answer-comparison">
                    <div>
                      <span>我的答案</span>
                      <strong>{q.myAnswer || "未记录"}</strong>
                    </div>
                    <ArrowRight size={20} />
                    <div className="correct-answer">
                      <span>正确答案</span>
                      <strong>{q.answer || "待补充"}</strong>
                    </div>
                  </div>
                )}
                {q.explanationImages.map((src, i) => (
                  <Photo
                    key={i}
                    src={src}
                    alt={"解析图片 " + (i + 1)}
                    onZoom={setZoom}
                  />
                ))}
                {q.explanation ? (
                  <Markdown content={q.explanation} />
                ) : (
                  <p className="muted">
                    还没有文字解析，试试上传解析图片或让 AI 帮你梳理。
                  </p>
                )}
                <button className="text-button" onClick={onAI}>
                  <Sparkles size={16} />和 AI 聊聊这道题
                  <ArrowRight size={15} />
                </button>
              </div>
              <div className="notes-section">
                <h3 className="content-label">
                  <PencilLine size={17} />
                  我的复盘笔记
                </h3>
                <textarea
                  className="notes-input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={20000}
                  placeholder="记下这次的易错点，让下次的自己少走弯路…"
                  rows={3}
                />
                {notes !== q.notes && (
                  <button
                    className="button secondary button-small"
                    disabled={busy}
                    onClick={() => void update({ notes })}
                  >
                    <Save size={15} />
                    保存笔记
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <footer className="detail-footer-shell">
          <nav className="detail-question-nav" aria-label="切换错题">
            <button
              type="button"
              className="button secondary"
              disabled={busy || !onPreviousQuestion}
              onClick={() => void changeQuestion(onPreviousQuestion)}
            >
              <ChevronLeft size={17} />
              上一题
            </button>
            <span
              className="detail-question-position"
              aria-live="polite"
              aria-atomic="true"
            >
              第 <strong>{position}</strong> / {total} 题
            </span>
            <button
              type="button"
              className="button secondary"
              disabled={busy || !onNextQuestion}
              onClick={() => void changeQuestion(onNextQuestion)}
            >
              下一题
              <ChevronRight size={17} />
            </button>
          </nav>
          <div className="modal-footer detail-footer">
            {reviewMode ? (
              <>
                <button
                  className="button secondary"
                  disabled={busy || !showAnswer}
                  onClick={() => void mark(false)}
                >
                  <RotateCcw size={16} />
                  还需巩固
                </button>
                <button
                  className="button primary"
                  disabled={busy || !showAnswer}
                  onClick={() => void mark(true)}
                >
                  <Check size={17} />
                  我掌握了{onNext && <ArrowRight size={15} />}
                </button>
              </>
            ) : (
              <>
                <button
                  className="icon-button danger"
                  aria-label="删除这道错题"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={18} />
                </button>
                <select
                  className="status-select"
                  aria-label="复习状态"
                  value={q.status}
                  disabled={busy}
                  onChange={(e) =>
                    void update({
                      status: e.target.value as Question["status"],
                    })
                  }
                >
                  {Object.entries(statusLabels).map(([v, l]) => (
                    <option value={v} key={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <span className="footer-spacer" />
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={onEdit}
                >
                  <PencilLine size={16} />
                  编辑
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void mark(q.status !== "mastered")}
                >
                  <Check size={17} />
                  {q.status === "mastered" ? "重新巩固" : "标为掌握"}
                </button>
              </>
            )}
          </div>
        </footer>
      </Modal>
      <Modal
        open={!!zoom}
        onClose={() => setZoom("")}
        title="图片原图"
        className="image-modal"
        wide
      >
        <div className="image-viewer">
          <img src={zoom || undefined} alt="错题附件原图" />
        </div>
      </Modal>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="删除这道错题？"
        description="删除后无法恢复，你可以先导出备份。"
      >
        <div className="modal-body">
          <p className="muted">
            「{q.title}」和对应的单题图片、解析将一并删除。
            {q.sourcePageId && "来源整页仍会保留在你的完整备份中。"}
          </p>
        </div>
        <footer className="modal-footer">
          <button
            className="button secondary"
            onClick={() => setConfirmDelete(false)}
          >
            <X size={16} />
            保留
          </button>
          <button
            className="button destructive"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await onDelete();
                onClose();
              } catch (e) {
                notify((e as Error).message);
                setDeleting(false);
              }
            }}
          >
            {deleting ? <Spinner /> : <Trash2 size={16} />}确认删除
          </button>
        </footer>
      </Modal>
    </>
  );
}
