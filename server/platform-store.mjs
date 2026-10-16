import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { demoData } from "./store.mjs";
const defaults = () => structuredClone(demoData().categories);
const issue = (status, message) =>
  Object.assign(new Error(message), { status });
const activityCutoff = () => {
  const now = Date.now();
  const midnight =
    Math.floor((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
  return new Date(Math.max(now - 60000, midnight)).toISOString();
};
export async function createPlatformStore({
  connectionString,
  ssl = false,
  dataFile = path.resolve("data/demo.json"),
  pool: providedPool,
} = {}) {
  const pool =
    providedPool ||
    (connectionString
      ? new pg.Pool({
          connectionString,
          ssl: ssl ? { rejectUnauthorized: true } : undefined,
        })
      : null);
  if (pool) {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS platform_users (id UUID PRIMARY KEY, username TEXT NOT NULL UNIQUE, data JSONB NOT NULL)",
    );
    await pool.query(
      "CREATE TABLE IF NOT EXISTS platform_sessions (id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES platform_users(id), expires_at BIGINT NOT NULL)",
    );
    await pool.query(
      "CREATE TABLE IF NOT EXISTS platform_settings (id TEXT PRIMARY KEY, data JSONB NOT NULL)",
    );
    await pool.query(
      "CREATE TABLE IF NOT EXISTS workspace_categories (user_id UUID NOT NULL REFERENCES platform_users(id), id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, PRIMARY KEY(user_id,id), UNIQUE(user_id,name))",
    );
    await pool.query(
      "CREATE TABLE IF NOT EXISTS workspace_questions (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES platform_users(id), category_id TEXT, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, FOREIGN KEY(user_id,category_id) REFERENCES workspace_categories(user_id,id))",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS workspace_questions_owner_idx ON workspace_questions(user_id)",
    );
    await pool.query(
      "CREATE TABLE IF NOT EXISTS workspace_pages (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES platform_users(id), data JSONB NOT NULL)",
    );
    await pool.query(
      "CREATE TABLE IF NOT EXISTS ai_usage (user_id UUID NOT NULL REFERENCES platform_users(id), day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(user_id,day))",
    );
    await pool.query(
      "INSERT INTO platform_settings(id,data) VALUES('bootstrap','{}') ON CONFLICT DO NOTHING",
    );
    const getUser = async (id) =>
      (await pool.query("SELECT data FROM platform_users WHERE id=$1", [id]))
        .rows[0]?.data || null;
    const createUser = async (user, bootstrap = false) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (bootstrap) {
          await client.query(
            "SELECT data FROM platform_settings WHERE id='bootstrap' FOR UPDATE",
          );
          if ((await client.query("SELECT id FROM platform_users")).rows.length)
            throw issue(409, "管理员已经建立，请直接登录");
        }
        await client.query(
          "INSERT INTO platform_users(id,username,data) VALUES($1,$2,$3)",
          [user.id, user.username, JSON.stringify(user)],
        );
        for (const c of defaults())
          await client.query(
            "INSERT INTO workspace_categories(user_id,id,name,color) VALUES($1,$2,$3,$4)",
            [user.id, c.id, c.name, c.color],
          );
        // Adopt the previous single-user notebook once, inside the first-admin transaction.
        if (bootstrap) {
          const legacy = (
            await client.query(
              "SELECT table_name FROM information_schema.tables WHERE table_name='questions'",
            )
          ).rows;
          if (legacy.length) {
            const cs = (await client.query("SELECT * FROM categories")).rows;
            for (const c of cs)
              await client.query(
                "INSERT INTO workspace_categories(user_id,id,name,color) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
                [user.id, c.id, c.name, c.color],
              );
            for (const r of (await client.query("SELECT * FROM questions"))
              .rows)
              await client.query(
                "INSERT INTO workspace_questions(id,user_id,category_id,data,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
                [
                  r.id,
                  user.id,
                  r.category_id,
                  JSON.stringify(r.data),
                  r.created_at,
                ],
              );
          }
        }
        await client.query("COMMIT");
        return user;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    };
    const forUser = (userId) => ({
      mode: "postgres",
      async listCategories() {
        return (
          await pool.query(
            "SELECT id,name,color FROM workspace_categories WHERE user_id=$1 ORDER BY id",
            [userId],
          )
        ).rows;
      },
      async addCategory(name, color) {
        const c = { id: randomUUID(), name, color };
        await pool.query(
          "INSERT INTO workspace_categories(user_id,id,name,color) VALUES($1,$2,$3,$4)",
          [userId, c.id, name, color],
        );
        return c;
      },
      async list() {
        return (
          await pool.query(
            "SELECT data FROM workspace_questions WHERE user_id=$1 ORDER BY created_at DESC",
            [userId],
          )
        ).rows.map((r) => r.data);
      },
      async get(id) {
        return (
          (
            await pool.query(
              "SELECT data FROM workspace_questions WHERE id=$1 AND user_id=$2",
              [id, userId],
            )
          ).rows[0]?.data || null
        );
      },
      async save(q) {
        const result = await pool.query(
          "INSERT INTO workspace_questions(id,user_id,category_id,data,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET category_id=EXCLUDED.category_id,data=EXCLUDED.data WHERE workspace_questions.user_id=$2 RETURNING id",
          [q.id, userId, q.categoryId || null, JSON.stringify(q), q.createdAt],
        );
        if (!result.rows.length) throw issue(404, "这道题不存在");
        return q;
      },
      async remove(id) {
        return (
          (
            await pool.query(
              "DELETE FROM workspace_questions WHERE id=$1 AND user_id=$2",
              [id, userId],
            )
          ).rowCount > 0
        );
      },
      async getPage(id) {
        return (
          (
            await pool.query(
              "SELECT data FROM workspace_pages WHERE id=$1 AND user_id=$2",
              [id, userId],
            )
          ).rows[0]?.data || null
        );
      },
      async listPages() {
        return (
          await pool.query(
            "SELECT data FROM workspace_pages WHERE user_id=$1",
            [userId],
          )
        ).rows.map((r) => r.data);
      },
      async importPage(page, questions) {
        return this.importPages([{ page, questions }]);
      },
      async importPages(entries) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const { page, questions } of entries) {
            await client.query(
              "INSERT INTO workspace_pages(id,user_id,data) VALUES($1,$2,$3)",
              [page.id, userId, JSON.stringify(page)],
            );
            for (const q of questions)
              await client.query(
                "INSERT INTO workspace_questions(id,user_id,category_id,data,created_at) VALUES($1,$2,$3,$4,$5)",
                [
                  q.id,
                  userId,
                  q.categoryId || null,
                  JSON.stringify(q),
                  q.createdAt,
                ],
              );
          }
          await client.query("COMMIT");
          return entries.flatMap((e) => e.questions);
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
    });
    return {
      mode: "postgres",
      forUser,
      getUser,
      createUser,
      async initialized() {
        return (
          (await pool.query("SELECT id FROM platform_users")).rows.length > 0
        );
      },
      async findUser(username) {
        return (
          (
            await pool.query(
              "SELECT data FROM platform_users WHERE username=$1",
              [username],
            )
          ).rows[0]?.data || null
        );
      },
      async listUsers() {
        return (
          await pool.query("SELECT data FROM platform_users ORDER BY username")
        ).rows.map((r) => r.data);
      },
      async updateUser(id, patch) {
        const result = await pool.query(
          "UPDATE platform_users SET data=data || $1::jsonb WHERE id=$2 RETURNING data",
          [JSON.stringify(patch), id],
        );
        if (!result.rows.length) throw issue(404, "用户不存在");
        return result.rows[0].data;
      },
      async touchActivity(id) {
        await pool.query(
          "UPDATE platform_users SET data=data || $1::jsonb WHERE id=$2 AND (data->>'lastActiveAt' IS NULL OR data->>'lastActiveAt'<$3)",
          [
            JSON.stringify({ lastActiveAt: new Date().toISOString() }),
            id,
            activityCutoff(),
          ],
        );
      },
      async addSession(s) {
        await pool.query("DELETE FROM platform_sessions WHERE expires_at<$1", [
          Date.now(),
        ]);
        await pool.query(
          "INSERT INTO platform_sessions(id,user_id,expires_at) VALUES($1,$2,$3)",
          [s.id, s.userId, s.expiresAt],
        );
      },
      async getSession(id) {
        const r = (
          await pool.query(
            "SELECT * FROM platform_sessions WHERE id=$1 AND expires_at>$2",
            [id, Date.now()],
          )
        ).rows[0];
        return r
          ? { id: r.id, userId: r.user_id, expiresAt: Number(r.expires_at) }
          : null;
      },
      async deleteSession(id) {
        await pool.query("DELETE FROM platform_sessions WHERE id=$1", [id]);
      },
      async revokeSessions(userId) {
        await pool.query("DELETE FROM platform_sessions WHERE user_id=$1", [
          userId,
        ]);
      },
      async getSettings() {
        return (
          (await pool.query("SELECT data FROM platform_settings WHERE id='ai'"))
            .rows[0]?.data || null
        );
      },
      async saveSettings(data) {
        await pool.query(
          "INSERT INTO platform_settings(id,data) VALUES('ai',$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data",
          [JSON.stringify(data)],
        );
      },
      async questionCounts() {
        return (
          await pool.query(
            "SELECT user_id,COUNT(*)::int AS count FROM workspace_questions GROUP BY user_id",
          )
        ).rows;
      },
      async memberStats(day) {
        const [questions, pages, usage] = await Promise.all([
          pool.query(
            "SELECT user_id,COUNT(*)::int AS count,SUM(CASE WHEN data->>'status'='mastered' THEN 1 ELSE 0 END)::int AS mastered,SUM(COALESCE((data->>'reviews')::int,0))::int AS reviews FROM workspace_questions GROUP BY user_id",
          ),
          pool.query(
            "SELECT user_id,COUNT(*)::int AS count FROM workspace_pages GROUP BY user_id",
          ),
          pool.query("SELECT user_id,count FROM ai_usage WHERE day=$1", [day]),
        ]);
        const rows = new Map();
        const row = (id) => {
          if (!rows.has(id))
            rows.set(id, {
              userId: id,
              questionCount: 0,
              masteredCount: 0,
              reviewCount: 0,
              pageCount: 0,
              aiToday: 0,
            });
          return rows.get(id);
        };
        for (const q of questions.rows)
          Object.assign(row(q.user_id), {
            questionCount: Number(q.count),
            masteredCount: Number(q.mastered),
            reviewCount: Number(q.reviews),
          });
        for (const p of pages.rows) row(p.user_id).pageCount = Number(p.count);
        for (const u of usage.rows) row(u.user_id).aiToday = Number(u.count);
        return [...rows.values()];
      },
      async consumeAI(userId, limit) {
        const day = new Date().toISOString().slice(0, 10);
        await pool.query(
          "INSERT INTO ai_usage(user_id,day,count) VALUES($1,$2,0) ON CONFLICT DO NOTHING",
          [userId, day],
        );
        const result = await pool.query(
          "UPDATE ai_usage SET count=count+1 WHERE user_id=$1 AND day=$2 AND count<$3 RETURNING count",
          [userId, day, limit],
        );
        if (!result.rows.length)
          throw issue(429, "今天的 AI 请求次数已用完，明天再来看看");
        return result.rows[0].count;
      },
      async close() {
        await pool.end();
      },
    };
  }
  let data;
  try {
    data = JSON.parse(await fs.readFile(dataFile, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    data = demoData();
  }
  data = {
    ...data,
    users: data.users || [],
    sessions: data.sessions || [],
    spaces: data.spaces || {},
    settings: data.settings || null,
    usage: data.usage || {},
  };
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  let queue = Promise.resolve();
  const mutate = (fn) => {
    const job = queue.then(async () => {
      const next = structuredClone(data);
      const result = fn(next);
      await fs.writeFile(dataFile + ".tmp", JSON.stringify(next));
      await fs.rename(dataFile + ".tmp", dataFile);
      data = next;
      return structuredClone(result);
    });
    queue = job.catch(() => {});
    return job;
  };
  const read = (fn) => structuredClone(fn(data));
  const space = (d, id) => {
    if (!d.spaces[id]) throw issue(404, "学习空间不存在");
    return d.spaces[id];
  };
  const forUser = (id) => ({
    mode: "demo",
    async listCategories() {
      return read((d) => space(d, id).categories);
    },
    async addCategory(name, color) {
      return mutate((d) => {
        const s = space(d, id);
        if (s.categories.some((c) => c.name === name))
          throw Object.assign(new Error("分类已存在"), { code: "23505" });
        const c = { id: randomUUID(), name, color };
        s.categories.push(c);
        return c;
      });
    },
    async list() {
      return read((d) => space(d, id).items).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    },
    async get(qid) {
      return read((d) => space(d, id).items.find((q) => q.id === qid) || null);
    },
    async save(q) {
      return mutate((d) => {
        const s = space(d, id);
        if (
          Object.entries(d.spaces).some(
            ([owner, v]) => owner !== id && v.items.some((x) => x.id === q.id),
          )
        )
          throw issue(404, "这道题不存在");
        const i = s.items.findIndex((x) => x.id === q.id);
        if (i >= 0) s.items[i] = q;
        else s.items.unshift(q);
        return q;
      });
    },
    async remove(qid) {
      return mutate((d) => {
        const s = space(d, id);
        const before = s.items.length;
        s.items = s.items.filter((q) => q.id !== qid);
        return before !== s.items.length;
      });
    },
    async getPage(pid) {
      return read((d) => space(d, id).pages.find((p) => p.id === pid) || null);
    },
    async listPages() {
      return read((d) => space(d, id).pages);
    },
    async importPage(page, questions) {
      return this.importPages([{ page, questions }]);
    },
    async importPages(entries) {
      return mutate((d) => {
        const s = space(d, id);
        for (const { page, questions } of entries) {
          s.pages.push(page);
          s.items.unshift(...questions);
        }
        return entries.flatMap((e) => e.questions);
      });
    },
  });
  return {
    mode: "demo",
    forUser,
    async initialized() {
      return data.users.length > 0;
    },
    async getUser(id) {
      return read((d) => d.users.find((u) => u.id === id) || null);
    },
    async findUser(username) {
      return read((d) => d.users.find((u) => u.username === username) || null);
    },
    async listUsers() {
      return read((d) => d.users);
    },
    async createUser(user, bootstrap = false) {
      return mutate((d) => {
        if (bootstrap && d.users.length)
          throw issue(409, "管理员已经建立，请直接登录");
        if (d.users.some((u) => u.username === user.username))
          throw Object.assign(new Error("用户名已存在"), { code: "23505" });
        d.users.push(user);
        d.spaces[user.id] = {
          categories: bootstrap ? d.categories || defaults() : defaults(),
          items: bootstrap ? d.items || [] : [],
          pages: [],
        };
        return user;
      });
    },
    async updateUser(id, patch) {
      return mutate((d) => {
        const user = d.users.find((u) => u.id === id);
        if (!user) throw issue(404, "用户不存在");
        Object.assign(user, patch);
        return user;
      });
    },
    async touchActivity(id) {
      const cutoff = activityCutoff();
      if (data.users.find((u) => u.id === id)?.lastActiveAt >= cutoff) return;
      await mutate((d) => {
        const user = d.users.find((u) => u.id === id);
        if (user && (!user.lastActiveAt || user.lastActiveAt < cutoff))
          user.lastActiveAt = new Date().toISOString();
      });
    },
    async addSession(s) {
      return mutate((d) => {
        d.sessions = d.sessions.filter((x) => x.expiresAt > Date.now());
        d.sessions.push(s);
      });
    },
    async getSession(id) {
      return read(
        (d) =>
          d.sessions.find((s) => s.id === id && s.expiresAt > Date.now()) ||
          null,
      );
    },
    async deleteSession(id) {
      return mutate((d) => {
        d.sessions = d.sessions.filter((s) => s.id !== id);
      });
    },
    async revokeSessions(userId) {
      return mutate((d) => {
        d.sessions = d.sessions.filter((s) => s.userId !== userId);
      });
    },
    async getSettings() {
      return read((d) => d.settings);
    },
    async saveSettings(settings) {
      return mutate((d) => {
        d.settings = settings;
      });
    },
    async questionCounts() {
      return read((d) =>
        Object.entries(d.spaces).map(([user_id, s]) => ({
          user_id,
          count: s.items.length,
        })),
      );
    },
    async memberStats(day) {
      return read((d) =>
        d.users.map((u) => {
          const s = d.spaces[u.id];
          const items = s?.items || [];
          return {
            userId: u.id,
            questionCount: items.length,
            masteredCount: items.filter((q) => q.status === "mastered").length,
            reviewCount: items.reduce((n, q) => n + (q.reviews || 0), 0),
            pageCount: s?.pages?.length || 0,
            aiToday: d.usage[u.id]?.day === day ? d.usage[u.id].count : 0,
          };
        }),
      );
    },
    async consumeAI(userId, limit) {
      return mutate((d) => {
        const day = new Date().toISOString().slice(0, 10);
        const current =
          d.usage[userId]?.day === day ? d.usage[userId].count : 0;
        if (current >= limit)
          throw issue(429, "今天的 AI 请求次数已用完，明天再来看看");
        d.usage[userId] = { day, count: current + 1 };
        return current + 1;
      });
    },
    async close() {
      await queue;
    },
  };
}
