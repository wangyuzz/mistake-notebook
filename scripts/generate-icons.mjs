import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// This optional design tool rasterizes the canonical SVG; deployment uses saved PNGs.
const svg = await fs.readFile(
  new URL("../public/favicon.svg", import.meta.url),
  "utf8",
);
const directory = new URL("../public/icons/", import.meta.url);
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : { channel: "chrome" }),
});
try {
  const page = await browser.newPage();
  for (const [size, filename] of [
    [32, "favicon-32-v3.png"],
    [180, "apple-touch-icon-v3.png"],
    [192, "icon-192-v3.png"],
    [512, "icon-512-v3.png"],
  ]) {
    const dataUrl = await page.evaluate(
      async ({ svg, size }) => {
        const image = new Image();
        image.src =
          "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, size, size);
        return canvas.toDataURL("image/png");
      },
      { svg, size },
    );
    const file = new URL(filename, directory);
    await fs.writeFile(file, Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log(`Created ${size}×${size}: ${fileURLToPath(file)}`);
  }
  // iOS also probes these conventional paths when choosing a Home Screen icon.
  for (const filename of [
    "apple-touch-icon.png",
    "apple-touch-icon-precomposed.png",
  ]) {
    await fs.copyFile(
      new URL("apple-touch-icon-v3.png", directory),
      new URL(`../public/${filename}`, import.meta.url),
    );
    console.log(`Created iOS fallback: ${filename}`);
  }
} finally {
  await browser.close();
}
