/**
 * Render-only markdown: bold, italic, inline code, and http(s) links.
 * No raw HTML. User text is never interpolated into HTML strings.
 */

export type MdNode =
  | { type: "text"; value: string }
  | { type: "bold"; children: MdNode[] }
  | { type: "italic"; children: MdNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: MdNode[] };

const LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
const BOLD_RE = /^\*\*([^*]+)\*\*/;
const ITALIC_RE = /^\*([^*]+)\*/;
const CODE_RE = /^`([^`]+)`/;

export function isSafeHttpUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isExternalHttpHost(href: string, pageHost: string): boolean {
  try {
    const url = new URL(href);
    return url.host !== pageHost;
  } catch {
    return true;
  }
}

export function parseInlineMarkdown(input: string): MdNode[] {
  const nodes: MdNode[] = [];
  let rest = input;
  while (rest.length > 0) {
    const link = rest.match(LINK_RE);
    if (link && isSafeHttpUrl(link[2] ?? "")) {
      nodes.push({
        type: "link",
        href: link[2] ?? "",
        children: parseInlineMarkdown(link[1] ?? ""),
      });
      rest = rest.slice(link[0].length);
      continue;
    }
    const code = rest.match(CODE_RE);
    if (code) {
      nodes.push({ type: "code", value: code[1] ?? "" });
      rest = rest.slice(code[0].length);
      continue;
    }
    const bold = rest.match(BOLD_RE);
    if (bold) {
      nodes.push({ type: "bold", children: parseInlineMarkdown(bold[1] ?? "") });
      rest = rest.slice(bold[0].length);
      continue;
    }
    const italic = rest.match(ITALIC_RE);
    if (italic) {
      nodes.push({ type: "italic", children: parseInlineMarkdown(italic[1] ?? "") });
      rest = rest.slice(italic[0].length);
      continue;
    }
    const nextSpecial = rest.search(/(\*\*|`|\[[^\]]*\]\(https?:\/\/[^\s)]+\))|\*[^*]+\*/);
    if (nextSpecial === -1) {
      nodes.push({ type: "text", value: rest });
      break;
    }
    if (nextSpecial === 0) {
      nodes.push({ type: "text", value: rest[0] ?? "" });
      rest = rest.slice(1);
      continue;
    }
    nodes.push({ type: "text", value: rest.slice(0, nextSpecial) });
    rest = rest.slice(nextSpecial);
  }
  return nodes;
}

export function parseMarkdownBlocks(input: string): MdNode[][] {
  return input.split("\n").map((line) => parseInlineMarkdown(line));
}
