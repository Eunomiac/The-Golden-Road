import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { NotationError } from "../NotationError";

/**
 * Handles {{BASEKEY:attribute}} by converting attribute references (e.g., "dex")
 * into camel-cased base keys (e.g., "baseDex").
 */
export class BaseKeyHandler implements NotationHandler {
  name = "BASEKEY";
  private static readonly ALLOWED_ATTRIBUTES = new Set([
    "int",
    "wit",
    "res",
    "str",
    "dex",
    "sta",
    "pre",
    "man",
    "com"
  ]);

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    const evaluated = processor.process(content, context);
    if (typeof evaluated !== "string") {
      throw new NotationError(
        "BASEKEY requires a string attribute reference.",
        `BASEKEY:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    const normalized = evaluated.trim();
    if (!normalized) {
      throw new NotationError(
        "BASEKEY requires a non-empty attribute reference.",
        `BASEKEY:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    const lower = normalized.toLowerCase();
    if (!BaseKeyHandler.ALLOWED_ATTRIBUTES.has(lower)) {
      throw new NotationError(
        `BASEKEY only supports attribute keys (${Array.from(BaseKeyHandler.ALLOWED_ATTRIBUTES).join(", ")}), got '${normalized}'.`,
        `BASEKEY:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    return `base${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
  }
}
