export interface HtmlValidationResult {
  isValid: boolean;
  message?: string;
  contextSnippet?: string;
}

const TAG_PATTERN = /<\/?([A-Za-z][A-Za-z0-9-]*)[^>]*>/g;

const VOID_ELEMENTS = new Set<string>([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
  "img"
]);

const CONTEXT_RADIUS = 80;

const createContextSnippet = (html: string, index: number): string => {
  const start = Math.max(0, index - CONTEXT_RADIUS);
  const end = Math.min(html.length, index + CONTEXT_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < html.length ? "…" : "";
  return `${prefix}${html.slice(start, end)}${suffix}`;
};

interface TagFrame {
  tag: string;
  index: number;
}

export const validateHtmlStructure = (html: string): HtmlValidationResult => {
  const stack: TagFrame[] = [];
  let match: RegExpExecArray | null;

  while ((match = TAG_PATTERN.exec(html)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const isClosingTag = fullTag.startsWith("</");
    const isSelfClosing = fullTag.endsWith("/>") || VOID_ELEMENTS.has(tagName);

    if (isSelfClosing) {
      continue;
    }

    if (!isClosingTag) {
      stack.push({ tag: tagName, index: match.index });
      continue;
    }

    if (stack.length === 0) {
      return {
        isValid: false,
        message: `Unexpected closing tag </${tagName}> at index ${match.index}.`,
        contextSnippet: createContextSnippet(html, match.index)
      };
    }

    const expectedFrame = stack.pop();
    if (!expectedFrame || expectedFrame.tag !== tagName) {
      return {
        isValid: false,
        message: `Mismatched closing tag </${tagName}>. Expected </${expectedFrame?.tag ?? "unknown"}>.`,
        contextSnippet: createContextSnippet(html, match.index)
      };
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    return {
      isValid: false,
      message: `Unclosed tag <${unclosed.tag}> detected.`,
      contextSnippet: createContextSnippet(html, unclosed.index)
    };
  }

  return { isValid: true };
};

export const findDisallowedTags = (
  html: string,
  allowedTags: ReadonlySet<string>
): string[] => {
  const invalidTags = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = TAG_PATTERN.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    if (!allowedTags.has(tagName)) {
      invalidTags.add(tagName);
    }
  }

  return Array.from(invalidTags);
};
