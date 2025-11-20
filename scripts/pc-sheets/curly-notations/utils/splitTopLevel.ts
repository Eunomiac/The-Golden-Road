/**
 * Splits a comma-delimited string while respecting nested curly braces.
 * Commas that appear inside `{{ ... }}` expressions are ignored.
 */
export function splitTopLevelArgs(content: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let escapeNext = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      current += char;
      continue;
    }

    if (char === "}") {
      depth = Math.max(depth - 1, 0);
      current += char;
      continue;
    }

    if (char === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        parts.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    parts.push(trimmed);
  }

  return parts;
}

/**
 * Extracts the first top-level argument from a comma-delimited string, preserving the remainder exactly as written.
 */
export function extractFirstTopLevelArg(
  content: string
): { argument: string; remainder: string | null } {
  let depth = 0;
  let escapeNext = false;
  let current = "";

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      current += char;
      continue;
    }

    if (char === "}") {
      depth = Math.max(depth - 1, 0);
      current += char;
      continue;
    }

    if (char === "," && depth === 0) {
      const argument = current.trim();
      const remainder = content.slice(i + 1);
      return {
        argument,
        remainder: remainder.length > 0 ? remainder : ""
      };
    }

    current += char;
  }

  return {
    argument: current.trim(),
    remainder: null
  };
}