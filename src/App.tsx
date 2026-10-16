import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ComponentType } from "react";
import {
  BookOpen,
  LayoutGrid,
  Layers3,
  RotateCcw,
  Sparkles,
  Settings2,
  ArrowUpRight,
  ArrowRight,
  Search,
  Plus,
  Bookmark,
  Check,
  ChevronRight,
  List,
  X,
  Send,
  Square,
  ShieldCheck,
  CheckCircle2,
  Circle,
  GraduationCap,
  Lightbulb,
  Hash,
  CalendarDays,
  ArrowDownWideNarrow,
  Leaf,
  Camera,
  Shapes,
  Type,
  ChartNoAxesCombined,
  Brain,
  Network,
  Binary,
  FolderPlus,
  WifiOff,
  ScanLine,
  LogOut,
} from "lucide-react";
import { api, streamAI, dateLabel, statusLabels } from "./lib";
import { createId } from "./id";
import { Markdown } from "./Markdown";
import type { Category, Config, Draft, Message, Question } from "./lib";
import { AddButton, Empty, Modal, SectionHeading, Spinner } from "./components";
import { Detail, Editor } from "./NotebookForms";
import AuthGate from "./AuthGate";
import SpaceSettings from "./SpaceSettings";
import PageImporter from "./PageImporter";
import type { User } from "./lib";

type Page = "notebook" | "categories" | "review" | "ai" | "settings";
const navs: {
  id: Page;
  label: string;
  icon: ComponentType<{ size?: number }>;
}[] = [
  { id: "notebook", label: "我的错题", icon: BookOpen },
  { id: "categories", label: "分类管理", icon: Layers3 },
  { id: "review", label: "温故知新", icon: RotateCcw },
  { id: "ai", label: "AI 学习助手", icon: Sparkles },
];
const catIcons = [
  Type,
  ChartNoAxesCombined,
  Shapes,
  Brain,
  BookOpen,
  Network,
  Binary,
];
const getIcon = (categories: Category[], c?: Category) =>
  catIcons[
    Math.max(
      0,
      categories.findIndex((x) => x.id === c?.id),
    ) % catIcons.length
  ];
