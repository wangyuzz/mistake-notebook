import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { createPlatformStore } from "../server/platform-store.mjs";
import { createApp } from "../server/app.mjs";
const output = path.resolve("test-results");
await fs.mkdir(output, { recursive: true });
const file = path.join(output, "browser-" + Date.now() + ".json");
const store = await createPlatformStore({ dataFile: file });
const server = http.createServer(
  createApp(store, { encryptionKey: randomBytes(32), aiKey: "", aiModel: "" }),
);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
let aiCalls = 0;
const upstream = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  assert.equal(body.model, "vision-browser-test");
  assert.equal(body.reasoning_effort, "high");
  assert.match(body.messages[0].content, /浏览器配置验证/);
  assert.ok(!body.messages[1].content[0].text.includes("{{width}}"));
  assert.ok(body.messages.at(-1).content.some((c) => c.type === "image_url"));
  aiCalls++;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              questions: [
                {
                  title: "自动识别测试题",
                  text: "清晰印刷题干",
                  categoryName: "图形推理",
                  tags: ["位置规律"],
                  bbox: { x: 0.05, y: 0.075, width: 0.92, height: 0.238 },
                  warning: "",
                },
              ],
            }),
          },
        },
      ],
    }),
  );
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
let browser;
const checkOverflow = async (page, label) =>
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    label + " overflow",
  );
