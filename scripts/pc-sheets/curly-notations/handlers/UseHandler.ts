import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";

/**
 * Handles {{USE:reference}} notation by returning the resolved value unchanged.
 */
export class UseHandler implements NotationHandler {
  name = "USE";
  private referenceResolver: ReferenceResolver;

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string | number {
    const reference = content.trim();
    if (reference.length === 0) {
      throw new NotationError(
        "USE requires a reference argument.",
        "USE",
        context.filePath,
        context.lineNumber
      );
    }

    try {
      return this.coercePrimitive(this.referenceResolver.resolve(reference, context), reference, context);
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

  private coercePrimitive(
    value: unknown,
    reference: string,
    context: ProcessingContext
  ): string | number {
    if (typeof value === "string" || typeof value === "number") {
      return value;
    }

    if (value === null || value === undefined) {
      throw new NotationError(
        `USE reference '${reference}' resolved to ${value === null ? "null" : "undefined"}.`,
        `USE:${reference}`,
        context.filePath,
        context.lineNumber
      );
    }

    if (typeof value === "object") {
      const serialized = JSON.stringify(value);
      return serialized;
    }

    throw new NotationError(
      `USE reference '${reference}' must resolve to a string or number, got ${typeof value}.`,
      `USE:${reference}`,
      context.filePath,
      context.lineNumber
    );
  }
}
