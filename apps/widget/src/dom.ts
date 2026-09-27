type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/** Tiny element builder. Text always goes through textContent/text nodes (no innerHTML). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | false | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (typeof value === "function") el.addEventListener(name.slice(2), value);
    else if (name === "class") el.className = String(value);
    else el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    el.append(child);
  }
  return el;
}

/** Picks white or dark text for the brand color, whichever contrasts more. */
export function textColorFor(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) return "#fff";
  const n = parseInt(match[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum =
    0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  const vsWhite = 1.05 / (lum + 0.05);
  const vsDark = (lum + 0.05) / 0.0617; // #16202A
  return vsWhite >= vsDark ? "#fff" : "#16202A";
}