try {
  browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE ||
      (existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
        ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
        : undefined),
    headless: true,
  });
  const errors = [];
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("heading", { name: "建立你的学习空间" }).waitFor();
  await checkOverflow(page, "setup");
  await page.screenshot({
    path: path.join(output, "mobile-setup.png"),
    fullPage: true,
  });
  await page.getByLabel("你的称呼", { exact: true }).fill("小拾");
  await page.getByLabel("用户名", { exact: true }).fill("browseradmin");
  await page.getByLabel("设置密码", { exact: true }).fill("Browser-test-123");
  await page.getByLabel("确认密码", { exact: true }).fill("Browser-test-123");
  await page.getByRole("button", { name: "创建管理员并进入" }).click();
  await page.getByRole("heading", { name: "错题收藏夹" }).waitFor();
  const state = await context.storageState();
  for (const [name, width, height] of [
    ["desktop", 1440, 1050],
    ["mobile", 390, 844],
    ["small-mobile", 320, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await checkOverflow(page, name);
    await page.screenshot({
      path: path.join(output, name + ".png"),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "拍照导入", exact: true }).click();
  assert.equal(
    await page
      .getByLabel("拍摄整页照片", { exact: true })
      .getAttribute("capture"),
    "environment",
  );
  await page
    .getByLabel("上传整页照片", { exact: true })
    .setInputFiles("public/samples/figure-page.jpg");
  await page.getByRole("button", { name: "添加第一道题", exact: true }).click();
  for (let i = 1; i < 5; i++)
    await page.getByRole("button", { name: "添加裁框", exact: true }).click();
  assert.equal(await page.locator(".crop-box").count(), 5);
  await page.locator(".segment-thumbnail img").nth(4).waitFor();
  await page.screenshot({
    path: path.join(output, "mobile-import.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: path.join(output, "desktop-import.png"),
    fullPage: true,
  });
  const box = page.getByRole("group", { name: "第 1 题裁框", exact: true });
  const before = await box.getAttribute("style");
  const bounds = await box.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 5,
    bounds.y + bounds.height / 2 + 5,
    { steps: 3 },
  );
  await page.mouse.up();
  assert.notEqual(await box.getAttribute("style"), before);
  await page.getByRole("button", { name: "撤销裁框调整" }).click();
  assert.equal(await box.getAttribute("style"), before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("收录第 4 题", { exact: true }).uncheck();
  await page.getByLabel("收录第 5 题", { exact: true }).uncheck();
  assert.equal(await page.getByRole("slider").count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "确认范围", exact: true }).count(),
    0,
  );
  await page
    .getByLabel("题目标题", { exact: true })
    .fill("浏览器测试 · 九宫格");
  await page
    .getByLabel("知识点标签", { exact: true })
    .fill("位置规律，保留编辑");
  await page.getByRole("button", { name: "继续导入图片", exact: true }).click();
  await page
    .getByLabel("上传整页照片", { exact: true })
    .setInputFiles("public/samples/figure-page.jpg");
  await page.getByRole("button", { name: "添加第一道题", exact: true }).click();
  await page
    .getByLabel("题目标题", { exact: true })
    .fill("第二张图片 · 手动框题");
  assert.equal(
    await page.getByRole("button", { name: /切换到第 .* 张图片/ }).count(),
    2,
  );
  await page
    .getByRole("button", { name: "切换到第 1 张图片", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("题目标题", { exact: true }).inputValue(),
    "浏览器测试 · 九宫格",
  );
  assert.equal(
    await page.getByLabel("知识点标签", { exact: true }).inputValue(),
    "位置规律，保留编辑",
  );
  assert.equal(
    await page.getByLabel("收录第 4 题", { exact: true }).isChecked(),
    false,
  );
  for (const [name, width, height] of [
    ["mobile", 390, 844],
    ["small-mobile", 320, 740],
    ["desktop", 1440, 1050],
  ]) {
    await page.setViewportSize({ width, height });
    await checkOverflow(page, name + " importer");
    assert.equal(
      await page
        .locator(".import-modal")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
      true,
    );
    await page.locator(".active-question-editor").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(output, name + "-inline-edit.png"),
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "收录 4 道错题", exact: true })
    .click();
  await page.locator(".import-modal").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "查看：浏览器测试 · 九宫格", exact: true })
    .click();
  await page.getByRole("button", { name: /来自整页导入/ }).click();
  await page.getByAltText("错题附件原图", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(output, "mobile-source.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.reload();
  await page.getByRole("heading", { name: "错题收藏夹" }).waitFor();
  assert.equal(
    (await (await context.request.get(base + "/api/export")).json()).pages
      .length,
    2,
  );
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("button", { name: "用户管理", exact: true }).click();
  await page.getByRole("button", { name: "添加用户", exact: true }).click();

  await page.getByLabel("用户名", { exact: true }).fill("learner");
  await page.getByLabel("称呼", { exact: true }).fill("学习者");
  await page.getByLabel("初始密码", { exact: true }).fill("Learner-test-123");
  await page.getByRole("button", { name: "创建用户", exact: true }).click();
  await page.getByText("@learner", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "AI 与识别配置", exact: true })
    .click();
  await page.screenshot({
    path: path.join(output, "mobile-admin.png"),
    fullPage: true,
  });
  const learnerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const learner = await learnerContext.newPage();
  learner.on("pageerror", (e) => errors.push(e.message));
  await learner.goto(base);
  await learner.getByLabel("用户名", { exact: true }).fill("learner");
  await learner.getByLabel("密码", { exact: true }).fill("Learner-test-123");
  await learner
    .getByRole("button", { name: "进入学习空间", exact: true })
    .click();
  await learner.getByRole("heading", { name: "错题收藏夹" }).waitFor();
  assert.equal(
    (await (await learnerContext.request.get(base + "/api/questions")).json())
      .length,
    0,
  );
  assert.equal(
    (await learnerContext.request.get(base + "/api/admin/settings")).status(),
    403,
  );
  await learner.getByRole("button", { name: "打开设置", exact: true }).click();
  assert.equal(
    await learner
      .getByRole("button", { name: "用户管理", exact: true })
      .count(),
    0,
  );
  await learnerContext.close();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "错题本", exact: true })
    .click();
  await page.getByRole("button", { name: "拍照导入", exact: true }).click();
  await page
    .getByLabel("上传整页照片", { exact: true })
    .setInputFiles("public/samples/figure-page.jpg");
  await page.getByRole("button", { name: "添加第一道题", exact: true }).click();
  assert.equal(await page.locator(".crop-box").count(), 1);
  await page
    .getByRole("button", { name: "AI 识别 · 待管理员配置", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "识别服务尚未接入" })
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page
    .getByLabel("API 服务地址", { exact: true })
    .fill("http://127.0.0.1:" + upstream.address().port + "/v1");
  await page
    .getByLabel("API 密钥", { exact: false })
    .fill("browser-mock-secret");
  await page
    .getByLabel("解题与对话模型", { exact: true })
    .fill("vision-browser-test");
  await page
    .getByLabel("解题与对话思考等级", { exact: true })
    .selectOption("medium");
  await page
    .getByLabel("拆题识别思考等级", { exact: true })
    .selectOption("high");
  const originalPrompt = await page
    .getByLabel("拆题识别 · 系统提示词", { exact: true })
    .inputValue();
  await page
    .getByLabel("拆题识别 · 系统提示词", { exact: true })
    .fill(originalPrompt + " 浏览器配置验证。");
  await page.locator(".prompt-settings").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "mobile-prompts.png") });
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page
    .getByText("配置已保存，立即对所有学习空间生效", { exact: true })
    .waitFor();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "错题本", exact: true })
    .click();
  await page.getByRole("button", { name: "拍照导入", exact: true }).click();
  await page
    .getByLabel("上传整页照片", { exact: true })
    .setInputFiles("public/samples/figure-page.jpg");
  await page
    .getByText("AI 建议裁框 · 请核对是否包含全部选项", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".crop-box").count(), 1);
  assert.equal(aiCalls, 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS onboarding, three viewport sizes, crop move/undo, inline editing, multi-page import with draft preservation, prompt and reasoning settings, source persistence, admin and account isolation, manual fallback; no runtime errors",
  );
} catch (e) {
  console.error(e);
  if (browser) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    for (let i = 0; i < pages.length; i++)
      await pages[i]
        .screenshot({
          path: path.join(output, "failure-" + i + ".png"),
          fullPage: true,
        })
        .catch(() => {});
  }
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
  await store.close();
  await new Promise((r) => upstream.close(r));
  await fs.unlink(file).catch(() => {});
}
