import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const releaseDirectory = path.join(root, "releases");
const { version } = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("package.json must contain a valid release version");
}
const archive = path.join(
  releaseDirectory,
  `mistake-notebook-linux-v${version}.tar.gz`,
);
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
const checksum = createHash("sha256")
  .update(await fs.readFile(archive))
  .digest("hex");
const checksumFile = path.join(releaseDirectory, "SHA256SUMS.txt");
await fs.writeFile(checksumFile, `${checksum}  ${path.basename(archive)}\n`);
console.log(`Linux deployment archive: ${archive}`);
console.log(`Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
console.log(`SHA-256 checksums: ${checksumFile}`);
