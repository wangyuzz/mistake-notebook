// SSE frames can cross TCP chunks, including inside UTF-8 characters and CRLFs.
export async function* eventData(body) {
  if (!body) throw new Error("Missing response body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const data = (frame) =>
    frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const payload = data(frame);
        if (payload) yield payload;
      }
      if (buffer.length > 2 * 1024 * 1024)
        throw new Error("Stream event too large");
      if (done) {
        const payload = data(buffer);
        if (payload) yield payload;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
