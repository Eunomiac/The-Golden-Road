import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { NotationError } from "../NotationError";

/**
 * Handles {{ROUNDUP:<value>}} notation by returning Math.ceil of the evaluated value.
 */
export class RoundupHandler implements NotationHandler {
  name = "ROUNDUP";

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): number {
    const processed = processor.process(content, context);

    const numericValue = this.toNumber(processed, content, context);
    return Math.ceil(numericValue);
  }

  private toNumber(
    value: string | number,
    content: string,
    context: ProcessingContext
  ): number {
    const numericValue = typeof value === "number" ? value : Number(value);

    if (!Number.isFinite(numericValue)) {
      throw new NotationError(
        `ROUNDUP requires a numeric value; received '${value}'.`,
        `ROUNDUP:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    return numericValue;
  }
}
