import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const releaseDirectory = path.join(root, "releases");
const releaseDate = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const archive = path.join(releaseDirectory, `shiti-linux-${releaseDate}.tar.gz`);
// Explicit source list keeps local accounts, credentials and backups out of releases.
const sources = [
  "Dockerfile",
  "compose.yaml",
  ".dockerignore",
  ".env.example",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "index.html",
  "README.md",
  "DEPLOY-LINUX.md",
  "deploy",
  "src",
  "server",
  "shared",
  "public",
  "scripts",
];
for (const source of sources) await fs.access(path.join(root, source));
await fs.mkdir(releaseDirectory, { recursive: true });
const result = spawnSync("tar", ["-czf", archive, ...sources], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const { size } = await fs.stat(archive);
console.log(`Linux deployment archive: ${archive}`);
console.log(`Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
