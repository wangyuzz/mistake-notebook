import { useEffect, useState } from "react";
import type { ReactNode, FormEvent } from "react";
import {
  BookOpen,
  ArrowRight,
  ShieldCheck,
  ScanLine,
  Layers3,
  Eye,
  EyeOff,
  Leaf,
} from "lucide-react";
import { api } from "./lib";
import type { User } from "./lib";
import { BookIllustration, Spinner } from "./components";
export default function AuthGate({
  children,
}: {
  children: (user: User, logout: () => Promise<void>) => ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [boot, setBoot] = useState(true);
  const [initialized, setInitialized] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [tokenRequired, setTokenRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const creating = !initialized || registering;
  function switchMode(register: boolean) {
    setRegistering(register);
    setError("");
    setPassword("");
    setConfirm("");
    setShow(false);
  }
  async function check() {
    setBoot(true);
    setError("");
    try {
      const s = await api<{
        initialized: boolean;
        setupTokenRequired: boolean;
      }>("/auth/status");
      setInitialized(s.initialized);
      setTokenRequired(s.setupTokenRequired);
      if (s.initialized) {
        try {
          setUser(await api<User>("/auth/me"));
        } catch (e) {
          if ((e as { status?: number }).status !== 401) throw e;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBoot(false);
    }
  }
  useEffect(() => {
    void check();
    const expire = () => {
      setUser(null);
      setPassword("");
      setError("登录已过期，请重新登录。");
    };
    window.addEventListener("shiti:unauthorized", expire);
    return () => window.removeEventListener("shiti:unauthorized", expire);
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (creating && password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const u = await api<User>(
        !initialized
          ? "/auth/setup"
          : registering
            ? "/auth/register"
            : "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            username,
            password,
            displayName,
            setupToken: token,
          }),
        },
      );
      setUser(u);
      setInitialized(true);
      setRegistering(false);
      setPassword("");
      setConfirm("");
    } catch (e) {
      setError((e as Error).message);
      if (!initialized && (e as { status?: number }).status === 409)
        setInitialized(true);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
    setPassword("");
    setError("");
  }
  if (boot)
    return (
      <div className="auth-boot">
        <Spinner size={28} />
        <span>正在打开拾题…</span>
      </div>
    );
  if (user) return <>{children(user, logout)}</>;
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a className="auth-brand" href="#">
          <span className="brand-icon">
            <BookOpen size={25} />
          </span>
          <strong>
            拾题 <small>SHITI</small>
          </strong>
        </a>
        <div className="auth-story-content">
          <span className="eyebrow">A SPACE FOR YOUR OWN PROGRESS</span>
          <h1>
            每一份进步，
            <br />
            都有自己的空间。
          </h1>
          <p>
            把不会的留在这里，
            <br />
            把学会的带去下一次。
          </p>
          <BookIllustration />
          <div className="auth-feature-list">
            <span>
              <ScanLine size={18} />
              整页拍照，分题收藏
            </span>
            <span>
              <Layers3 size={18} />
              题目与解析，一起整理
            </span>
            <span>
              <ShieldCheck size={18} />
              独立空间，安心积累
            </span>
          </div>
        </div>
        <span className="auth-story-footer">
          <Leaf size={14} /> LITTLE BY LITTLE, A LITTLE BECOMES A LOT.
        </span>
      </section>
      <section className="auth-form-section">
        <div className="auth-form-card">
          {initialized && (
            <div className="auth-mode-switch" aria-label="账号入口">
              <button
                type="button"
                aria-pressed={!registering}
                className={!registering ? "active" : ""}
                disabled={busy}
                onClick={() => switchMode(false)}
              >
                登录
              </button>
              <button
                type="button"
                aria-pressed={registering}
                className={registering ? "active" : ""}
                disabled={busy}
                onClick={() => switchMode(true)}
              >
                注册新账号
              </button>
            </div>
          )}
          <span className="eyebrow">
            {creating ? "LET’S BEGIN" : "WELCOME BACK"}
          </span>
          <h2>{creating ? "建立你的学习空间" : "欢迎回到拾题"}</h2>
          <p>
            {!initialized
              ? "先创建首位管理员，原有错题会保留到你的空间。"
              : registering
                ? "无需邀请，注册即可开始整理错题。"
                : "登录后，接着上次的进步。"}
          </p>
          {!initialized && (
            <div className="setup-note">
              <ShieldCheck size={17} />
              <span>首位管理员负责管理用户和配置 AI 服务。</span>
            </div>
          )}
          <form onSubmit={(e) => void submit(e)}>
            {creating && (
              <label className="field">
                你的称呼
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="希望我们怎么称呼你"
                  required
                  maxLength={30}
                  autoComplete="nickname"
                />
              </label>
            )}
            <label className="field">
              用户名
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={
                  creating ? "字母、数字、. _ -，至少 3 位" : "输入你的用户名"
                }
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                minLength={3}
                maxLength={40}
              />
            </label>
            <label className="field">
              {creating ? "设置密码" : "密码"}
              <div className="password-field">
                <input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={creating ? 10 : 1}
                  maxLength={128}
                  autoComplete={creating ? "new-password" : "current-password"}
                  placeholder={creating ? "至少 10 位" : "输入你的密码"}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={show ? "隐藏密码" : "显示密码"}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {creating && (
              <>
                <label className="field">
                  确认密码
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={10}
                    maxLength={128}
                    autoComplete="new-password"
                    placeholder="再输入一次密码"
                  />
                </label>
                {!initialized && tokenRequired && (
                  <label className="field">
                    初始化口令
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      required
                      placeholder="由部署者提供的 SETUP_TOKEN"
                    />
                  </label>
                )}
              </>
            )}
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
            <button className="button primary auth-submit" disabled={busy}>
              {busy ? <Spinner /> : <ArrowRight size={18} />}{" "}
              {!initialized
                ? "创建管理员并进入"
                : registering
                  ? "注册并进入学习空间"
                  : "进入学习空间"}
            </button>
          </form>
          <p className="auth-form-footnote">
            {initialized ? (
              <>
                {registering ? "已有账号？" : "还没有账号？"}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => switchMode(!registering)}
                >
                  {registering ? "去登录" : "立即注册"}
                </button>
              </>
            ) : (
              "每位用户都拥有独立的错题、分类和学习记录。"
            )}
          </p>
        </div>
        <span className="auth-mobile-footer">拾起错题，积累进步。</span>
      </section>
    </main>
  );
}
