import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  CalendarPlus,
  CheckCheck,
  Image,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { api } from "./lib";
import type { User } from "./lib";
import { Spinner } from "./components";

type Member = User & {
  questionCount: number;
  masteredCount: number;
  reviewCount: number;
  pageCount: number;
  aiToday: number;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  registrationSource: "self" | "admin";
};
type Usage = {
  updatedAt: string;
  summary: {
    totalUsers: number;
    disabledUsers: number;
    newToday: number;
    activeToday: number;
    activeWeek: number;
    questionCount: number;
    aiToday: number;
  };
  users: Member[];
};
const number = (value: number) => value.toLocaleString("zh-CN");
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        year: "numeric",
        hour12: false,
      })
    : "暂无记录";

export default function UserManagement({
  user,
  version,
  onAdd,
  notify,
}: {
  user: User;
  version: number;
  onAdd: () => void;
  notify: (text: string) => void;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [changing, setChanging] = useState<string | null>(null);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      setUsage(await api<Usage>("/admin/usage"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(visible, 60000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, version]);
  async function toggleMember(member: Member) {
    setChanging(member.id);
    try {
      await api("/admin/users/" + member.id, {
        method: "PATCH",
        body: JSON.stringify({ active: !member.active }),
      });
      await refresh();
      notify(member.active ? "账号已停用，已有会话已退出" : "账号已启用");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setChanging(null);
    }
  }
  const search = query.trim().toLowerCase();
  const members = (usage?.users || []).filter((member) => {
    const matches =
      member.username.toLowerCase().includes(search) ||
      member.displayName.toLowerCase().includes(search);
    const state =
      filter === "all" ||
      (filter === "enabled" && member.active) ||
      (filter === "disabled" && !member.active) ||
      (filter === "self" && member.registrationSource === "self");
    return matches && state;
  });
  const summary = usage?.summary;
  const cards = [
    {
      title: "总用户数",
      value: summary?.totalUsers,
      icon: Users,
      note: summary
        ? `含管理员 · 已停用 ${summary.disabledUsers} 人`
        : "全部注册账号",
      color: "sage",
    },
    {
      title: "今日新增",
      value: summary?.newToday,
      icon: CalendarPlus,
      note: "今天加入的学习者",
      color: "peach",
    },
    {
      title: "今日活跃",
      value: summary?.activeToday,
      icon: Activity,
      note: "今天实际访问过的用户",
      color: "sage",
    },
    {
      title: "近 7 天活跃",
      value: summary?.activeWeek,
      icon: Users,
      note: "含今天 · 按用户去重",
      color: "lavender",
    },
    {
      title: "累计收录错题",
      value: summary?.questionCount,
      icon: BookOpen,
      note: "所有空间当前保存的错题",
      color: "peach",
    },
    {
      title: "今日 AI 请求",
      value: summary?.aiToday,
      icon: Sparkles,
      note: "识别、解析与对话合计",
      color: "lavender",
    },
  ];
  return (
    <div className="user-management">
      <div className="usage-heading">
        <div>
          <span className="eyebrow">SPACE AT A GLANCE</span>
          <h2>看看大家的学习进展</h2>
          <p>注册已开放，每个人都可以直接建立自己的学习空间。</p>
        </div>
        <button
          className="button secondary button-small"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? <Spinner size={15} /> : <RefreshCw size={15} />}刷新数据
        </button>
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
          {usage && " · 当前显示上次更新的数据"}
        </div>
      )}
      <div className="usage-overview" aria-busy={loading}>
        {cards.map(({ title, value, icon: Icon, note, color }) => (
          <article className="usage-card" key={title}>
            <div>
              <span>{title}</span>
              <span className={"stat-icon " + color}>
                <Icon size={19} />
              </span>
            </div>
            <strong>{value === undefined ? "—" : number(value)}</strong>
            <p>{note}</p>
          </article>
        ))}
      </div>
      <p className="usage-method">
        用户日期按北京时间统计；AI 日额度按 UTC
        结算，请求失败或中止也计入次数。活跃时间约每分钟更新，页面每分钟刷新。
        {usage && <span>更新于 {date(usage.updatedAt)}</span>}
      </p>
      <section className="settings-card usage-members">
        <div className="usage-members-heading">
          <div>
            <h2>
              用户与使用情况 <span>{usage?.users.length ?? "—"}</span>
            </h2>
            <p>查看使用统计、管理账号状态。</p>
          </div>
          <button className="button primary button-small" onClick={onAdd}>
            <Plus size={16} />
            添加用户
          </button>
        </div>
        <div className="usage-toolbar">
          <label className="usage-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索昵称或用户名"
              aria-label="搜索用户"
            />
          </label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="筛选用户"
          >
            <option value="all">全部用户</option>
            <option value="enabled">正常使用</option>
            <option value="disabled">已停用</option>
            <option value="self">自主注册</option>
          </select>
        </div>
        {!usage && loading ? (
          <div className="page-loading">
            <Spinner />
            <span>正在读取使用情况…</span>
          </div>
        ) : !usage ? (
          <div className="usage-empty">
            使用情况暂时无法加载，请点击刷新重试。
          </div>
        ) : members.length === 0 ? (
          <div className="usage-empty">
            没有找到符合条件的用户，试试其他昵称或筛选条件。
          </div>
        ) : (
          <div className="usage-user-list">
            {members.map((member) => (
              <article className="usage-user" key={member.id}>
                <div className="usage-identity">
                  <span
                    className={
                      "member-avatar " +
                      (member.role === "admin" ? "sage" : "lavender")
                    }
                  >
                    {member.displayName.slice(0, 1)}
                  </span>
                  <div className="usage-name">
                    <strong>
                      {member.displayName}
                      {member.id === user.id && <small>你</small>}
                    </strong>
                    <span>
                      @{member.username} ·{" "}
                      {member.role === "admin" ? "管理员" : "学习者"} ·{" "}
                      {member.registrationSource === "self"
                        ? "自主注册"
                        : "管理员创建"}
                    </span>
                  </div>
                  <span
                    className={
                      "member-state " + (member.active ? "active" : "")
                    }
                  >
                    <span />
                    {member.active ? "正常" : "已停用"}
                  </span>
                </div>
                <dl className="usage-user-stats">
                  <div>
                    <dt>
                      <BookOpen size={13} />
                      错题
                    </dt>
                    <dd>{number(member.questionCount)}</dd>
                  </div>
                  <div>
                    <dt>
                      <CheckCheck size={13} />
                      已掌握
                    </dt>
                    <dd>{number(member.masteredCount)}</dd>
                  </div>
                  <div>
                    <dt>
                      <RefreshCw size={13} />
                      复习次数
                    </dt>
                    <dd>{number(member.reviewCount)}</dd>
                  </div>
                  <div>
                    <dt>
                      <Image size={13} />
                      导入整页
                    </dt>
                    <dd>{number(member.pageCount)}</dd>
                  </div>
                  <div>
                    <dt>
                      <Sparkles size={13} />
                      今日 AI
                    </dt>
                    <dd>{number(member.aiToday)}</dd>
                  </div>
                </dl>
                <footer className="usage-user-footer">
                  <div>
                    <span>注册：{date(member.createdAt)}</span>
                    <span>最近登录：{date(member.lastLoginAt)}</span>
                    <span>最近使用：{date(member.lastActiveAt)}</span>
                  </div>
                  {member.id === user.id ? (
                    <span className="self-label">当前账号</span>
                  ) : (
                    <button
                      className="button secondary button-small"
                      disabled={changing !== null}
                      onClick={() => void toggleMember(member)}
                    >
                      {changing === member.id ? <Spinner size={13} /> : null}
                      {member.active ? "停用账号" : "启用账号"}
                    </button>
                  )}
                </footer>
              </article>
            ))}
          </div>
        )}
        <p className="usage-footnote">
          登录与活跃记录从本次更新起积累；历史错题、复习和导入数量按现存数据统计。统计不包含其他用户的错题正文。
        </p>
      </section>
    </div>
  );
}
