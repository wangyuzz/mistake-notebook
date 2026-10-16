import {
  promptDefaults,
  recognitionOutputRules,
  renderPrompt,
} from "./prompts.mjs";
import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  hashPassword,
  checkPassword,
  hashToken,
  cookies,
  cookieOptions,
  issueSession,
  publicUser,
  encryptionKey,
} from "./auth.mjs";
import {
  boxSchema,
  aiSettingsSchema,
  effectiveSettings,
  safeSettings,
  sealedSettings,
  completeAI,
  streamAI,
  imageUrl,
  parseRecognition,
  fail,
} from "./ai.mjs";
export const image = z
  .string()
  .refine(
    (v) =>
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ||
      /^\/samples\/(question|notes|categories)\.png$/.test(v),
    "仅支持 PNG、JPEG、WebP 图片",
  );
export const fields = z.object({
  title: z.string().trim().max(120).default(""),
  categoryId: z.string().max(80).default(""),
  text: z.string().max(30000).default(""),
  options: z.string().max(12000).default(""),
  explanation: z.string().max(40000).default(""),
  questionImages: z.array(image).max(4).default([]),
  explanationImages: z.array(image).max(4).default([]),
  answer: z.string().max(300).default(""),
  myAnswer: z.string().max(300).default(""),
  notes: z.string().max(20000).default(""),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  status: z.enum(["pending", "reviewing", "mastered"]).default("pending"),
  favorite: z.boolean().default(false),
  reviews: z.number().int().min(0).max(100000).default(0),
  sourcePageId: z.string().uuid().optional(),
  sourceBounds: boxSchema.optional(),
  sourceRotation: z.number().int().min(0).max(270).multipleOf(90).optional(),
});

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.-]{2,39}$/, "用户名需为 3–40 位字母、数字或 . _ -");
const password = z.string().min(10, "密码至少 10 位").max(128);
const account = z.object({
  username,
  password,
  displayName: z.string().trim().min(1).max(30),
});
const validId = z.string().uuid();
export function createApp(store, options = {}) {
  const app = express();
  const keyPromise = options.encryptionKey
    ? Promise.resolve(options.encryptionKey)
    : encryptionKey();
  const dummyHash = hashPassword(randomUUID());
  const rate = new Map();
  const take = (key, maximum) => {
    const now = Date.now();
    for (const [k, v] of rate) if (now - v.start >= 60000) rate.delete(k);
    const value = rate.get(key) || { start: now, count: 0 };
    if (value.count >= maximum) throw fail(429, "请求较频繁，请稍后再试");
    value.count++;
    rate.set(key, value);
  };
  const settings = async () =>
    effectiveSettings(store, await keyPromise, options);
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return next(fail(403, "请求来源无效"));
    if (!["GET", "HEAD"].includes(req.method) && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host)
          return next(fail(403, "请求来源无效"));
      } catch {
        return next(fail(403, "请求来源无效"));
      }
    }
    next();
  });
  app.use(express.json({ limit: "60mb" }));
  app.get("/api/health", async (_req, res) => {
    await store.initialized();
    res.json({ status: "ok" });
  });
  app.get("/api/auth/status", async (_req, res) =>
    res.json({
      initialized: await store.initialized(),
      setupTokenRequired: !!process.env.SETUP_TOKEN,
    }),
  );
  app.post("/api/auth/setup", async (req, res) => {
    take("setup:" + req.ip, 6);
    if (await store.initialized())
      throw fail(409, "管理员已经建立，请直接登录");
    if (
      process.env.SETUP_TOKEN &&
      req.body.setupToken !== process.env.SETUP_TOKEN
    )
      throw fail(403, "初始化口令不正确");
    const data = account.parse(req.body);
    const user = {
      ...data,
      id: randomUUID(),
      passwordHash: await hashPassword(data.password),
      role: "admin",
      active: true,
      createdAt: new Date().toISOString(),
    };
    delete user.password;
    await store.createUser(user, true);
    await issueSession(store, user, res);
    res.status(201).json(publicUser(user));
  });
  app.post("/api/auth/login", async (req, res) => {
    take("login:" + req.ip, 10);
    const input = z
      .object({ username, password: z.string().max(128) })
      .parse(req.body);
    const user = await store.findUser(input.username);
    const valid = await checkPassword(
      input.password,
      user?.passwordHash || (await dummyHash),
    );
    if (!user || !valid || !user.active)
      throw fail(401, "用户名或密码不正确，或账号已停用");
    await issueSession(store, user, res);
    res.json(publicUser(user));
  });
  app.post("/api/auth/register", async (req, res) => {
    take("register:" + req.ip, 6);
    if (!(await store.initialized()))
      throw fail(403, "请先由部署者创建首位管理员");
    const data = account.parse(req.body);
    const user = {
      id: randomUUID(),
      username: data.username,
      displayName: data.displayName,
      passwordHash: await hashPassword(data.password),
      role: "member",
      active: true,
      registrationSource: "self",
      createdAt: new Date().toISOString(),
    };
    await store.createUser(user);
    await issueSession(store, user, res);
    res.status(201).json(publicUser(user));
  });
  app.use("/api", async (req, res, next) => {
    const token = cookies(req).shiti_session;
    const session = token ? await store.getSession(hashToken(token)) : null;
    const user = session ? await store.getUser(session.userId) : null;
    if (!user || !user.active) throw fail(401, "请登录你的学习空间");
    req.user = user;
    req.sessionId = session.id;
    req.space = store.forUser(user.id);
    await store.touchActivity(user.id);
    next();
  });
  app.get("/api/auth/me", (req, res) => res.json(publicUser(req.user)));
  app.post("/api/auth/logout", async (req, res) => {
    await store.deleteSession(req.sessionId);
    res.clearCookie("shiti_session", { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  });
  app.post("/api/auth/password", async (req, res) => {
    const input = z
      .object({ currentPassword: z.string().max(128), newPassword: password })
      .parse(req.body);
    take("password:" + req.user.id, 6);
    if (!(await checkPassword(input.currentPassword, req.user.passwordHash)))
      throw fail(400, "当前密码不正确");
    await store.updateUser(req.user.id, {
      passwordHash: await hashPassword(input.newPassword),
    });
    await store.revokeSessions(req.user.id);
    await issueSession(store, req.user, res);
    res.json({ ok: true });
  });
  app.get("/api/config", async (req, res) => {
    const s = await settings();
    res.json({
      mode: store.mode,
      aiConfigured: !!(s.enabled && s.apiKey && s.model),
      aiModel: s.model,
      autoRecognize: s.autoRecognize,
      recognitionConfigured: !!(
        s.enabled &&
        s.apiKey &&
        (s.recognitionModel || s.model)
      ),
      user: publicUser(req.user),
    });
  });
  const admin = (req, _res, next) => {
    if (req.user.role !== "admin")
      throw fail(403, "只有管理员可以访问管理功能");
    next();
  };
  // Protect this entire namespace, including new endpoints and unknown methods.
  app.use("/api/admin", admin);
  app.get("/api/admin/users", async (_req, res) => {
    const counts = await store.questionCounts();
    res.json(
      (await store.listUsers()).map((u) => ({
        ...publicUser(u),
        questionCount: Number(
          counts.find((c) => c.user_id === u.id)?.count || 0,
        ),
      })),
    );
  });
  app.get("/api/admin/usage", async (_req, res) => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const localDay = (date) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(
        new Date(date),
      );
    const today = localDay(now);
    const weekStart = Date.parse(today + "T00:00:00+08:00") - 6 * 86400000;
    const [accounts, statistics] = await Promise.all([
      store.listUsers(),
      store.memberStats(day),
    ]);
    const byUser = new Map(statistics.map((s) => [s.userId, s]));
    const users = accounts
      .map((u) => ({
        ...publicUser(u),
        lastLoginAt: u.lastLoginAt || null,
        lastActiveAt: u.lastActiveAt || null,
        registrationSource: u.registrationSource || "admin",
        questionCount: 0,
        masteredCount: 0,
        reviewCount: 0,
        pageCount: 0,
        aiToday: 0,
        ...byUser.get(u.id),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({
      updatedAt: now.toISOString(),
      summary: {
        totalUsers: users.length,
        disabledUsers: users.filter((u) => !u.active).length,
        newToday: users.filter((u) => localDay(u.createdAt) === today).length,
        activeToday: users.filter(
          (u) => u.lastActiveAt && localDay(u.lastActiveAt) === today,
        ).length,
        activeWeek: users.filter(
          (u) => u.lastActiveAt && Date.parse(u.lastActiveAt) >= weekStart,
        ).length,
        questionCount: users.reduce((n, u) => n + u.questionCount, 0),
        aiToday: users.reduce((n, u) => n + u.aiToday, 0),
      },
      users,
    });
  });
  app.post("/api/admin/users", async (req, res) => {
    const data = account
      .extend({ role: z.enum(["member", "admin"]).default("member") })
      .parse(req.body);
    const user = {
      ...data,
      id: randomUUID(),
      passwordHash: await hashPassword(data.password),
      active: true,
      createdAt: new Date().toISOString(),
    };
    delete user.password;
    res.status(201).json(publicUser(await store.createUser(user)));
  });
  app.patch("/api/admin/users/:id", async (req, res) => {
    const id = validId.parse(req.params.id);
    if (id === req.user.id) throw fail(400, "不能停用当前登录的管理员");
    const input = z.object({ active: z.boolean() }).parse(req.body);
    const user = await store.updateUser(id, input);
    if (!input.active) await store.revokeSessions(id);
    res.json(publicUser(user));
  });
  app.get("/api/admin/prompts/defaults", (_req, res) =>
    res.json(promptDefaults),
  );
  app.get("/api/admin/settings", async (_req, res) =>
    res.json(safeSettings(await settings())),
  );
  app.put("/api/admin/settings", async (req, res) => {
    const input = aiSettingsSchema.parse(req.body);
    await store.saveSettings(
      sealedSettings(input, await settings(), await keyPromise),
    );
    res.json(safeSettings(await settings()));
  });
  app.post("/api/admin/settings/test", async (req, res) => {
    const s = await settings();
    take("ai:" + req.user.id, s.perMinuteLimit);
    const result = await completeAI(
      s,
      [{ role: "user", content: "请只回复 OK。" }],
      res,
    );
    res.json({ ok: true, message: result.slice(0, 200) });
  });
  app.get("/api/categories", async (req, res) =>
    res.json(await req.space.listCategories()),
  );
  app.post("/api/categories", async (req, res) => {
    const c = z
      .object({
        name: z.string().trim().min(1).max(24),
        color: z.enum(["sage", "blue", "peach", "lavender"]).default("sage"),
      })
      .parse(req.body);
    res.status(201).json(await req.space.addCategory(c.name, c.color));
  });
  app.get("/api/questions", async (req, res) =>
    res.json(await req.space.list()),
  );
  const validate = async (space, data) => {
    if (
      data.categoryId &&
      !(await space.listCategories()).some((c) => c.id === data.categoryId)
    )
      throw fail(400, "请选择自己空间内的有效分类");
    if (data.sourcePageId && !(await space.getPage(data.sourcePageId)))
      throw fail(400, "来源整页不存在");
  };
  const makeQuestion = (data) => {
    if (!data.text.trim() && !data.questionImages.length)
      throw fail(400, "请填写题目或上传题目图片");
    const now = new Date().toISOString();
    return {
      ...data,
      title: data.title || data.text.trim().slice(0, 30) || "图片错题",
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
  };
  app.post("/api/questions", async (req, res) => {
    const data = fields.parse(req.body);
    await validate(req.space, data);
    res.status(201).json(await req.space.save(makeQuestion(data)));
  });
  app.patch("/api/questions/:id", async (req, res) => {
    const id = validId.parse(req.params.id);
    const old = await req.space.get(id);
    if (!old) throw fail(404, "这道题不存在或已删除");
    const data = fields.partial().parse(req.body);
    await validate(req.space, data);
    const item = { ...old, ...data, updatedAt: new Date().toISOString() };
    if (!item.text.trim() && !item.questionImages.length)
      throw fail(400, "请保留题目文字或图片");
    res.json(await req.space.save(item));
  });
  app.delete("/api/questions/:id", async (req, res) => {
    if (!(await req.space.remove(validId.parse(req.params.id))))
      throw fail(404, "这道题不存在或已删除");
    res.json({ ok: true });
  });
  app.get("/api/pages/:id", async (req, res) => {
    const page = await req.space.getPage(validId.parse(req.params.id));
    if (!page) throw fail(404, "来源整页不存在");
    res.json(page);
  });
  app.get("/api/export", async (req, res) =>
    res.json({
      version: 2,
      exportedAt: new Date().toISOString(),
      categories: await req.space.listCategories(),
      questions: await req.space.list(),
      pages: await req.space.listPages(),
    }),
  );
  const pageImportSchema = z.object({
    source: z.object({
      image: image.refine((v) => v.length <= 28 * 1024 * 1024, "原图过大"),
      filename: z.string().max(200),
      width: z.number().int().positive().max(30000),
      height: z.number().int().positive().max(30000),
      rotation: z.number().int().min(0).max(270).multipleOf(90),
    }),
    questions: z
      .array(fields.extend({ sourceBounds: boxSchema }))
      .min(1)
      .max(10),
  });
  const preparePage = async (space, input) => {
    const page = {
      ...input.source,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const questions = [];
    for (const d of input.questions) {
      const { sourcePageId, ...clean } = d;
      await validate(space, clean);
      questions.push(
        makeQuestion({
          ...clean,
          sourcePageId: page.id,
          sourceRotation: page.rotation,
        }),
      );
    }
    return { page, questions };
  };
  app.post("/api/import", async (req, res) => {
    const input = pageImportSchema.parse(req.body);
    const entry = await preparePage(req.space, input);
    res.status(201).json({
      questions: await req.space.importPage(entry.page, entry.questions),
      pageId: entry.page.id,
    });
  });
  app.post("/api/import-batch", async (req, res) => {
    const input = z
      .object({ pages: z.array(pageImportSchema).min(1).max(20) })
      .parse(req.body);
    const entries = [];
    for (const page of input.pages)
      entries.push(await preparePage(req.space, page));
    res.status(201).json({
      questions: await req.space.importPages(entries),
      pageIds: entries.map((e) => e.page.id),
    });
  });
  const aiAccess = async (req, recognition = false) => {
    const s = await settings();
    if (
      !s.enabled ||
      !s.apiKey ||
      !(recognition ? s.recognitionModel || s.model : s.model)
    )
      throw fail(
        503,
        "AI 尚未接入，请联系管理员配置服务。可以继续手动框题或录入。",
        "AI_CONFIGURATION",
      );
    take("ai:" + req.user.id, s.perMinuteLimit);
    await store.consumeAI(req.user.id, s.dailyLimit);
    return s;
  };
  app.post("/api/recognize", async (req, res) => {
    const input = z
      .object({
        image,
        width: z.number().positive(),
        height: z.number().positive(),
      })
      .parse(req.body);
    const s = await aiAccess(req, true);
    const categories = (await req.space.listCategories())
      .map((c) => c.name)
      .join("、");
    const raw = await completeAI(
      s,
      [
        {
          role: "system",
          content: s.recognitionSystemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                renderPrompt(s.recognitionUserPrompt, {
                  width: input.width,
                  height: input.height,
                  categories,
                }) +
                "\n\n" +
                recognitionOutputRules,
            },
            {
              type: "image_url",
              image_url: { url: await imageUrl(input.image), detail: "high" },
            },
          ],
        },
      ],
      res,
      s.recognitionModel || s.model,
      s.recognitionReasoningEffort === "inherit"
        ? s.reasoningEffort
        : s.recognitionReasoningEffort,
    );
    res.json({
      questions: parseRecognition(raw),
      model: s.recognitionModel || s.model,
    });
  });
  app.post("/api/recognize-explanation", async (req, res) => {
    const input = z
      .object({ images: z.array(image).min(1).max(4) })
      .parse(req.body);
    const s = await aiAccess(req, true);
    const content = [
      { type: "text", text: s.explanationRecognitionUserPrompt },
    ];
    for (const src of input.images)
      content.push({
        type: "image_url",
        image_url: { url: await imageUrl(src), detail: "high" },
      });
    const text = await completeAI(
      s,
      [
        { role: "system", content: s.explanationRecognitionSystemPrompt },
        { role: "user", content },
      ],
      res,
      s.recognitionModel || s.model,
      s.recognitionReasoningEffort === "inherit"
        ? s.reasoningEffort
        : s.recognitionReasoningEffort,
    );
    if (text.length > 40000)
      throw fail(422, "解析文字过长，请分张识别或手动整理");
    res.json({ text, model: s.recognitionModel || s.model });
  });
  app.post("/api/ai", async (req, res) => {
    const input = z
      .object({
        action: z.enum(["analyze", "chat"]),
        stream: z.boolean().default(false),
        questionId: validId.optional(),
        draft: fields.optional(),
        message: z.string().trim().max(12000).default(""),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().max(16000),
            }),
          )
          .max(12)
          .default([]),
      })
      .parse(req.body);
    const q = input.questionId
      ? await req.space.get(input.questionId)
      : input.draft;
    if (input.questionId && !q) throw fail(404, "这道题不存在或已删除");
    if (!q && input.action === "analyze") throw fail(400, "请先录入题目");
    if (!input.message && input.action === "chat")
      throw fail(400, "请输入问题");
    const s = await aiAccess(req);
    const content = [
      {
        type: "text",
        text: renderPrompt(s.contextPrompt, {
          question: JSON.stringify(
            q
              ? {
                  title: q.title,
                  text: q.text,
                  options: q.options || "",
                  referenceExplanation: q.explanation,
                  answer: q.answer,
                  myAnswer: q.myAnswer,
                  notes: q.notes,
                }
              : "未选择题目",
          ),
        }),
      },
    ];
    if (q)
      for (const [images, label] of [
        [q.questionImages, "题目图片"],
        [q.explanationImages, "参考解析图片"],
      ])
        for (const src of images || [])
          content.push(
            { type: "text", text: label },
            {
              type: "image_url",
              image_url: { url: await imageUrl(src), detail: "high" },
            },
          );
    content.push({
      type: "text",
      text: input.action === "analyze" ? s.analysisPrompt : input.message,
    });
    const conversation = [
      {
        role: "system",
        content: s.tutorSystemPrompt,
      },
      ...input.history,
      { role: "user", content },
    ];
    if (input.stream) {
      await streamAI(s, conversation, res);
      return;
    }
    const result = await completeAI(s, conversation, res);
    res.json({ content: result, model: s.model });
  });
  app.use("/samples", express.static(path.resolve("public/samples")));
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (req, res, next) => {
    if (req.path.startsWith("/api/"))
      return res.status(404).json({ error: "接口不存在" });
    res.sendFile(path.resolve("dist/index.html"), (e) => {
      if (e) next(e);
    });
  });
  app.use((e, _req, res, _next) => {
    if (e instanceof z.ZodError)
      return res.status(400).json({
        error: e.issues
          .map((i) => i.path.join(".") + "：" + i.message)
          .join("；"),
      });
    if (e.code === "23505")
      return res.status(409).json({ error: "用户名或分类名称已存在" });
    if (e.type === "entity.too.large")
      return res
        .status(413)
        .json({ error: "图片总量过大，请减少选中题目后重试" });
    if (e.type === "entity.parse.failed")
      return res.status(400).json({ error: "请求格式无效" });
    if (!e.status) console.error(e);
    if (!res.destroyed)
      res
        .status(e.status || 500)
        .json({
          error: e.status ? e.message : "保存或读取失败，请重试",
          code: e.errorCode,
        });
  });
  return app;
}
