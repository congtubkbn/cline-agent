// Approximate token count: chars / 4 (good enough for SP1; pluggable later).
const CHARS_PER_TOKEN = 4;
export const approxTokens = (s) => Math.ceil((s || '').length / CHARS_PER_TOKEN);

// One-line summary: first sentence, capped at 120 chars.
function summarize(text) {
  const firstLine = text.replace(/\s+/g, ' ').trim();
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0] || firstLine;
  return firstSentence.length > 120 ? firstSentence.slice(0, 117) + '…' : firstSentence;
}

// makeTextPolicy returns a function (kind, eventId, fullText) -> { preview, summary, sidecar, fullLen }
// `sink(sidecarId, fullText)` persists the full text (e.g. writes a file). Called only when truncated.
export function makeTextPolicy({ thresholdTokens = 200, perKind = {}, sink }) {
  return function policy(kind, eventId, fullText) {
    const text = fullText || '';
    const limit = perKind[kind] ?? thresholdTokens;
    const fullLen = text.length;
    if (approxTokens(text) <= limit) {
      return { preview: text, summary: '', sidecar: '', fullLen };
    }
    const charLimit = limit * CHARS_PER_TOKEN;
    const preview = text.slice(0, charLimit).trimEnd() + '…';
    const sidecarId = `${eventId}_${kind}.txt`;
    if (sink) sink(sidecarId, text);
    return { preview, summary: summarize(text), sidecar: `sidecar/${sidecarId}`, fullLen };
  };
}
