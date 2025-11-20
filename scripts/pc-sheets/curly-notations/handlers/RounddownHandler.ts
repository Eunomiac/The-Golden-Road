import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { NotationError } from "../NotationError";

/**
 * Handles {{ROUNDDOWN:<value>}} notation by returning Math.floor of the evaluated value.
 */
export class RounddownHandler implements NotationHandler {
  name = "ROUNDDOWN";

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): number {
    const processed = processor.process(content, context);

    const numericValue = this.toNumber(processed, content, context);
    return Math.floor(numericValue);
  }

  private toNumber(
    value: string | number,
    content: string,
    context: ProcessingContext
  ): number {
    const numericValue = typeof value === "number" ? value : Number(value);

    if (!Number.isFinite(numericValue)) {
      throw new NotationError(
        `ROUNDDOWN requires a numeric value; received '${value}'.`,
        `ROUNDDOWN:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    return numericValue;
  }
}
