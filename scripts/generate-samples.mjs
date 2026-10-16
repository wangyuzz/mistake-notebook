import fs from "node:fs/promises";
import { chromium } from "playwright";

// Self-authored fictional fixtures. Never copy user uploads into public/samples.
const directory = new URL("../public/samples/", import.meta.url);
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : { channel: "chrome" }),
});
try {
  const page = await browser.newPage();
  for (const [filename, kind, width, height] of [
    ["question.png", "question", 1000, 640],
    ["notes.png", "notes", 1000, 640],
    ["categories.png", "categories", 1000, 640],
    ["figure-page.jpg", "page", 1200, 1600],
  ]) {
    const data = await page.evaluate(({ kind, width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fffefa";
      ctx.fillRect(0, 0, width, height);
      const text = (value, x, y, size = 32, color = "#273c30") => {
        ctx.font = `${size}px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(value, x, y);
      };
      text("拾题 · 虚构练习示例", 60, 85, 40);
      text("项目自制演示素材，不包含真实用户数据", 60, 135, 24, "#63785d");
      ctx.strokeStyle = "#c8d4bd";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(60, 165);
      ctx.lineTo(width - 60, 165);
      ctx.stroke();
      if (kind === "notes") {
        text("参考答案：D（6）", 60, 240, 36);
        text("第一步：1 + 2 = 3", 60, 315);
        text("第二步：3 + 3 = 6", 60, 375);
        text("复盘：按顺序计算，避免遗漏加数。", 60, 465, 30);
      } else if (kind === "categories") {
        ["数量关系", "逻辑判断", "图形推理", "资料分析"].forEach((label, i) => {
          const x = 60 + (i % 2) * 450;
          const y = 210 + Math.floor(i / 2) * 150;
          ctx.fillStyle = "#e8efdf";
          ctx.fillRect(x, y, 390, 110);
          text(label, x + 30, y + 68);
        });
      } else {
        text("1. 计算 1 + 2 + 3 的结果。", 60, 240, 36);
        text("A. 3        B. 4        C. 5        D. 6", 60, 320);
        if (kind === "page") {
          text("2. 每幅图比前一幅增加一个圆，下一幅有几个？", 60, 570, 32);
          for (let group = 1; group <= 3; group++) {
            const left = 80 + (group - 1) * 290;
            for (let i = 0; i < group; i++) {
              ctx.beginPath();
              ctx.arc(left + i * 65, 700, 24, 0, Math.PI * 2);
              ctx.strokeStyle = "#56754e";
              ctx.lineWidth = 5;
              ctx.stroke();
            }
          }
          text("A. 1        B. 2        C. 3        D. 4", 60, 815);
          text("3. 一本书有 12 页，每天看 3 页，需要几天？", 60, 1080, 32);
          text("A. 2        B. 3        C. 4        D. 6", 60, 1160);
        }
      }
      return canvas.toDataURL(kind === "page" ? "image/jpeg" : "image/png", 0.9);
    }, { kind, width, height });
    await fs.writeFile(new URL(filename, directory), Buffer.from(data.split(",")[1], "base64"));
    console.log(`Created fictional sample: ${filename}`);
  }
} finally {
  await browser.close();
}
