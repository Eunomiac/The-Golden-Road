import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";

/**
 * Handles {{INLINELIST:<...curlyreferences>}} notation
 */
export class InlineListHandler implements NotationHandler {
  name = "INLINELIST";
  private referenceResolver: ReferenceResolver;

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    // Split by comma to get individual references
    const references = content.split(",").map((r) => r.trim()).filter((r) => r.length > 0);

    if (references.length === 0) {
      throw new NotationError(
        "INLINELIST requires at least one reference",
        "INLINELIST",
        context.filePath,
        context.lineNumber
      );
    }

    try {
      const items: (string | number)[] = [];

      for (const reference of references) {
        const resolved = this.referenceResolver.resolve(reference, context);

        if (Array.isArray(resolved)) {
          // Convert array elements to strings/numbers
          for (const item of resolved) {
            if (typeof item === "string" || typeof item === "number") {
              items.push(item);
            } else {
              throw new NotationError(
                `INLINELIST array contains non-string/number value: ${typeof item}`,
                `INLINELIST:${reference}`,
                context.filePath,
                context.lineNumber
              );
            }
          }
        } else if (typeof resolved === "object" && resolved !== null) {
          // Convert object to array via Object.values()
          const values = Object.values(resolved);
          for (const value of values) {
            if (typeof value === "string" || typeof value === "number") {
              items.push(value);
            } else {
              throw new NotationError(
                `INLINELIST object contains non-string/number value: ${typeof value}`,
                `INLINELIST:${reference}`,
                context.filePath,
                context.lineNumber
              );
            }
          }
        } else if (resolved !== null && resolved !== undefined) {
          // Single value
          items.push(String(resolved));
        }
        // Ignore null/undefined
      }

      if (items.length === 0) {
        throw new NotationError(
          "INLINELIST resulted in empty array",
          "INLINELIST",
          context.filePath,
          context.lineNumber
        );
      }

      return this.formatList(items);
    } catch (error) {
      if (error instanceof NotationError) {
        if (context.strict !== false) {
          throw error;
        }
        return error.toInlineError();
      }
      throw error;
    }
  }

  /**
   * Formats array as grammatically correct inline list
   */
  private formatList(items: (string | number)[]): string {
    if (items.length === 1) {
      return String(items[0]);
    }

    if (items.length === 2) {
      return `${items[0]} and ${items[1]}`;
    }

    // More than 2: "A, B, C, ... E and F"
    const allButLast = items.slice(0, -1);
    const last = items[items.length - 1];

    return `${allButLast.join(", ")}, and ${last}`;
  }
}
