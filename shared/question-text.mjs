// Decode accidental double-escaped line breaks without changing code or TeX.
export function normalizeRecognizedText(value) {
  const protectedParts =
    /(```[\s\S]*?```|`[^`\r\n]*`|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\r\n]*?\$)/g;
  return value
    .replace(/\r\n?/g, "\n")
    .split(protectedParts)
    .map((part, index) =>
      index % 2 ? part : part.replace(/\\+(?:r\\+n|n)(?![a-z])/g, "\n"),
    )
    .join("");
}

function choiceBlock(text) {
  const marker =
    /(^|[\s。！？?；;：:])(?:[（(]([A-Ha-hＡ-Ｈａ-ｈ])[）)]|([A-Ha-hＡ-Ｈａ-ｈ])[.．、:：)）])/g;
  const choices = Array.from(text.matchAll(marker), (match) => ({
    start: match.index + match[1].length,
    label: (match[2] || match[3]).normalize("NFKC").toUpperCase(),
  }));
  for (let index = 0; index < choices.length - 1; index++) {
    if (choices[index].label !== "A" || choices[index + 1].label !== "B")
      continue;
    const ordered = [choices[index]];
    for (let next = index + 1; next < choices.length; next++) {
      if (choices[next].label.charCodeAt(0) === 65 + ordered.length)
        ordered.push(choices[next]);
    }
    return {
      text: text.slice(0, ordered[0].start).trimEnd(),
      options: ordered
        .map((choice, item) =>
          text.slice(choice.start, ordered[item + 1]?.start).trim(),
        )
        .join("\n"),
    };
  }
  return null;
}

export function splitQuestion(text, options = "") {
  const normalizedText = normalizeRecognizedText(text);
  const normalizedOptions = normalizeRecognizedText(options).trim();
  const extracted = choiceBlock(normalizedText);
  const explicit = choiceBlock(normalizedOptions);
  return {
    text: extracted ? extracted.text : normalizedText,
    options: normalizedOptions
      ? explicit?.options || normalizedOptions
      : extracted?.options || "",
  };
}