function Workspace({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => Promise<void>;
}) {
  const [page, setPage] = useState<Page>("notebook");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("all");
  const [favorites, setFavorites] = useState(false);
  const [sort, setSort] = useState("new");
  const [view, setView] = useState("grid");
  const [visible, setVisible] = useState(12);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((s: string) => {
    setToast(s);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  const [editor, setEditor] = useState<Question | "new" | null>(null);
  const [detail, setDetail] = useState("");
  const [detailQueue, setDetailQueue] = useState<string[]>([]);
  const [reviewQueue, setReviewQueue] = useState<string[] | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [categoryModal, setCategoryModal] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryColor, setCategoryColor] = useState("sage");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const [chatContext, setChatContext] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<{
    message: string;
    code?: string;
  } | null>(null);
  const [settingsTab, setSettingsTab] = useState<"account" | "ai" | "users">(
    user.role === "admin" ? "users" : "account",
  );
  const chatAbort = useRef<AbortController | null>(null);
  const chatBottom = useRef<HTMLDivElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [c, qs, cats] = await Promise.all([
        api<Config>("/config"),
        api<Question[]>("/questions"),
        api<Category[]>("/categories"),
      ]);
      setConfig(c);
      setQuestions(qs);
      setCategories(cats);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      chatAbort.current?.abort();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [load]);
  useEffect(() => {
    if (autoScroll.current)
      chatBottom.current?.scrollIntoView({
        behavior: chatBusy ? "instant" : "smooth",
        block: "end",
      });
  }, [messages, chatBusy]);
  useEffect(() => {
    setVisible(12);
  }, [query, category, status, favorites]);
  const pending = questions.filter((q) => q.status !== "mastered");
  const dayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
  });
  const today = dayFormatter.format(new Date());
  const collectedToday = questions.filter(
    (q) => dayFormatter.format(new Date(q.createdAt)) === today,
  ).length;
  const mastered = questions.filter((q) => q.status === "mastered");
  const progress = questions.length
    ? Math.round((mastered.length / questions.length) * 100)
    : 0;
  const filtered = useMemo(
    () =>
      questions
        .filter(
          (q) =>
            (!category || q.categoryId === category) &&
            (status === "all" ||
              (status === "todo"
                ? q.status !== "mastered"
                : q.status === status)) &&
            (!favorites || q.favorite) &&
            (!query.trim() ||
              [
                q.title,
                q.text,
                q.options || "",
                q.explanation,
                q.notes,
                ...q.tags,
              ]
                .join(" ")
                .toLowerCase()
                .includes(query.trim().toLowerCase())),
        )
        .sort((a, b) =>
          sort === "old"
            ? a.createdAt.localeCompare(b.createdAt)
            : sort === "updated"
              ? b.updatedAt.localeCompare(a.updatedAt)
              : b.createdAt.localeCompare(a.createdAt),
        ),
    [questions, category, status, favorites, query, sort],
  );
  const current = questions.find((q) => q.id === detail);
  // Preserve the list order even when changing a question's review status.
  const detailIds = useMemo(() => {
    const existing = new Set(questions.map((q) => q.id));
    return detailQueue.filter((id) => existing.has(id));
  }, [detailQueue, questions]);
  const detailIndex = detailIds.indexOf(detail);
  const reviewCurrent = reviewQueue
    ? questions.find((q) => q.id === reviewQueue[reviewIndex])
    : undefined;
  function navigate(p: Page) {
    if (p === "settings")
      setSettingsTab(user.role === "admin" ? "users" : "account");
    setPage(p);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function save(d: Draft, id?: string) {
    const saved = await api<Question>("/questions" + (id ? "/" + id : ""), {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(d),
    });
    setQuestions((qs) =>
      id ? qs.map((q) => (q.id === id ? saved : q)) : [saved, ...qs],
    );
    notify(id ? "修改已保存" : "错题已收录，进步 +1");
  }
  async function update(id: string, data: Partial<Question>) {
    const saved = await api<Question>("/questions/" + id, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    setQuestions((qs) => qs.map((q) => (q.id === id ? saved : q)));
  }
  async function remove(id: string) {
    await api("/questions/" + id, { method: "DELETE" });
    setQuestions((qs) => qs.filter((q) => q.id !== id));
    notify("错题已删除");
  }
  function openAI(id: string) {
    if (chatBusy) {
      notify("请先停止当前生成，再切换题目");
      return;
    }
    if (chatContext !== id) setMessages([]);
    setChatContext(id);
    setDetail("");
    setReviewQueue(null);
    navigate("ai");
  }
  function startReview() {
    const queue = pending
      .filter((q) => !category || q.categoryId === category)
      .map((q) => q.id);
    if (!queue.length) {
      notify("这个分类没有待复习题目");
      return;
    }
    setReviewQueue(queue);
    setReviewIndex(0);
  }
  function nextReview() {
    if (reviewQueue && reviewIndex + 1 < reviewQueue.length)
      setReviewIndex((i) => i + 1);
    else {
      setReviewQueue(null);
      notify("这一轮复习完成，给自己一点掌声！");
    }
  }
  async function addCategory(e: FormEvent) {
    e.preventDefault();
    setCategorySaving(true);
    setCategoryError("");
    try {
      const c = await api<Category>("/categories", {
        method: "POST",
        body: JSON.stringify({ name: categoryName, color: categoryColor }),
      });
      setCategories((cs) => [...cs, c]);
      setCategoryModal(false);
      setCategoryName("");
      notify("新分类已创建");
    } catch (e) {
      setCategoryError((e as Error).message);
    } finally {
      setCategorySaving(false);
    }
  }
  async function sendChat(text = chatInput) {
    const value = text.trim();
    if (!value || chatBusy) return;
    if (!config?.aiConfigured) {
      setChatError({
        message: "AI 尚未接入，请联系管理员配置服务。",
        code: "AI_CONFIGURATION",
      });
      return;
    }
    setChatInput("");
    setChatError(null);
    autoScroll.current = true;
    const context = chatContext;
    const history = messages
      .filter((m) => m.content.trim())
      .slice(-12)
      .map(({ role, content }) => ({ role, content: content.slice(0, 16000) }));
    const replyId = createId();
    setMessages((ms) => [
      ...ms,
      { role: "user", content: value, questionId: context },
      {
        id: replyId,
        role: "assistant",
        content: "",
        questionId: context,
        status: "streaming",
      },
    ]);
    setChatBusy(true);
    chatAbort.current = new AbortController();
    try {
      await streamAI(
        {
          action: "chat",
          questionId: context || undefined,
          message: value,
          history,
        },
        (content) =>
          setMessages((ms) =>
            ms.map((m) => (m.id === replyId ? { ...m, content } : m)),
          ),
        chatAbort.current.signal,
      );
      setMessages((ms) =>
        ms.map((m) => (m.id === replyId ? { ...m, status: "complete" } : m)),
      );
    } catch (e) {
      const stopped = (e as Error).name === "AbortError";
      setMessages((ms) =>
        ms.map((m) =>
          m.id === replyId
            ? { ...m, status: stopped ? "stopped" : "error" }
            : m,
        ),
      );
      if (!stopped) {
        const error = e as Error & { code?: string };
        setChatError({ message: error.message, code: error.code });
        setChatInput((current) => current || value);
      }
    } finally {
      setChatBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("notebook");
          }}
        >
          <span className="brand-icon">
            <BookOpen size={24} strokeWidth={1.6} />
          </span>
          <div>
            <strong>
              拾题<span>SHITI</span>
            </strong>
            <small>拾起错题，积累进步</small>
          </div>
        </a>
        <div className="sidebar-label">学习空间</div>
        <nav className="side-nav">
          {navs.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "notebook" && (
                <small>{questions.length.toString().padStart(2, "0")}</small>
              )}
              {n.id === "ai" && <span className="tiny-ai">AI</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-label categories-label">
          我的分类
          <button aria-label="添加分类" onClick={() => setCategoryModal(true)}>
            <Plus size={15} />
          </button>
        </div>
        <div className="side-categories">
          {categories.map((c) => (
            <button
              key={c.id}
              className={
                category === c.id && page === "notebook" ? "selected" : ""
              }
              onClick={() => {
                setCategory(c.id);
                navigate("notebook");
              }}
            >
              <span className={"category-dot " + c.color} />
              <span>{c.name}</span>
              <small>
                {questions.filter((q) => q.categoryId === c.id).length}
              </small>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="growth-note">
            <Leaf size={20} />
            <p>
              学会一道，
              <br />
              就比昨天更进一步。
            </p>
            <span>KEEP GROWING</span>
          </div>
          <button
            className={"settings-link " + (page === "settings" ? "active" : "")}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} />
            {user.role === "admin" ? "管理控制台" : "我的空间"}
            <ChevronRight size={15} />
          </button>
          <div className="profile">
            <span>{user.displayName.slice(0, 1)}</span>
            <div>
              <strong>{user.displayName}</strong>
              <small>
                {user.role === "admin"
                  ? "管理员 · 独立学习空间"
                  : "学习者 · 独立学习空间"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="退出登录"
              onClick={() => void onLogout().catch((e) => notify(e.message))}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>我的学习空间</span>
            <ChevronRight size={13} />
            <strong>
              {page === "settings"
                ? user.role === "admin"
                  ? "管理控制台"
                  : "我的空间"
                : navs.find((n) => n.id === page)?.label}
            </strong>
          </div>
          <a
            href="#"
            className="mobile-brand"
            onClick={(e) => {
              e.preventDefault();
              navigate("notebook");
            }}
          >
            <BookOpen size={23} />
            拾题
          </a>
          <div className="topbar-right">
            <span className="today">
              <CalendarDays size={14} />
              {new Date().toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </span>
            <button
              className={
                "environment-pill " +
                (config?.mode === "postgres" ? "connected" : "")
              }
              onClick={() => navigate("settings")}
            >
              <span />
              {config?.mode === "postgres" ? "云端已连接" : "本地空间"}
            </button>
            <button
              className="avatar"
              aria-label="打开设置"
              onClick={() => navigate("settings")}
            >
              {user.displayName.slice(0, 1)}
            </button>
          </div>
        </header>
        <main className={"main-content " + (page === "ai" ? "ai-main" : "")}>
          {loadError ? (
            <div className="service-error">
              <WifiOff size={32} />
              <h2>暂时没能连接学习空间</h2>
              <p>{loadError}</p>
              <button className="button primary" onClick={() => void load()}>
                重新连接
              </button>
            </div>
          ) : loading ? (
            <div className="page-loading">
              <Spinner size={28} />
              <p>正在打开你的学习空间…</p>
            </div>
          ) : (
            <>
              {page === "notebook" && (
                <>
                  <div className="page-title-row">
                    <div>
                      <span className="eyebrow">
                        A LITTLE BETTER, EVERY DAY
                      </span>
                      <h1>
                        我的错题<span className="title-dot">.</span>
                      </h1>
                      <p>每一次回看，都离答案更近一步。</p>
                    </div>
                    <div className="notebook-create-actions">
                      <button
                        className="button secondary manual-entry-button"
                        onClick={() => setEditor("new")}
                      >
                        手动录入
                      </button>
                      <button
                        className="button primary"
                        onClick={() => setImportOpen(true)}
                      >
                        <ScanLine size={18} />
                        拍照导入
                      </button>
                    </div>
                  </div>
                  <section className="stats-grid" aria-label="学习概览">
                    <div className="stat-card">
                      <span className="stat-icon sage">
                        <CalendarDays size={21} />
                      </span>
                      <div>
                        <span>今天收录</span>
                        <strong>
                          {collectedToday}
                          <small>道错题</small>
                        </strong>
                      </div>
                      <span className="stat-decoration">+ 每一份积累</span>
                    </div>
                    <button
                      className="stat-card"
                      onClick={() => {
                        setStatus(status === "todo" ? "all" : "todo");
                      }}
                    >
                      <span className="stat-icon peach">
                        <RotateCcw size={21} />
                      </span>
                      <div>
                        <span>待复习</span>
                        <strong>
                          {pending.length}
                          <small>道等你回看</small>
                        </strong>
                      </div>
                      <ArrowUpRight className="stat-arrow" size={17} />
                    </button>
                    <div className="stat-card">
                      <span className="stat-icon lavender">
                        <BookOpen size={21} />
                      </span>
                      <div>
                        <span>总收录</span>
                        <strong>
                          {questions.length}
                          <small>道错题</small>
                        </strong>
                      </div>
                      <span className="stat-decoration">每一道都算数</span>
                    </div>
                  </section>
                  <section className="notebook-section">
                    <div className="list-heading">
                      <h2>
                        错题收藏夹<span>{filtered.length}</span>
                      </h2>
                      <div className="view-toggle">
                        <button
                          aria-label="卡片视图"
                          aria-pressed={view === "grid"}
                          className={view === "grid" ? "active" : ""}
                          onClick={() => setView("grid")}
                        >
                          <LayoutGrid size={17} />
                        </button>
                        <button
                          aria-label="列表视图"
                          aria-pressed={view === "list"}
                          className={view === "list" ? "active" : ""}
                          onClick={() => setView("list")}
                        >
                          <List size={18} />
                        </button>
                      </div>
                    </div>
                    <div className="category-filters">
                      <button
                        className={!category ? "active" : ""}
                        onClick={() => setCategory("")}
                      >
                        全部分类
                      </button>
                      {categories.map((c) => (
                        <button
                          key={c.id}
                          className={category === c.id ? "active" : ""}
                          onClick={() => setCategory(c.id)}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                    <div className="filter-toolbar">
                      <div className="search-box">
                        <Search size={17} />
                        <input
                          aria-label="搜索错题"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="搜索题目、知识点或笔记…"
                        />
                        {query && (
                          <button
                            onClick={() => setQuery("")}
                            aria-label="清除搜索"
                          >
                            <X size={15} />
                          </button>
                        )}
                      </div>
                      <div className="toolbar-options">
                        <select
                          aria-label="按复习状态筛选"
                          value={status}
                          onChange={(e) => setStatus(e.target.value)}
                        >
                          <option value="all">全部状态</option>
                          <option value="todo">待复习与巩固</option>
                          {Object.entries(statusLabels).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <button
                          className={
                            "filter-favorite " + (favorites ? "active" : "")
                          }
                          aria-label="只看收藏"
                          aria-pressed={favorites}
                          onClick={() => setFavorites(!favorites)}
                        >
                          <Bookmark
                            size={16}
                            fill={favorites ? "currentColor" : "none"}
                          />
                          <span>收藏</span>
                        </button>
                        <div className="sort-control">
                          <ArrowDownWideNarrow size={15} />
                          <select
                            aria-label="错题排序"
                            value={sort}
                            onChange={(e) => setSort(e.target.value)}
                          >
                            <option value="new">最新收录</option>
                            <option value="old">最早收录</option>
                            <option value="updated">最近更新</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    {!filtered.length ? (
                      <Empty
                        title={
                          questions.length
                            ? "这里还没有匹配的错题"
                            : "你的进步，从第一道错题开始"
                        }
                        text={
                          questions.length
                            ? "换个关键词，或试试其他分类。"
                            : "拍下不理解的那道题，把它留给更好的自己。"
                        }
                        action={
                          questions.length ? (
                            <button
                              className="button secondary"
                              onClick={() => {
                                setQuery("");
                                setCategory("");
                                setStatus("all");
                                setFavorites(false);
                              }}
                            >
                              清除筛选
                            </button>
                          ) : (
                            <AddButton onClick={() => setEditor("new")} />
                          )
                        }
                      />
                    ) : (
                      <div
                        className={
                          "question-grid " +
                          (view === "list" ? "list-view" : "")
                        }
                      >
                        {filtered.slice(0, visible).map((q, i) => {
                          const c = categories.find(
                            (c) => c.id === q.categoryId,
                          );
                          const Icon = getIcon(categories, c);
                          return (
                            <article
                              className="question-card"
                              key={q.id}
                              style={{
                                animationDelay: Math.min(i, 8) * 35 + "ms",
                              }}
                            >
                              <button
                                className="card-open"
                                onClick={() => {
                                  setDetailQueue(
                                    filtered.map((item) => item.id),
                                  );
                                  setDetail(q.id);
                                }}
                                aria-label={"查看：" + q.title}
                              >
                                <div
                                  className={
                                    "card-preview " + (c?.color || "sage")
                                  }
                                >
                                  {q.questionImages.length ? (
                                    <>
                                      <img
                                        src={q.questionImages[0]}
                                        alt="错题原图"
                                        loading="lazy"
                                      />
                                      <span className="photo-count">
                                        <Camera size={12} />
                                        {q.questionImages.length} 张图片
                                      </span>
                                    </>
                                  ) : (
                                    <div className="paper-preview">
                                      <div className="paper-heading">
                                        <Icon size={15} />
                                        <span>{c?.name || "错题摘录"}</span>
                                        <span>专项练习</span>
                                      </div>
                                      <p>{q.text}</p>
                                      <div className="paper-rule" />
                                      <div className="paper-rule short" />
                                    </div>
                                  )}
                                  <span className="card-number">
                                    {String(
                                      questions.findIndex(
                                        (item) => item.id === q.id,
                                      ) + 1,
                                    ).padStart(2, "0")}
                                  </span>
                                </div>
                                <div className="card-main">
                                  <div className="card-category-row">
                                    <span
                                      className={
                                        "category-text " + (c?.color || "sage")
                                      }
                                    >
                                      <Icon size={13} />
                                      {c?.name || "未分类"}
                                    </span>
                                    <span
                                      className={"status-badge " + q.status}
                                    >
                                      <span />
                                      {statusLabels[q.status]}
                                    </span>
                                  </div>
                                  <h3>{q.title}</h3>
                                  <div className="tags card-tags">
                                    {q.tags.slice(0, 2).map((t) => (
                                      <span key={t}>{t}</span>
                                    ))}
                                  </div>
                                  <div className="card-footer">
                                    <span>
                                      {q.explanationImages.length ? (
                                        <>
                                          <Layers3 size={13} />
                                          含图片解析
                                        </>
                                      ) : q.explanation ? (
                                        <>
                                          <FileTextIcon />
                                          含文字解析
                                        </>
                                      ) : (
                                        <>
                                          <Circle size={12} />
                                          待补充解析
                                        </>
                                      )}
                                    </span>
                                    <time>{dateLabel(q.createdAt)}</time>
                                  </div>
                                </div>
                              </button>
                              <button
                                className={
                                  "card-bookmark " +
                                  (q.favorite ? "active" : "")
                                }
                                aria-label={
                                  q.favorite
                                    ? "取消收藏：" + q.title
                                    : "收藏：" + q.title
                                }
                                onClick={() =>
                                  void update(q.id, {
                                    favorite: !q.favorite,
                                  }).catch((e) => notify(e.message))
                                }
                              >
                                <Bookmark
                                  size={17}
                                  fill={q.favorite ? "currentColor" : "none"}
                                />
                              </button>
                            </article>
                          );
                        })}
                        <button
                          className="add-card"
                          onClick={() => setEditor("new")}
                        >
                          <span>
                            <Plus size={25} strokeWidth={1.4} />
                          </span>
                          <strong>留住下一个进步的机会</strong>
                          <small>拍照、上传或手动输入</small>
                          <span className="add-card-link">
                            收录新错题
                            <ArrowRight size={14} />
                          </span>
                        </button>
                      </div>
                    )}
                    {visible < filtered.length && (
                      <div className="load-more">
                        <button
                          className="button secondary"
                          onClick={() => setVisible((v) => v + 12)}
                        >
                          再看 12 道<ChevronRight size={16} />
                        </button>
                      </div>
                    )}
                    <div className="collection-footnote">
                      <span />
                      <p>不怕犯错，只怕错过成长。</p>
                      <span />
                    </div>
                  </section>
                </>
              )}
              {page === "categories" && (
                <>
                  <SectionHeading
                    eyebrow="A PLACE FOR EVERY QUESTION"
                    title="让知识各归其位"
                    action={
                      <button
                        className="button primary"
                        onClick={() => setCategoryModal(true)}
                      >
                        <FolderPlus size={18} />
                        新建分类
                      </button>
                    }
                  />
                  <p className="page-description">
                    把相似的题目放在一起，也把零散的知识连成一片。
                  </p>
                  <div className="category-grid">
                    {categories.map((c) => {
                      const Icon = getIcon(categories, c);
                      const qs = questions.filter((q) => q.categoryId === c.id);
                      const done = qs.filter(
                        (q) => q.status === "mastered",
                      ).length;
                      return (
                        <button
                          className="category-card"
                          key={c.id}
                          onClick={() => {
                            setCategory(c.id);
                            navigate("notebook");
                          }}
                        >
                          <div>
                            <span className={"category-card-icon " + c.color}>
                              <Icon size={25} strokeWidth={1.5} />
                            </span>
                            <ArrowUpRight size={18} />
                          </div>
                          <h2>{c.name}</h2>
                          <p>
                            {qs.length} 道错题<span>已掌握 {done} 道</span>
                          </p>
                          <div className="progress-track">
                            <span
                              style={{
                                width:
                                  (qs.length ? (done / qs.length) * 100 : 0) +
                                  "%",
                              }}
                            />
                          </div>
                          <small>
                            {qs.length
                              ? Math.round((done / qs.length) * 100)
                              : 0}
                            % 已掌握
                          </small>
                        </button>
                      );
                    })}
                    <button
                      className="category-card create-category"
                      onClick={() => setCategoryModal(true)}
                    >
                      <Plus size={28} />
                      <h2>新的知识分区</h2>
                      <p>为你的学习方式，留一个位置</p>
                    </button>
                  </div>
                  {questions.some((q) => !q.categoryId) && (
                    <button
                      className="uncategorized-row"
                      onClick={() => {
                        setCategory("");
                        setQuery("");
                        navigate("notebook");
                      }}
                    >
                      还有 {questions.filter((q) => !q.categoryId).length}{" "}
                      道题暂未分类，去整理一下
                      <ArrowRight size={17} />
                    </button>
                  )}
                </>
              )}
              {page === "review" && (
                <>
                  <SectionHeading
                    eyebrow="REVISIT. UNDERSTAND. REMEMBER."
                    title="温故，才有新知"
                  />
                  <p className="page-description">
                    不用一次学会所有，每次多理解一点就好。
                  </p>
                  <div className="review-hero">
                    <div
                      className="review-ring"
                      style={{
                        background:
                          "conic-gradient(var(--green) " +
                          progress +
                          "%, #e7ebdf 0)",
                      }}
                    >
                      <div>
                        <strong>
                          {progress}
                          <small>%</small>
                        </strong>
                        <span>总体掌握率</span>
                      </div>
                    </div>
                    <div>
                      <span className="eyebrow">YOUR NEXT SMALL STEP</span>
                      <h2>
                        {pending.length
                          ? "还有 " + pending.length + " 道，值得再想一想。"
                          : "这一刻，所有错题都已掌握。"}
                      </h2>
                      <p>先尝试独立解答，再展开解析。理解比记住答案更重要。</p>
                      <div className="review-start">
                        <select
                          aria-label="选择复习分类"
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                        >
                          <option value="">全部分类</option>
                          {categories.map((c) => (
                            <option value={c.id} key={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="button primary"
                          onClick={startReview}
                          disabled={!pending.length}
                        >
                          <RotateCcw size={17} />
                          开始复习
                          <ArrowRight size={17} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="list-heading">
                    <h2>
                      待复习清单
                      <span>
                        {
                          pending.filter(
                            (q) => !category || q.categoryId === category,
                          ).length
                        }
                      </span>
                    </h2>
                    <span className="muted">按收录时间排序</span>
                  </div>
                  {pending.length ? (
                    <div className="review-list">
                      {pending
                        .filter((q) => !category || q.categoryId === category)
                        .map((q, i) => (
                          <button
                            key={q.id}
                            onClick={() => {
                              setReviewQueue([q.id]);
                              setReviewIndex(0);
                            }}
                          >
                            <span className="review-item-number">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <div>
                              <strong>{q.title}</strong>
                              <span>
                                {categories.find((c) => c.id === q.categoryId)
                                  ?.name || "未分类"}{" "}
                                · 复习 {q.reviews} 次
                              </span>
                            </div>
                            <span className={"status-badge " + q.status}>
                              <span />
                              {statusLabels[q.status]}
                            </span>
                            <ChevronRight size={17} />
                          </button>
                        ))}
                    </div>
                  ) : (
                    <Empty
                      title="每一份努力，都在这里留下痕迹"
                      text="继续收录新的错题，或回到收藏夹重温已掌握的题目。"
                      action={<AddButton onClick={() => setEditor("new")} />}
                    />
                  )}
                </>
              )}
              {page === "ai" && (
                <>
                  <SectionHeading
                    eyebrow="THINK IT THROUGH, TOGETHER"
                    title="你的 AI 学习搭子"
                  />
                  <p className="page-description">
                    读懂题目，理清思路。把“不明白”，聊成“原来如此”。
                  </p>
                  <div className="ai-workspace">
                    <div className="ai-context-bar">
                      <span className="ai-orb">
                        <Sparkles size={18} />
                      </span>
                      <div>
                        <strong>关联一道错题</strong>
                        <select
                          aria-label="AI 关联错题"
                          value={chatContext}
                          disabled={chatBusy}
                          onChange={(e) => {
                            setChatContext(e.target.value);
                            setMessages([]);
                            setChatError(null);
                          }}
                        >
                          <option value="">不关联题目，自由提问</option>
                          {questions.map((q) => (
                            <option key={q.id} value={q.id}>
                              {q.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      <span
                        className={
                          "ai-connection " +
                          (config?.aiConfigured ? "ready" : "")
                        }
                      >
                        <span />
                        {config?.aiConfigured ? "已连接" : "待接入"}
                      </span>
                    </div>
                    <div
                      className="chat-messages"
                      ref={chatScroll}
                      onScroll={() => {
                        const el = chatScroll.current;
                        if (el)
                          autoScroll.current =
                            el.scrollHeight - el.scrollTop - el.clientHeight <
                            100;
                      }}
                    >
                      {!messages.length ? (
                        <div className="ai-welcome">
                          <span className="ai-welcome-icon">
                            <Sparkles size={33} strokeWidth={1.4} />
                          </span>
                          <h2>复杂的题目，一起拆开看。</h2>
                          <p>
                            选择上方错题，我会结合题目图片与已有解析帮你理解。
                            <br />
                            也可以从一个问题开始。
                          </p>
                          <div className="prompt-grid">
                            {[
                              {
                                icon: Lightbulb,
                                title: "这道题，为什么选这个答案？",
                                text: "请结合当前题目的所有选项，解释正确答案为什么成立。",
                              },
                              {
                                icon: Search,
                                title: "帮我找到思路里的盲点",
                                text: "请对比我的答案和正确答案，帮我分析最可能的易错点。",
                              },
                              {
                                icon: Brain,
                                title: "换一种更容易理解的讲法",
                                text: "请用通俗的语言和一个简单例子，重新解释当前题目的解题思路。",
                              },
                              {
                                icon: GraduationCap,
                                title: "总结一个可以复用的方法",
                                text: "请从这道题中提炼一个通用解题方法，并说明适用条件。",
                              },
                            ].map((p) => (
                              <button
                                key={p.title}
                                onClick={() => setChatInput(p.text)}
                              >
                                <p.icon size={18} />
                                <span>{p.title}</span>
                                <ArrowUpRight size={14} />
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        messages.map((m, i) => (
                          <div
                            className={"chat-message " + m.role}
                            key={m.id || i}
                          >
                            <span className="message-avatar">
                              {m.role === "assistant" ? (
                                <Sparkles size={16} />
                              ) : (
                                <span>我</span>
                              )}
                            </span>
                            <div className="message-content">
                              <span className="message-author">
                                {m.role === "assistant" ? "拾题 AI" : "你"}
                              </span>
                              {m.content &&
                                (m.role === "assistant" ? (
                                  <Markdown content={m.content} />
                                ) : (
                                  <div className="prose">{m.content}</div>
                                ))}
                              {m.status === "streaming" && (
                                <div className="ai-stream-status" role="status">
                                  <Spinner size={13} />
                                  <span>
                                    {m.content
                                      ? "正在生成…"
                                      : "正在读取资料，等待回复…"}
                                  </span>
                                </div>
                              )}
                              {m.status === "stopped" && (
                                <div className="ai-stream-status">
                                  已停止生成
                                  {m.content ? " · 已保留收到的内容" : ""}
                                </div>
                              )}
                              {m.status === "error" && (
                                <div className="ai-stream-status">
                                  生成中断
                                  {m.content ? " · 已保留收到的内容" : ""}
                                </div>
                              )}
                              {m.role === "assistant" &&
                                m.questionId &&
                                m.content.trim() &&
                                m.status !== "streaming" && (
                                  <button
                                    className="text-button"
                                    onClick={async () => {
                                      const q = questions.find(
                                        (q) => q.id === m.questionId,
                                      );
                                      if (!q) {
                                        notify("关联的题目已删除");
                                        return;
                                      }
                                      try {
                                        await update(q.id, {
                                          explanation:
                                            q.explanation +
                                            "\n\n—— AI 辅助解析 ——\n" +
                                            m.content,
                                        });
                                        notify("已追加到这道题的解析");
                                      } catch (e) {
                                        notify((e as Error).message);
                                      }
                                    }}
                                  >
                                    <Plus size={14} />
                                    存入这道题的解析
                                  </button>
                                )}
                            </div>
                          </div>
                        ))
                      )}
                      <div ref={chatBottom} />
                    </div>
                    <div className="chat-bottom">
                      {chatError && (
                        <div className="error-box" role="alert">
                          {chatError.message}
                          {user.role === "admin" &&
                            chatError.code === "AI_CONFIGURATION" && (
                              <button
                                className="text-button"
                                onClick={() => {
                                  navigate("settings");
                                  setSettingsTab("ai");
                                }}
                              >
                                检查 AI 配置
                                <ArrowRight size={13} />
                              </button>
                            )}
                        </div>
                      )}
                      {chatContext && (
                        <div className="context-chip">
                          <BookOpen size={13} />
                          <span>
                            {questions.find((q) => q.id === chatContext)
                              ?.title || "关联题目已删除"}
                          </span>
                          {!chatBusy && (
                            <button
                              aria-label="移除关联题目"
                              onClick={() => {
                                setChatContext("");
                                setMessages([]);
                              }}
                            >
                              <X size={12} />
                            </button>
                          )}
                          <small>含图片与解析</small>
                        </div>
                      )}
                      <form
                        className="chat-composer"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void sendChat();
                        }}
                      >
                        <textarea
                          aria-label="向 AI 提问"
                          placeholder="哪里还没想明白？写下来，我们一起看看…"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          rows={2}
                          maxLength={12000}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Enter" &&
                              !e.shiftKey &&
                              !e.nativeEvent.isComposing &&
                              window.innerWidth > 640
                            ) {
                              e.preventDefault();
                              void sendChat();
                            }
                          }}
                        />
                        <div className="composer-footer">
                          <span>
                            <ShieldCheck size={14} />
                            仅在提问时，将关联资料发给 AI 服务
                          </span>
                          {chatBusy ? (
                            <button
                              type="button"
                              className="send-button stop"
                              aria-label="停止生成"
                              onClick={() => chatAbort.current?.abort()}
                            >
                              <Square size={16} fill="currentColor" />
                            </button>
                          ) : (
                            <button
                              className="send-button"
                              aria-label="发送问题"
                              disabled={!chatInput.trim()}
                            >
                              <Send size={18} />
                            </button>
                          )}
                        </div>
                      </form>
                      <p className="ai-disclaimer">
                        AI 辅助理解，答案请结合原题核对。
                      </p>
                    </div>
                  </div>
                </>
              )}
              {page === "settings" && (
                <SpaceSettings
                  initialTab={settingsTab}
                  user={user}
                  config={config}
                  onRefresh={load}
                  onLogout={onLogout}
                  notify={notify}
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>拾题 SHITI</span>
            <span>
              进步不必很快，但要一直发生。
              <Leaf size={12} />
            </span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="主导航">
        {navs.map((n) => (
          <button
            key={n.id}
            className={page === n.id ? "active" : ""}
            onClick={() => navigate(n.id)}
          >
            <n.icon size={21} />
            <span>
              {n.id === "ai"
                ? "AI 助手"
                : n.id === "categories"
                  ? "分类"
                  : n.id === "review"
                    ? "复习"
                    : "错题本"}
            </span>
          </button>
        ))}
        <button onClick={() => setImportOpen(true)} className="mobile-add">
          <span>
            <Plus size={23} />
          </span>
          <small>收录</small>
        </button>
      </nav>
      {importOpen && (
        <PageImporter
          categories={categories}
          config={config}
          onClose={() => setImportOpen(false)}
          onManual={() => {
            setImportOpen(false);
            setEditor("new");
          }}
          onImported={(list) => setQuestions((qs) => [...list, ...qs])}
          notify={notify}
        />
      )}
      {editor && (
        <Editor
          key={editor === "new" ? "new" : editor.id}
          initial={editor === "new" ? undefined : editor}
          categories={categories}
          config={config}
          onClose={() => setEditor(null)}
          onSave={save}
          notify={notify}
        />
      )}
      {current && (
        <Detail
          key={current.id}
          question={current}
          category={categories.find((c) => c.id === current.categoryId)}
          onClose={() => setDetail("")}
          onEdit={() => {
            setEditor(current);
            setDetail("");
          }}
          onUpdate={(d) => update(current.id, d)}
          onDelete={() => remove(current.id)}
          onAI={() => openAI(current.id)}
          position={detailIndex + 1}
          total={detailIds.length}
          onPreviousQuestion={
            detailIndex > 0
              ? () => setDetail(detailIds[detailIndex - 1])
              : undefined
          }
          onNextQuestion={
            detailIndex >= 0 && detailIndex < detailIds.length - 1
              ? () => setDetail(detailIds[detailIndex + 1])
              : undefined
          }
          notify={notify}
        />
      )}
      {reviewCurrent && (
        <Detail
          key={reviewCurrent.id + "-review"}
          question={reviewCurrent}
          category={categories.find((c) => c.id === reviewCurrent.categoryId)}
          reviewMode
          onClose={() => setReviewQueue(null)}
          onEdit={() => setEditor(reviewCurrent)}
          onUpdate={(d) => update(reviewCurrent.id, d)}
          onDelete={() => remove(reviewCurrent.id)}
          onAI={() => openAI(reviewCurrent.id)}
          onNext={nextReview}
          position={reviewIndex + 1}
          total={reviewQueue?.length || 0}
          onPreviousQuestion={
            reviewIndex > 0
              ? () => setReviewIndex((index) => index - 1)
              : undefined
          }
          onNextQuestion={
            reviewQueue && reviewIndex < reviewQueue.length - 1
              ? nextReview
              : undefined
          }
          notify={notify}
        />
      )}
      <Modal
        open={categoryModal}
        onClose={() => setCategoryModal(false)}
        title="给知识一个新位置"
        description="建立适合你的分类，让每一道错题都有归属。"
      >
        <form onSubmit={(e) => void addCategory(e)}>
          <div className="modal-body">
            <label className="field">
              分类名称
              <input
                autoFocus
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                maxLength={24}
                required
                placeholder="例如：常识判断"
              />
            </label>
            <label className="field">分类颜色</label>
            <div className="color-options">
              {["sage", "blue", "peach", "lavender"].map((c, i) => (
                <button
                  type="button"
                  className={c + " " + (categoryColor === c ? "selected" : "")}
                  aria-label={["苔绿", "雾蓝", "杏橙", "淡紫"][i]}
                  aria-pressed={categoryColor === c}
                  key={c}
                  onClick={() => setCategoryColor(c)}
                >
                  {categoryColor === c && <Check size={19} />}
                </button>
              ))}
            </div>
            {categoryError && (
              <div className="error-box" role="alert">
                {categoryError}
              </div>
            )}
          </div>
          <footer className="modal-footer">
            <button
              type="button"
              className="button secondary"
              onClick={() => setCategoryModal(false)}
            >
              取消
            </button>
            <button
              className="button primary"
              disabled={categorySaving || !categoryName.trim()}
            >
              {categorySaving ? <Spinner /> : <Plus size={17} />}创建分类
            </button>
          </footer>
        </form>
      </Modal>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="关闭提示">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function FileTextIcon() {
  return <Hash size={13} />;
}
function App() {
  return (
    <AuthGate>
      {(user, onLogout) => (
        <Workspace key={user.id} user={user} onLogout={onLogout} />
      )}
    </AuthGate>
  );
}
export default App;
