import {
  scrypt,
  randomBytes,
  createHash,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
const derive = promisify(scrypt);
export const hashToken = (value) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt, 64);
  return "scrypt:" + salt + ":" + hash.toString("hex");
}
export async function checkPassword(password, encoded) {
  try {
    const [kind, salt, value] = encoded.split(":");
    if (kind !== "scrypt") return false;
    const expected = Buffer.from(value, "hex");
    const actual = await derive(password, salt, 64);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}
export function publicUser({
  id,
  username,
  displayName,
  role,
  active,
  createdAt,
}) {
  return { id, username, displayName, role, active, createdAt };
}
export async function encryptionKey() {
  if (process.env.SETTINGS_ENCRYPTION_KEY)
    return createHash("sha256")
      .update(process.env.SETTINGS_ENCRYPTION_KEY)
      .digest();
  const file = path.resolve("data/settings.key");
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const key = await fs.readFile(file);
  if (key.length !== 32) throw new Error("配置加密密钥无效");
  return key;
}
export function encrypt(value, key) {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const content = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString("base64");
}
export function decrypt(value, key) {
  if (!value) return "";
  const raw = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  cipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([
    cipher.update(raw.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
export function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim().split("="))
      .filter((s) => s.length === 2),
  );
}
export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 7 * 86400000,
  };
}
export async function issueSession(store, user, res) {
  const token = randomBytes(32).toString("hex");
  await store.addSession({
    id: hashToken(token),
    userId: user.id,
    expiresAt: Date.now() + 7 * 86400000,
  });
  const now = new Date().toISOString();
  await store.updateUser(user.id, { lastLoginAt: now, lastActiveAt: now });
  res.cookie("shiti_session", token, cookieOptions());
  return token;
}
