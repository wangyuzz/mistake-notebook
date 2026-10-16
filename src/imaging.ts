import type { Box } from "./lib";
export async function readOriginal(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("请上传 JPG、PNG 或 WebP 图片");
  if (file.size > 20 * 1024 * 1024) throw new Error("原图请小于 20MB");
  const image = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 50000000)
      throw new Error("图片像素过大，请先裁边后上传");
    return {
      image,
      width: bitmap.width,
      height: bitmap.height,
      filename: file.name.slice(0, 200),
      rotation: 0,
    };
  } finally {
    bitmap.close();
  }
}
async function load(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}
export async function orientedPreview(
  src: string,
  rotation: number,
  maxLong = 2600,
) {
  const image = await load(src);
  const swapped = rotation % 180 !== 0;
  const width = swapped ? image.naturalHeight : image.naturalWidth;
  const height = swapped ? image.naturalWidth : image.naturalHeight;
  const scale = Math.min(1, maxLong / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(
    image,
    (-image.naturalWidth * scale) / 2,
    (-image.naturalHeight * scale) / 2,
    image.naturalWidth * scale,
    image.naturalHeight * scale,
  );
  return canvas.toDataURL("image/jpeg", 0.95);
}
export async function cropOriginal(
  src: string,
  rotation: number,
  box: Box,
  maxLong = Infinity,
  quality = 0.95,
) {
  const image = await load(src);
  const swapped = rotation % 180 !== 0;
  const width = swapped ? image.naturalHeight : image.naturalWidth;
  const height = swapped ? image.naturalWidth : image.naturalHeight;
  const cropWidth = Math.max(1, Math.round(width * box.width));
  const cropHeight = Math.max(1, Math.round(height * box.height));
  const scale = Math.min(1, maxLong / Math.max(cropWidth, cropHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-width * box.x, -height * box.y);
  ctx.translate(width / 2, height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  const result = canvas.toDataURL("image/jpeg", quality);
  if (maxLong === Infinity && result.length > 5 * 1024 * 1024)
    throw new Error("单题裁图过大，请缩小范围或分成两道题");
  return result;
}
