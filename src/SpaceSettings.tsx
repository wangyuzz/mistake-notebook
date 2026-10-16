import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Users,
  ShieldCheck,
  Sparkles,
  LogOut,
  Plus,
  Save,
  PlugZap,
  Download,
  KeyRound,
  Check,
  EyeOff,
  SlidersHorizontal,
  BookOpen,
  ArrowUpRight,
} from "lucide-react";
import { api } from "./lib";
import type { Config, User } from "./lib";
import { Modal, SectionHeading, Spinner } from "./components";
import UserManagement from "./UserManagement";
type PromptKey =
  | "recognitionSystemPrompt"
  | "recognitionUserPrompt"
  | "explanationRecognitionSystemPrompt"
  | "explanationRecognitionUserPrompt"
  | "tutorSystemPrompt"
  | "contextPrompt"
  | "analysisPrompt";
const promptLabels: [PromptKey, string, string][] = [
  [
    "recognitionSystemPrompt",
    "拆题识别 · 系统提示词",
    "定义识别任务与图形保留规则。",
  ],
  [
    "recognitionUserPrompt",
    "拆题识别 · 任务模板",
    "保留返回 JSON 的结构；尺寸和分类将在请求时自动填入。",
  ],
  ["tutorSystemPrompt", "解析与对话 · 系统提示词", "单题解析和 AI 对话共用。"],
  [
    "explanationRecognitionSystemPrompt",
    "解析图片转文字 · 系统提示词",
    "只转写已有解析；沿用拆题识别的模型与思考等级。",
  ],
  [
    "explanationRecognitionUserPrompt",
    "解析图片转文字 · 任务提示词",
    "定义转写、公式和模糊文字的处理方式。",
  ],
  [
    "contextPrompt",
    "解析与对话 · 题目资料模板",
    "自动填入当前错题的文字、参考解析、答案和笔记。",
  ],
  [
    "analysisPrompt",
    "单题解析 · 任务提示词",
    "仅在点击 AI 解析时追加；自由对话会追加用户实际输入。",
  ],
];
const effortOptions = [
  ["default", "跟随模型默认"],
  ["none", "不思考 · none"],
  ["minimal", "极低 · minimal"],
  ["low", "低 · low"],
  ["medium", "中 · medium"],
  ["high", "高 · high"],
  ["xhigh", "很高 · xhigh"],
  ["max", "最高 · max"],
];
type AISettings = Record<PromptKey, string> & {
  recognitionOutputRules: string;
  enabled: boolean;
  baseUrl: string;
  model: string;
  recognitionModel: string;
  reasoningEffort: string;
  recognitionReasoningEffort: string;
  autoRecognize: boolean;
  perMinuteLimit: number;
  dailyLimit: number;
  timeoutMs: number;
  apiKeyConfigured: boolean;
  apiKeyHint: string;
  configured: boolean;
};
export default function SpaceSettings({
  initialTab,
  user,
  onRefresh,
  onLogout,
  notify,
}: {
  initialTab?: "account" | "ai" | "users";
  user: User;
  config: Config | null;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const isAdmin = user.role === "admin";
  const [tab, setTab] = useState<"account" | "ai" | "users">(
    isAdmin ? initialTab || "users" : "account",
  );
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [promptDefaults, setPromptDefaults] = useState<Record<
    PromptKey,
    string
  > | null>(null);
  const [usersVersion, setUsersVersion] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [newUser, setNewUser] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [creating, setCreating] = useState(false);
  const [userError, setUserError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  async function load() {
    setError("");
    try {
      if (isAdmin) {
        const [s, defaults] = await Promise.all([
          api<AISettings>("/admin/settings"),
          api<Record<PromptKey, string>>("/admin/prompts/defaults"),
        ]);
        setSettings(s);
        setPromptDefaults(defaults);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function set<K extends keyof AISettings>(key: K, value: AISettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setDirty(true);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError("");
    try {
      const s = await api<AISettings>("/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...settings,
          apiKey: apiKey || undefined,
          clearApiKey: clearKey,
        }),
      });
      setSettings(s);
      setApiKey("");
      setClearKey(false);
      setDirty(false);
      await onRefresh();
      notify("配置已保存，立即对所有学习空间生效");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function testConnection() {
    setTesting(true);
    setError("");
    try {
      await api("/admin/settings/test", { method: "POST" });
      notify("AI 服务已连通");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }
  async function createMember(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setUserError("");
    try {
      await api("/admin/users", {
        method: "POST",
        body: JSON.stringify({ username, displayName, password, role }),
      });
      setNewUser(false);
      setUsername("");
      setDisplayName("");
      setPassword("");
      setUsersVersion((value) => value + 1);
      notify("账号已创建，用户可使用初始密码登录");
    } catch (e) {
      setUserError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }
  async function exportData() {
    try {
      const data = await api("/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download =
        "拾题备份-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("已导出你的错题、图片和来源整页");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      notify("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      notify("密码已更新，其他登录会话已退出");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SectionHeading
        eyebrow={
          isAdmin ? "A THOUGHTFUL SPACE, FOR EVERYONE" : "YOUR SPACE, YOUR PACE"
        }
        title={isAdmin ? "管理控制台" : "我的学习空间"}
        action={
          <span className="pill sage">
            <ShieldCheck size={13} />
            {isAdmin ? "管理员" : "普通用户"}
          </span>
        }
      />
      <p className="page-description">
        {isAdmin
          ? "管理服务与账号，让每个人都能安心专注。"
          : "属于你的积累，只在你的空间里。"}
      </p>
      <div className="settings-tabs">
        {isAdmin && (
          <>
            <button
              className={tab === "ai" ? "active" : ""}
              onClick={() => setTab("ai")}
            >
              <SlidersHorizontal size={16} />
              AI 与识别配置
            </button>
            <button
              className={tab === "users" ? "active" : ""}
              onClick={() => setTab("users")}
            >
              <Users size={16} />
              用户与使用情况
            </button>
          </>
        )}
        <button
          className={tab === "account" ? "active" : ""}
          onClick={() => setTab("account")}
        >
          <ShieldCheck size={16} />
          我的账号
        </button>
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {tab === "ai" &&
        isAdmin &&
        (settings ? (
          <form onSubmit={(e) => void save(e)} className="admin-ai-form">
            <section className="settings-card">
              <div className="settings-heading">
                <span className="stat-icon sage">
                  <Sparkles size={22} />
                </span>
                <div>
                  <h2>让 AI 成为学习的助力</h2>
                  <p>保存后即时生效，所有学习空间共用此服务。</p>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    aria-label="启用 AI 服务"
                    checked={settings.enabled}
                    onChange={(e) => set("enabled", e.target.checked)}
                  />
                  <span />
                </label>
              </div>
              <label className="field">
                API 服务地址
                <input
                  type="url"
                  value={settings.baseUrl}
                  onChange={(e) => set("baseUrl", e.target.value)}
                  placeholder="https://你的服务/v1"
                  required
                />
              </label>
              <label className="field">
                API 密钥
                <div className="secret-label">
                  <EyeOff size={13} />
                  <span>
                    {settings.apiKeyConfigured
                      ? "已加密保存 " + settings.apiKeyHint + "，留空保留原密钥"
                      : "尚未配置密钥"}
                  </span>
                </div>
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setClearKey(false);
                    setDirty(true);
                  }}
                  placeholder={
                    settings.apiKeyConfigured
                      ? "输入新密钥以替换"
                      : "输入你的 API Key"
                  }
                />
              </label>
              {settings.apiKeyConfigured && (
                <label className="check-label subtle">
                  <input
                    type="checkbox"
                    checked={clearKey}
                    onChange={(e) => {
                      setClearKey(e.target.checked);
                      setDirty(true);
                    }}
                  />
                  清除已保存的密钥
                </label>
              )}
              <div className="two-columns">
                <label className="field">
                  解题与对话模型
                  <input
                    value={settings.model}
                    onChange={(e) => set("model", e.target.value)}
                    maxLength={120}
                    placeholder="支持视觉输入的模型名称"
                  />
                </label>
                <label className="field">
                  图片识别模型（拆题 / 解析转文字）
                  <input
                    value={settings.recognitionModel}
                    onChange={(e) => set("recognitionModel", e.target.value)}
                    maxLength={120}
                    placeholder="留空使用同一模型"
                  />
                </label>
              </div>
              <div className="two-columns reasoning-selects">
                <label className="field">
                  解题与对话思考等级
                  <select
                    aria-label="解题与对话思考等级"
                    value={settings.reasoningEffort}
                    onChange={(e) => set("reasoningEffort", e.target.value)}
                  >
                    {effortOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  图片识别思考等级
                  <select
                    aria-label="图片识别思考等级"
                    value={settings.recognitionReasoningEffort}
                    onChange={(e) =>
                      set("recognitionReasoningEffort", e.target.value)
                    }
                  >
                    <option value="inherit">沿用解题与对话设置</option>
                    {effortOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="settings-footnote reasoning-note">
                思考等级通过 reasoning_effort 发送给
                API。不同模型支持的等级不同；不确定时选择“跟随模型默认”。
              </p>
              <div className="config-note">
                <BookOpen size={17} />
                <p>
                  采用兼容 Chat Completions 的视觉
                  API。拆题与解析图片转文字共用图片识别模型和思考等级；解题会发送所选错题与解析图片。
                </p>
              </div>
            </section>
            <section className="settings-card">
              <div className="settings-heading">
                <span className="stat-icon lavender">
                  <SlidersHorizontal size={22} />
                </span>
                <div>
                  <h2>识别与使用偏好</h2>
                  <p>把识别的主动权，留给使用者。</p>
                </div>
              </div>
              <label className="setting-toggle-row">
                <div>
                  <strong>上传后自动识别题目</strong>
                  <small>先识别题目范围，确认后再收录；不会自动解题。</small>
                </div>
                <span className="toggle">
                  <input
                    type="checkbox"
                    aria-label="上传后自动识别"
                    checked={settings.autoRecognize}
                    onChange={(e) => set("autoRecognize", e.target.checked)}
                  />
                  <span />
                </span>
              </label>
              <div className="two-columns">
                <label className="field">
                  每位用户每分钟请求上限
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={settings.perMinuteLimit}
                    onChange={(e) =>
                      set("perMinuteLimit", Number(e.target.value))
                    }
                    required
                  />
                </label>
                <label className="field">
                  每位用户每日请求上限
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={settings.dailyLimit}
                    onChange={(e) => set("dailyLimit", Number(e.target.value))}
                    required
                  />
                </label>
              </div>
              <label className="field">
                请求超时（秒）
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={settings.timeoutMs / 1000}
                  onChange={(e) =>
                    set("timeoutMs", Number(e.target.value) * 1000)
                  }
                  required
                />
              </label>
              <p className="settings-footnote">
                每日按 UTC
                日期统计请求次数。数据库连接和配置加密主密钥由部署环境管理，修改后需重启服务。
              </p>
            </section>
            <section className="settings-card prompt-settings">
              <div className="settings-heading">
                <span className="stat-icon sage">
                  <BookOpen size={22} />
                </span>
                <div>
                  <h2>发给模型的提示词</h2>
                  <p>这里展示实际使用的模板，编辑保存后立即生效。</p>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={!promptDefaults}
                  onClick={() => {
                    if (promptDefaults) {
                      setSettings((v) => (v ? { ...v, ...promptDefaults } : v));
                      setDirty(true);
                    }
                  }}
                >
                  恢复默认
                </button>
              </div>
              <div className="prompt-variable-note">
                <p>
                  自动替换变量：<code>{"{{width}}"}</code>、
                  <code>{"{{height}}"}</code>、<code>{"{{categories}}"}</code>、
                  <code>{"{{question}}"}</code>。
                </p>
                <p>
                  识别附带当前照片；解析和对话附带题目与参考解析图片，以及对话历史。测试连接固定发送“请只回复
                  OK。”。
                </p>
              </div>
              <div className="prompt-editors">
                <details>
                  <summary>
                    识别结果格式（自动附加）<span>只读</span>
                  </summary>
                  <p>
                    每次拆题识别都会追加这段要求，确保题目与选项分开返回；已有模板可继续使用。
                  </p>
                  <textarea
                    aria-label="自动附加的识别结果格式"
                    readOnly
                    rows={5}
                    value={settings.recognitionOutputRules || ""}
                  />
                </details>
                {promptLabels.map(([key, label, description], i) => (
                  <details key={key} open={i === 0 || i === 1}>
                    <summary>
                      {label}
                      <span>{settings[key].length} 字</span>
                    </summary>
                    <p>{description}</p>
                    <textarea
                      aria-label={label}
                      value={settings[key]}
                      onChange={(e) => set(key, e.target.value)}
                      rows={key === "recognitionUserPrompt" ? 10 : 4}
                      required
                      maxLength={16000}
                    />
                  </details>
                ))}
              </div>
            </section>
            <div className="admin-save-bar">
              <span>{dirty ? "有未保存的更改" : "当前配置已保存"}</span>
              <button
                type="button"
                className="button secondary"
                disabled={testing || dirty || !settings.configured}
                onClick={() => void testConnection()}
              >
                {testing ? <Spinner /> : <PlugZap size={16} />}测试连接
              </button>
              <button className="button primary" disabled={busy || testing}>
                {busy ? <Spinner /> : <Save size={16} />}保存配置
              </button>
            </div>
          </form>
        ) : (
          <div className="page-loading">
            <Spinner />
          </div>
        ))}
      {tab === "users" && isAdmin && (
        <UserManagement
          user={user}
          version={usersVersion}
          onAdd={() => setNewUser(true)}
          notify={notify}
        />
      )}
      {tab === "account" && (
        <div className="settings-grid">
          <section className="settings-card">
            <div className="account-identity">
              <span>{user.displayName.slice(0, 1)}</span>
              <div>
                <h2>{user.displayName}</h2>
                <p>
                  @{user.username} · {isAdmin ? "管理员" : "学习者"}
                </p>
              </div>
            </div>
            <div className="config-note">
              <ShieldCheck size={17} />
              <p>
                错题、分类、图片和笔记按账号独立保存。导出备份只包含你自己的学习资料。
              </p>
            </div>
            <div className="account-actions">
              <button
                className="button secondary"
                onClick={() => void exportData()}
              >
                <Download size={16} />
                导出我的完整备份
              </button>
              <button
                className="text-button logout"
                onClick={() => void onLogout().catch((e) => notify(e.message))}
              >
                <LogOut size={16} />
                退出登录
                <ArrowUpRight size={14} />
              </button>
            </div>
          </section>
          <section className="settings-card">
            <h2 className="account-section-title">
              <KeyRound size={18} />
              修改登录密码
            </h2>
            <form onSubmit={(e) => void changePassword(e)}>
              <label className="field">
                当前密码
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  maxLength={128}
                />
              </label>
              <label className="field">
                新密码
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={10}
                  maxLength={128}
                  placeholder="至少 10 位"
                />
              </label>
              <label className="field">
                确认新密码
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={10}
                  maxLength={128}
                />
              </label>
              <button className="button primary" disabled={busy}>
                {busy ? <Spinner /> : <Check size={16} />}更新密码
              </button>
            </form>
          </section>
        </div>
      )}
      <Modal
        open={newUser}
        onClose={() => setNewUser(false)}
        title="添加学习账号"
        description="用户也可以在登录页自主注册；这里可手动创建普通账号或管理员。"
      >
        <form onSubmit={(e) => void createMember(e)}>
          <div className="modal-body">
            <label className="field">
              称呼
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={30}
                placeholder="例如：小林"
              />
            </label>
            <label className="field">
              用户名
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={40}
                autoCapitalize="none"
                autoComplete="off"
                placeholder="字母、数字、. _ -"
              />
            </label>
            <label className="field">
              初始密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                placeholder="至少 10 位，用户登录后可修改"
              />
            </label>
            <label className="field">
              账号角色
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="member">普通用户 · 独立学习空间</option>
                <option value="admin">管理员 · 可配置全站服务</option>
              </select>
            </label>
            {userError && (
              <div className="error-box" role="alert">
                {userError}
              </div>
            )}
          </div>
          <footer className="modal-footer">
            <button
              type="button"
              className="button secondary"
              onClick={() => setNewUser(false)}
            >
              取消
            </button>
            <button className="button primary" disabled={creating}>
              {creating ? <Spinner /> : <Plus size={16} />}创建用户
            </button>
          </footer>
        </form>
      </Modal>
    </>
  );
}
