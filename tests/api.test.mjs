import { importNotebook } from "../server/import.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { createPlatformStore } from "../server/platform-store.mjs";
import { createStore, demoData } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import {
  hashPassword,
  checkPassword,
  encrypt,
  decrypt,
} from "../server/auth.mjs";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZxkAAAAASUVORK5CYII=";
const sample = {
  text: "完整题目和选项",
  title: "图形题",
  categoryId: "category-3",
  questionImages: [png],
  explanationImages: [png],
  explanation: "参考解释",
};
const source = {
  image: png,
  filename: "整页.png",
  width: 100,
  height: 100,
  rotation: 0,
};
const bbox = { x: 0, y: 0, width: 1, height: 1 };
const listen = (s) =>
  new Promise((resolve) =>
    s.listen(0, "127.0.0.1", () =>
      resolve("http://127.0.0.1:" + s.address().port),
    ),
  );
const close = (s) => new Promise((resolve) => s.close(resolve));
async function req(base, url, method = "GET", body, cookie) {
  const res = await fetch(base + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: await res.json(),
    cookie: res.headers.get("set-cookie")?.split(";")[0],
  };
}
async function fixture(t, backend = "demo", extra = {}) {
  let store, file;
  if (backend === "postgres") {
    const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
    store = await createPlatformStore({ pool: new Pool() });
  } else {
    await fs.mkdir(path.resolve("test-results"), { recursive: true });
    file = path.resolve("test-results/api-" + randomUUID() + ".json");
    store = await createPlatformStore({ dataFile: file });
  }
  const server = http.createServer(
    createApp(store, {
      encryptionKey: randomBytes(32),
      aiKey: "",
      aiModel: "",
      ...extra,
    }),
  );
  const base = await listen(server);
  t.after(async () => {
    await close(server);
    await store.close();
    if (file) await fs.unlink(file).catch(() => {});
  });
  return { base, store };
}
async function setup(base) {
  const result = await req(base, "/api/auth/setup", "POST", {
    username: "admin",
    displayName: "管理员",
    password: "Admin-test-123",
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result;
}
async function member(
  base,
  adminCookie,
  username = "learner",
  role = "member",
) {
  const added = await req(
    base,
    "/api/admin/users",
    "POST",
    { username, displayName: "学习者", password: "Learner-12345", role },
    adminCookie,
  );
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const login = await req(base, "/api/auth/login", "POST", {
    username,
    password: "Learner-12345",
  });
  assert.equal(login.status, 200);
  return { ...login, user: added.body };
}

test("passwords use salted scrypt and AI secrets use authenticated encryption", async () => {
  const hash = await hashPassword("Password-12345");
  assert.ok(!hash.includes("Password"));
  assert.equal(await checkPassword("Password-12345", hash), true);
  assert.equal(await checkPassword("Wrong-password", hash), false);
  const key = randomBytes(32);
  const encrypted = encrypt("secret-api-key", key);
  assert.notEqual(encrypted, "secret-api-key");
  assert.equal(decrypt(encrypted, key), "secret-api-key");
  assert.throws(() => decrypt(encrypted, randomBytes(32)));
});
for (const backend of ["demo", "postgres"]) {
  test(
    backend + ": auth, ownership, roles and account revocation",
    async (t) => {
      const { base } = await fixture(t, backend);
      assert.equal(
        (await req(base, "/api/auth/status")).body.initialized,
        false,
      );
      assert.equal((await req(base, "/api/questions")).status, 401);
      const admin = await setup(base);
      assert.ok(!JSON.stringify(admin.body).includes("passwordHash"));
      assert.equal(
        (
          await req(base, "/api/auth/setup", "POST", {
            username: "other",
            displayName: "其他",
            password: "Another-12345",
          })
        ).status,
        409,
      );
      const a = await member(base, admin.cookie, "learner-a");
      const b = await member(base, admin.cookie, "learner-b", "admin");
      assert.deepEqual(
        (await req(base, "/api/questions", "GET", undefined, a.cookie)).body,
        [],
      );
      const q = await req(base, "/api/questions", "POST", sample, a.cookie);
      assert.equal(q.status, 201, JSON.stringify(q.body));
      for (const user of [admin, b]) {
        assert.equal(
          (
            await req(
              base,
              "/api/questions/" + q.body.id,
              "PATCH",
              { notes: "越权" },
              user.cookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await req(
              base,
              "/api/questions/" + q.body.id,
              "DELETE",
              undefined,
              user.cookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await req(
              base,
              "/api/ai",
              "POST",
              { action: "analyze", questionId: q.body.id },
              user.cookie,
            )
          ).status,
          404,
        );
        assert.ok(
          !(
            await req(base, "/api/questions", "GET", undefined, user.cookie)
          ).body.some((x) => x.id === q.body.id),
        );
      }
      assert.equal(
        (await req(base, "/api/admin/settings", "GET", undefined, a.cookie))
          .status,
        403,
      );
      assert.equal(
        (await req(base, "/api/admin/users", "GET", undefined, a.cookie))
          .status,
        403,
      );
      assert.equal(
        (await req(base, "/api/admin/settings", "PUT", {}, a.cookie)).status,
        403,
      );
      const category = await req(
        base,
        "/api/categories",
        "POST",
        { name: "只有我有", color: "blue" },
        a.cookie,
      );
      assert.equal(category.status, 201);
      assert.equal(
        (
          await req(
            base,
            "/api/questions",
            "POST",
            { ...sample, categoryId: category.body.id },
            b.cookie,
          )
        ).status,
        400,
      );
      const patch = await req(
        base,
        "/api/questions/" + q.body.id,
        "PATCH",
        { favorite: true, status: "mastered" },
        a.cookie,
      );
      assert.equal(patch.body.text, sample.text);
      assert.deepEqual(patch.body.explanationImages, [png]);
      assert.equal(patch.body.favorite, true);
      assert.equal(
        (
          await req(
            base,
            "/api/admin/users/" + a.user.id,
            "PATCH",
            { active: false },
            admin.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await req(base, "/api/config", "GET", undefined, a.cookie)).status,
        401,
      );
      assert.equal(
        (
          await req(base, "/api/auth/login", "POST", {
            username: "learner-a",
            password: "Learner-12345",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await req(
            base,
            "/api/admin/users/" + admin.body.id,
            "PATCH",
            { active: false },
            admin.cookie,
          )
        ).status,
        400,
      );
      await req(
        base,
        "/api/admin/users/" + a.user.id,
        "PATCH",
        { active: true },
        admin.cookie,
      );
      assert.equal(
        (await req(base, "/api/config", "GET", undefined, a.cookie)).status,
        401,
      );
      assert.equal(
        (
          await req(base, "/api/auth/login", "POST", {
            username: "learner-a",
            password: "Learner-12345",
          })
        ).status,
        200,
      );
    },
  );
  test(
    backend +
      ": batch import retains original page, validates all items and isolates sources",
    async (t) => {
      const { base } = await fixture(t, backend);
      const admin = await setup(base);
      const a = await member(base, admin.cookie);
      const initial = (
        await req(base, "/api/questions", "GET", undefined, a.cookie)
      ).body.length;
      const invalid = await req(
        base,
        "/api/import",
        "POST",
        {
          source,
          questions: [
            { ...sample, sourceBounds: bbox },
            { ...sample, categoryId: "outside", sourceBounds: bbox },
          ],
        },
        a.cookie,
      );
      assert.equal(invalid.status, 400);
      assert.equal(
        (await req(base, "/api/questions", "GET", undefined, a.cookie)).body
          .length,
        initial,
      );
      const imported = await req(
        base,
        "/api/import",
        "POST",
        {
          source,
          questions: [
            {
              ...sample,
              sourceBounds: { x: 0.02, y: 0.02, width: 0.96, height: 0.45 },
            },
            {
              ...sample,
              sourceBounds: { x: 0.02, y: 0.5, width: 0.96, height: 0.48 },
            },
          ],
        },
        a.cookie,
      );
      assert.equal(imported.status, 201, JSON.stringify(imported.body));
      assert.equal(imported.body.questions.length, 2);
      const pageId = imported.body.pageId;
      assert.equal(
        (await req(base, "/api/pages/" + pageId, "GET", undefined, a.cookie))
          .body.image,
        png,
      );
      assert.equal(
        (
          await req(
            base,
            "/api/pages/" + pageId,
            "GET",
            undefined,
            admin.cookie,
          )
        ).status,
        404,
      );
      const backup = (
        await req(base, "/api/export", "GET", undefined, a.cookie)
      ).body;
      assert.equal(backup.pages.length, 1);
      assert.equal(backup.questions.length, 2);
      assert.equal(backup.questions[0].sourcePageId, pageId);
      assert.deepEqual(backup.questions[0].questionImages, [png]);
      assert.equal(
        (
          await req(
            base,
            "/api/questions",
            "POST",
            { ...sample, sourcePageId: pageId },
            admin.cookie,
          )
        ).status,
        400,
      );
    },
  );
}

test("first admin adopts the existing local notebook and accounts survive restart", async () => {
  await fs.mkdir(path.resolve("test-results"), { recursive: true });
  const file = path.resolve("test-results/restart-" + randomUUID() + ".json");
  const legacy = demoData();
  await fs.writeFile(file, JSON.stringify(legacy));
  let store = await createPlatformStore({ dataFile: file });
  const user = {
    id: randomUUID(),
    username: "owner",
    displayName: "主人",
    role: "admin",
    active: true,
    passwordHash: await hashPassword("Owner-123456"),
    createdAt: new Date().toISOString(),
  };
  await store.createUser(user, true);
  assert.equal((await store.forUser(user.id).list()).length, 6);
  await store.addSession({
    id: "session-hash",
    userId: user.id,
    expiresAt: Date.now() + 100000,
  });
  await store.close();
  store = await createPlatformStore({ dataFile: file });
  assert.equal((await store.getUser(user.id)).username, "owner");
  assert.equal((await store.getSession("session-hash")).userId, user.id);
  assert.equal(
    (await store.forUser(user.id).list())[0].questionImages[0],
    "/samples/question.png",
  );
  await store.close();
  await fs.unlink(file);
});

test("PostgreSQL first admin adopts legacy single-user rows", async () => {
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  const pool = new Pool();
  const legacy = await createStore({ pool });
  const q = demoData().items[0];
  await legacy.save(q);
  const store = await createPlatformStore({ pool });
  const u = {
    id: randomUUID(),
    username: "owner",
    displayName: "主人",
    role: "admin",
    active: true,
    passwordHash: "hash",
    createdAt: new Date().toISOString(),
  };
  await store.createUser(u, true);
  assert.deepEqual(await store.forUser(u.id).get(q.id), q);
  await store.close();
});

test("admin saves encrypted live AI config, real request protocol, recognition validation and per-user quota", async (t) => {
  let received;
  let malformed = false;
  const upstream = http.createServer(async (request, response) => {
    let body = "";
    for await (const c of request) body += c;
    received = JSON.parse(body);
    assert.equal(request.headers.authorization, "Bearer test-secret-api-key");
    const recognition = received.messages[0].content.includes("试卷版面");
    const content = recognition
      ? malformed
        ? "broken-json"
        : JSON.stringify({
            questions: [
              {
                title: "图形题",
                text: "选择最合适的图形",
                categoryName: "图形推理",
                tags: ["位置规律"],
                bbox,
                warning: "",
              },
            ],
          })
      : "测试解析：参考答案 D";
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  const upstreamBase = await listen(upstream);
  t.after(() => close(upstream));
  const { base, store } = await fixture(t);
  const admin = await setup(base);
  const a = await member(base, admin.cookie);
  const config = {
    enabled: true,
    baseUrl: upstreamBase + "/v1",
    model: "test-vision",
    recognitionModel: "test-layout",
    autoRecognize: true,
    perMinuteLimit: 30,
    dailyLimit: 10,
    timeoutMs: 5000,
    apiKey: "test-secret-api-key",
    reasoningEffort: "medium",
    recognitionReasoningEffort: "high",
    recognitionSystemPrompt: "你是试卷版面识别助手。自定义系统规则。",
    recognitionUserPrompt:
      "照片 {{width}}x{{height}}，分类 {{categories}}；返回包含 questions 的JSON。",
    tutorSystemPrompt: "自定义辅导规则",
    contextPrompt: "题目上下文：{{question}}",
    analysisPrompt: "自定义解析任务",
  };
  const saved = await req(
    base,
    "/api/admin/settings",
    "PUT",
    config,
    admin.cookie,
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.body.configured, true);
  assert.ok(!JSON.stringify(saved.body).includes("test-secret-api-key"));
  assert.ok(
    !JSON.stringify(await store.getSettings()).includes("test-secret-api-key"),
  );
  const configView = (
    await req(base, "/api/config", "GET", undefined, a.cookie)
  ).body;
  assert.equal(configView.recognitionConfigured, true);
  assert.ok(!JSON.stringify(configView).includes("upstreamBase"));
  const recognition = await req(
    base,
    "/api/recognize",
    "POST",
    { image: png, width: 100, height: 100 },
    a.cookie,
  );
  assert.equal(recognition.status, 200, JSON.stringify(recognition.body));
  assert.equal(recognition.body.questions[0].categoryName, "图形推理");
  assert.equal(received.model, "test-layout");
  assert.equal(received.reasoning_effort, "high");
  assert.match(received.messages[0].content, /自定义系统规则/);
  assert.match(received.messages[1].content[0].text, /照片 100x100/);
  assert.ok(!received.messages[1].content[0].text.includes("{{categories}}"));
  assert.equal(received.messages[1].content.at(-1).type, "image_url");
  const q = await req(base, "/api/questions", "POST", sample, a.cookie);
  const analysis = await req(
    base,
    "/api/ai",
    "POST",
    { action: "analyze", questionId: q.body.id },
    a.cookie,
  );
  assert.equal(analysis.status, 200);
  assert.equal(received.model, "test-vision");
  assert.equal(received.reasoning_effort, "medium");
  assert.equal(received.messages[0].content, "自定义辅导规则");
  assert.equal(received.messages.at(-1).content.at(-1).text, "自定义解析任务");
  assert.equal(
    received.messages.at(-1).content.filter((c) => c.type === "image_url")
      .length,
    2,
  );
  assert.match(
    received.messages.at(-1).content[0].text,
    /referenceExplanation/,
  );
  malformed = true;
  assert.equal(
    (
      await req(
        base,
        "/api/recognize",
        "POST",
        { image: png, width: 100, height: 100 },
        a.cookie,
      )
    ).status,
    422,
  );
  await req(
    base,
    "/api/admin/settings",
    "PUT",
    { ...config, apiKey: undefined, dailyLimit: 3 },
    admin.cookie,
  );
  assert.equal(
    (
      await req(
        base,
        "/api/ai",
        "POST",
        { action: "chat", message: "再次提问" },
        a.cookie,
      )
    ).status,
    429,
  );
  await req(
    base,
    "/api/admin/settings",
    "PUT",
    { ...config, apiKey: undefined, enabled: false },
    admin.cookie,
  );
  assert.equal(
    (
      await req(
        base,
        "/api/ai",
        "POST",
        { action: "chat", message: "测试禁用" },
        a.cookie,
      )
    ).status,
    503,
  );
});

test("password update revokes other sessions and logout invalidates the current session", async (t) => {
  const { base } = await fixture(t);
  const admin = await setup(base);
  const other = await req(base, "/api/auth/login", "POST", {
    username: "admin",
    password: "Admin-test-123",
  });
  assert.equal(
    (
      await req(
        base,
        "/api/auth/password",
        "POST",
        { currentPassword: "wrong", newPassword: "New-password-123" },
        admin.cookie,
      )
    ).status,
    400,
  );
  const changed = await req(
    base,
    "/api/auth/password",
    "POST",
    { currentPassword: "Admin-test-123", newPassword: "New-password-123" },
    admin.cookie,
  );
  assert.equal(changed.status, 200);
  assert.equal(
    (await req(base, "/api/config", "GET", undefined, other.cookie)).status,
    401,
  );
  assert.equal(
    (
      await req(base, "/api/auth/login", "POST", {
        username: "admin",
        password: "Admin-test-123",
      })
    ).status,
    401,
  );
  assert.equal(
    (await req(base, "/api/config", "GET", undefined, changed.cookie)).status,
    200,
  );
  await req(base, "/api/auth/logout", "POST", undefined, changed.cookie);
  assert.equal(
    (await req(base, "/api/config", "GET", undefined, changed.cookie)).status,
    401,
  );
});

test("backup restore targets an explicit owner, preserves source pages and deduplicates", async () => {
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  const pool = new Pool();
  const store = await createPlatformStore({ pool });
  try {
    const a = { id: randomUUID(), username: "restore-a" },
      b = { id: randomUUID(), username: "restore-b" };
    await store.createUser(a);
    await store.createUser(b);
    const now = new Date().toISOString(),
      pid = randomUUID();
    const backup = {
      categories: [{ id: "old-category", name: "自建分类", color: "sage" }],
      pages: [{ ...source, id: pid, createdAt: now }],
      questions: [
        {
          ...sample,
          id: randomUUID(),
          categoryId: "old-category",
          createdAt: now,
          updatedAt: now,
          sourcePageId: pid,
          sourceBounds: bbox,
          sourceRotation: 0,
        },
      ],
    };
    await assert.rejects(importNotebook(pool, backup), /必须显式/);
    await assert.rejects(
      importNotebook(pool, backup, "absent"),
      /目标用户不存在/,
    );
    assert.deepEqual(await importNotebook(pool, backup, a.username), {
      imported: 1,
      skipped: 0,
    });
    assert.deepEqual(await importNotebook(pool, backup, a.username), {
      imported: 0,
      skipped: 1,
    });
    const qa = (await store.forUser(a.id).list())[0];
    assert.equal(
      (await store.forUser(a.id).getPage(qa.sourcePageId)).image,
      png,
    );
    await importNotebook(pool, backup, b.username);
    const qb = (await store.forUser(b.id).list())[0];
    assert.notEqual(qa.id, qb.id);
    assert.notEqual(qa.sourcePageId, qb.sourcePageId);
    assert.equal(await store.forUser(a.id).get(qb.id), null);
    await assert.rejects(
      importNotebook(pool, { ...backup, pages: [] }, a.username),
      /缺少来源整页/,
    );
    assert.equal((await store.forUser(a.id).list()).length, 1);
  } finally {
    await store.close();
  }
});

for (const backend of ["demo", "postgres"])
  test(
    backend +
      ": multi-page imports validate every page before saving and isolate sources",
    async (t) => {
      const { base } = await fixture(t, backend);
      const admin = await setup(base);
      const learner = await member(base, admin.cookie);
      const before = (
        await req(base, "/api/questions", "GET", undefined, learner.cookie)
      ).body.length;
      const first = { source, questions: [{ ...sample, sourceBounds: bbox }] };
      const bad = await req(
        base,
        "/api/import-batch",
        "POST",
        {
          pages: [
            first,
            {
              source,
              questions: [
                {
                  ...sample,
                  categoryId: "foreign-category",
                  sourceBounds: bbox,
                },
              ],
            },
          ],
        },
        learner.cookie,
      );
      assert.equal(bad.status, 400);
      assert.equal(
        (await req(base, "/api/questions", "GET", undefined, learner.cookie))
          .body.length,
        before,
      );
      assert.equal(
        (await req(base, "/api/export", "GET", undefined, learner.cookie)).body
          .pages.length,
        0,
      );
      const saved = await req(
        base,
        "/api/import-batch",
        "POST",
        {
          pages: [
            first,
            {
              source: { ...source, filename: "第二张.png" },
              questions: [
                { ...sample, title: "第二张题目", sourceBounds: bbox },
              ],
            },
          ],
        },
        learner.cookie,
      );
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      assert.equal(saved.body.questions.length, 2);
      assert.equal(new Set(saved.body.pageIds).size, 2);
      const exported = (
        await req(base, "/api/export", "GET", undefined, learner.cookie)
      ).body;
      assert.equal(exported.pages.length, 2);
      assert.ok(
        exported.questions.every((q) =>
          exported.pages.some((p) => p.id === q.sourcePageId),
        ),
      );
      assert.equal(
        (
          await req(
            base,
            "/api/pages/" + saved.body.pageIds[0],
            "GET",
            undefined,
            admin.cookie,
          )
        ).status,
        404,
      );
    },
  );

test("legacy AI settings gain prompt defaults; default effort is omitted and unsupported levels stay visible", async (t) => {
  let received,
    reject = false;
  const upstream = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    received = JSON.parse(raw);
    res.setHeader("Content-Type", "application/json");
    if (reject) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({ error: { message: "unsupported reasoning effort" } }),
      );
      return;
    }
    res.end(
      JSON.stringify({ choices: [{ message: { content: "测试解析" } }] }),
    );
  });
  const upstreamBase = await listen(upstream);
  t.after(() => close(upstream));
  const key = randomBytes(32);
  const { base, store } = await fixture(t, "demo", { encryptionKey: key });
  const admin = await setup(base);
  await store.saveSettings({
    enabled: true,
    baseUrl: upstreamBase + "/v1",
    model: "legacy-vision",
    recognitionModel: "",
    autoRecognize: true,
    perMinuteLimit: 30,
    dailyLimit: 20,
    timeoutMs: 5000,
    encryptedApiKey: encrypt("old-secret", key),
  });
  const settings = (
    await req(base, "/api/admin/settings", "GET", undefined, admin.cookie)
  ).body;
  assert.equal(settings.reasoningEffort, "default");
  assert.match(settings.recognitionUserPrompt, /{{width}}/);
  assert.match(settings.contextPrompt, /{{question}}/);
  assert.equal(
    (
      await req(
        base,
        "/api/ai",
        "POST",
        { action: "analyze", draft: sample },
        admin.cookie,
      )
    ).status,
    200,
  );
  assert.equal(Object.hasOwn(received, "reasoning_effort"), false);
  const updated = await req(
    base,
    "/api/admin/settings",
    "PUT",
    { ...settings, reasoningEffort: "high" },
    admin.cookie,
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.apiKeyConfigured, true);
  reject = true;
  const refused = await req(
    base,
    "/api/ai",
    "POST",
    { action: "analyze", draft: sample },
    admin.cookie,
  );
  assert.equal(refused.status, 502);
  assert.equal(received.reasoning_effort, "high");
  assert.match(refused.body.error, /思考等级/);
  assert.equal(
    (
      await req(
        base,
        "/api/admin/settings",
        "PUT",
        { ...settings, reasoningEffort: "invalid" },
        admin.cookie,
      )
    ).status,
    400,
  );
});
