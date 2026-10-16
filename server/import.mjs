import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { fields, image } from "./app.mjs";
import { createPlatformStore } from "./platform-store.mjs";
const pageSchema = z.object({
  id: z.string().uuid(),
  image,
  filename: z.string().max(200),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  rotation: z.number().int().min(0).max(270).multipleOf(90),
  createdAt: z.string().datetime(),
});
const backupSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().trim().min(1).max(24),
      color: z.enum(["sage", "blue", "peach", "lavender"]).default("sage"),
    }),
  ),
  questions: z.array(
    fields.extend({
      id: z.string().uuid(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    }),
  ),
  pages: z.array(pageSchema).default([]),
});
// Stable per-owner IDs make repeated imports safe, even for backups from another account.
function ownedId(owner, id) {
  const h = createHash("sha256")
    .update(owner + ":" + id)
    .digest("hex");
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-5" +
    h.slice(13, 16) +
    "-a" +
    h.slice(17, 20) +
    "-" +
    h.slice(20, 32)
  );
}
export async function importNotebook(pool, source, targetUsername) {
  if (!targetUsername) throw new Error("必须显式指定接收备份的目标用户名");
  const parsed = backupSchema.parse({
    ...source,
    questions: source.questions || source.items,
  });
  const categories = new Set(parsed.categories.map((c) => c.id)),
    pages = new Set(parsed.pages.map((p) => p.id));
  if (
    categories.size !== parsed.categories.length ||
    pages.size !== parsed.pages.length ||
    new Set(parsed.questions.map((q) => q.id)).size !== parsed.questions.length
  )
    throw new Error("备份中存在重复 ID");
  for (const q of parsed.questions) {
    if (!q.text.trim() && !q.questionImages.length)
      throw new Error("备份包含空白题目");
    if (q.categoryId && !categories.has(q.categoryId))
      throw new Error("备份中缺少题目分类");
    if (q.sourcePageId && !pages.has(q.sourcePageId))
      throw new Error("备份中缺少来源整页");
  }
  const store = await createPlatformStore({ pool });
  const user = await store.findUser(targetUsername.toLowerCase());
  if (!user) throw new Error("目标用户不存在，请先在网站中创建账号");
  const client = await pool.connect();
  let imported = 0,
    skipped = 0;
  try {
    await client.query("BEGIN");
    const existingCategories = (
      await client.query(
        "SELECT id,name,color FROM workspace_categories WHERE user_id=$1",
        [user.id],
      )
    ).rows;
    const existingQuestions = new Set(
      (
        await client.query(
          "SELECT id FROM workspace_questions WHERE user_id=$1",
          [user.id],
        )
      ).rows.map((q) => q.id),
    );
    const existingPages = new Set(
      (
        await client.query("SELECT id FROM workspace_pages WHERE user_id=$1", [
          user.id,
        ])
      ).rows.map((p) => p.id),
    );
    const cm = new Map(),
      pm = new Map();
    for (const c of parsed.categories) {
      let target = existingCategories.find((x) => x.name === c.name);
      if (!target) {
        target = { ...c, id: randomUUID() };
        await client.query(
          "INSERT INTO workspace_categories(user_id,id,name,color) VALUES($1,$2,$3,$4)",
          [user.id, target.id, target.name, target.color],
        );
        existingCategories.push(target);
      }
      cm.set(c.id, target.id);
    }
    for (const p of parsed.pages) {
      const id = existingPages.has(p.id) ? p.id : ownedId(user.id, p.id);
      pm.set(p.id, id);
      if (!existingPages.has(id)) {
        await client.query(
          "INSERT INTO workspace_pages(id,user_id,data) VALUES($1,$2,$3)",
          [id, user.id, JSON.stringify({ ...p, id })],
        );
        existingPages.add(id);
      }
    }
    for (const q of parsed.questions) {
      const id = existingQuestions.has(q.id) ? q.id : ownedId(user.id, q.id);
      if (existingQuestions.has(id)) {
        skipped++;
        continue;
      }
      const data = {
        ...q,
        id,
        categoryId: cm.get(q.categoryId) || "",
        ...(q.sourcePageId ? { sourcePageId: pm.get(q.sourcePageId) } : {}),
      };
      await client.query(
        "INSERT INTO workspace_questions(id,user_id,category_id,data,created_at) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          user.id,
          data.categoryId || null,
          JSON.stringify(data),
          data.createdAt,
        ],
      );
      existingQuestions.add(id);
      imported++;
    }
    await client.query("COMMIT");
    return { imported, skipped };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
