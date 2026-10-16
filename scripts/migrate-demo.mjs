import "dotenv/config";
import fs from "node:fs/promises";
import pg from "pg";
import { importNotebook } from "../server/import.mjs";
const [file, targetUsername, sourceUsername] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !file || !targetUsername) {
  console.error(
    "用法：npm run migrate:demo -- <备份或本地数据.json> <数据库目标用户名> [本地来源用户名]；请先填写 DATABASE_URL 并建立目标账号。",
  );
  process.exit(1);
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: true }
      : undefined,
});
try {
  let source = JSON.parse(await fs.readFile(file, "utf8"));
  if (source.users?.length) {
    const users = sourceUsername
      ? source.users.filter((u) => u.username === sourceUsername)
      : source.users;
    if (users.length !== 1) throw new Error("多用户本地文件需要指定来源用户名");
    source = source.spaces[users[0].id];
    if (!source) throw new Error("未找到来源学习空间");
  }
  const result = await importNotebook(pool, source, targetUsername);
  console.log(
    "导入完成：新增 " +
      result.imported +
      " 道，跳过已有 " +
      result.skipped +
      " 道。来源文件保留；账号和 AI 密钥不迁移。",
  );
} catch (e) {
  console.error("导入失败：" + e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
