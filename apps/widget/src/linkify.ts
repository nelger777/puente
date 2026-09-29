// Turns URLs in assistant replies into safe links. Text is never parsed as HTML: plain text
// nodes plus <a> elements with an http(s) href only.

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
// Punctuation that usually ends a sentence rather than belonging to the URL.
const TRAILING = /[.,;:!?¡¿)\]]+$/;

export function linkify(text: string): (string | HTMLAnchorElement)[] {
  const parts: (string | HTMLAnchorElement)[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const trailing = TRAILING.exec(raw)?.[0] ?? "";
    const url = raw.slice(0, raw.length - trailing.length);
    const start = match.index;
    const href = url.toLowerCase().startsWith("www.") ? `https://${url}` : url;
    let parsed: URL;
    try {
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;

    if (start > last) parts.push(text.slice(last, start));
    const a = document.createElement("a");
    a.href = parsed.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer nofollow";
    a.textContent = url;
    parts.push(a);
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
