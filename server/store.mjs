import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
export const categoryNames = [
  "言语理解",
  "资料分析",
  "图形推理",
  "逻辑判断",
  "定义判断",
  "类比推理",
  "数量关系",
];
const categories = categoryNames.map((name, i) => ({
  id: "category-" + (i + 1),
  name,
  color: ["sage", "blue", "peach", "lavender", "sage", "peach", "blue"][i],
}));
export function demoData() {
  const make = (
    title,
    categoryId,
    text,
    explanation,
    tags,
    days,
    extra = {},
  ) => ({
    id: randomUUID(),
    title,
    categoryId,
    text,
    explanation,
    tags,
    questionImages: [],
    explanationImages: [],
    answer: "",
    myAnswer: "",
    notes: "",
    status: "pending",
    favorite: false,
    reviews: 0,
    createdAt: new Date(Date.now() - days * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  });
  return {
    categories: structuredClone(categories),
    items: [
      make(
        "数列求和：找出正确结果",
        "category-7",
        "虚构练习示例：计算 1 + 2 + 3 的结果。\n\nA. 3\nB. 4\nC. 5\nD. 6",
        "参考答案：D。\n\n先算 1 + 2 = 3，再算 3 + 3 = 6。\n\n复盘：按顺序计算，避免遗漏加数。本题及配图均为项目自制示例。",
        ["数列求和", "示例题目"],
        0,
        {
          answer: "D",
          myAnswer: "C",
          favorite: true,
          questionImages: ["/samples/question.png"],
          explanationImages: ["/samples/notes.png"],
        },
      ),
      make(
        "因果论证中的「另有他因」",
        "category-4",
        "某机构发现，每天喝咖啡的人工作效率更高，于是认为喝咖啡可以提高工作效率。以下哪项最能削弱这一结论？\n\nA. 咖啡有多种口味\nB. 喝咖啡的人通常也有更充足的睡眠\nC. 有些人不喜欢咖啡\nD. 工作效率很难被测量",
        "参考答案：B。观察到相关性，并不意味着存在因果关系。B 引入“睡眠充足”这一共同影响因素，为效率提升提供了其他解释。",
        ["另有他因", "因果关系"],
        1,
        { answer: "B", status: "reviewing" },
      ),
      make(
        "增长率与增长量的快速比较",
        "category-2",
        "某地区 2024 年营业收入为 240 亿元，同比增长 20%；2025 年营业收入同比增长 15%。2025 年的营业收入比 2023 年增加了多少亿元？",
        "2023 年：240 ÷ 1.2 = 200 亿元。\n2025 年：240 × 1.15 = 276 亿元。\n增加额：276 − 200 = 76 亿元。\n\n注意基期：题目比较的是 2025 年与 2023 年，而非上一年。",
        ["增长率", "基期量"],
        2,
        { answer: "76 亿元", myAnswer: "36 亿元", status: "reviewing" },
      ),
      make(
        "转折之后，才是文段的重点",
        "category-1",
        "数字技术让文化资源触手可及。然而，技术只是传播的工具，真正让传统文化焕发生机的，仍是对其精神内涵的理解与创造性转化。\n\n这段文字主要强调什么？",
        "转折词“然而”引出重点。文段强调：传统文化的传承需要理解精神内涵并进行创造性转化。前句的数字技术是背景。",
        ["主旨概括", "转折关系"],
        3,
        { answer: "理解内涵与创造性转化", status: "mastered", reviews: 2 },
      ),
      make(
        "定义判断：抓住必要条件",
        "category-5",
        "机会成本是指，为了得到某种东西而放弃的其他选择中，价值最高的一项。\n\n小林周末可以兼职赚 200 元、参加价值 300 元的课程，或在家休息。若选择参加课程，且休息的主观价值低于 200 元，其机会成本是多少？",
        "答案为 200 元。机会成本看的是被放弃的其他选择中价值最高的一项，而非把所有选择的价值相加，也不是所选活动本身的价值。",
        ["经济学定义", "必要条件"],
        4,
        { answer: "200 元" },
      ),
      make(
        "工程问题：用赋值法统一效率",
        "category-7",
        "一项工程，甲独做需要 12 天，乙独做需要 18 天。两人合作需要多少天完成？",
        "设总工程量为 36，甲每天完成 3，乙每天完成 2。\n合作时间 = 36 ÷ (3 + 2) = 7.2 天。\n\n总量可取完成时间的最小公倍数，计算更直观。",
        ["工程问题", "赋值法"],
        5,
        { answer: "7.2 天", status: "mastered", reviews: 3 },
      ),
    ],
  };
}
export async function createStore({
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
      "CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT 'sage')",
    );
    await pool.query(
      "CREATE TABLE IF NOT EXISTS questions (id UUID PRIMARY KEY, category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS questions_category_idx ON questions(category_id)",
    );
    for (const c of categories)
      await pool.query(
        "INSERT INTO categories(id,name,color) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [c.id, c.name, c.color],
      );
    return {
      mode: "postgres",
      async listCategories() {
        return (await pool.query("SELECT * FROM categories ORDER BY id")).rows;
      },
      async addCategory(name, color) {
        const c = { id: randomUUID(), name, color };
        await pool.query(
          "INSERT INTO categories(id,name,color) VALUES($1,$2,$3)",
          [c.id, c.name, c.color],
        );
        return c;
      },
      async list() {
        return (
          await pool.query(
            "SELECT data, category_id FROM questions ORDER BY created_at DESC",
          )
        ).rows.map((r) => ({ ...r.data, categoryId: r.category_id || "" }));
      },
      async get(id) {
        const r = (
          await pool.query(
            "SELECT data, category_id FROM questions WHERE id=$1",
            [id],
          )
        ).rows[0];
        return r ? { ...r.data, categoryId: r.category_id || "" } : null;
      },
      async save(item) {
        await pool.query(
          "INSERT INTO questions(id,category_id,data,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET category_id=EXCLUDED.category_id,data=EXCLUDED.data",
          [
            item.id,
            item.categoryId || null,
            JSON.stringify(item),
            item.createdAt,
          ],
        );
        return item;
      },
      async remove(id) {
        return (
          (await pool.query("DELETE FROM questions WHERE id=$1", [id]))
            .rowCount > 0
        );
      },
      async close() {
        await pool.end();
      },
    };
  }
  let data;
  try {
    data = JSON.parse(await fs.readFile(dataFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    data = demoData();
  }
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  let queue = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(data, null, 2);
    const job = queue.then(async () => {
      await fs.writeFile(dataFile + ".tmp", snapshot);
      await fs.rename(dataFile + ".tmp", dataFile);
    });
    queue = job.catch(() => {});
    return job;
  };
  await persist();
  return {
    mode: "demo",
    async listCategories() {
      return structuredClone(data.categories);
    },
    async addCategory(name, color) {
      if (data.categories.some((c) => c.name === name)) {
        const e = new Error("分类已存在");
        e.code = "23505";
        throw e;
      }
      const c = { id: randomUUID(), name, color };
      data.categories.push(c);
      await persist();
      return c;
    },
    async list() {
      return structuredClone(data.items).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    },
    async get(id) {
      return structuredClone(data.items.find((i) => i.id === id) || null);
    },
    async save(item) {
      const index = data.items.findIndex((i) => i.id === item.id);
      if (index >= 0) data.items[index] = structuredClone(item);
      else data.items.unshift(structuredClone(item));
      await persist();
      return item;
    },
    async remove(id) {
      const before = data.items.length;
      data.items = data.items.filter((i) => i.id !== id);
      await persist();
      return before !== data.items.length;
    },
    async close() {
      await queue;
    },
  };
}
