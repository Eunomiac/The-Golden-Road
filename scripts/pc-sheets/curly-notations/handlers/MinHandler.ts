import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { NotationError } from "../NotationError";
import { splitTopLevelArgs } from "../utils/splitTopLevel";

/**
 * Handles {{MIN:valueA,valueB,...}} notation by returning the smallest numeric value.
 */
export class MinHandler implements NotationHandler {
  name = "MIN";

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): number {
    const segments = splitTopLevelArgs(content);

    if (segments.length < 2) {
      throw new NotationError(
        "MIN requires at least two values to compare.",
        `MIN:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    let minValue: number | undefined;

    for (const segment of segments) {
      const evaluated = processor.process(segment, context);
      const numericValue = this.toNumber(evaluated, segment, context);

      if (minValue === undefined || numericValue < minValue) {
        minValue = numericValue;
      }
    }

    if (minValue === undefined) {
      throw new NotationError(
        "MIN could not derive a numeric value from the provided arguments.",
        `MIN:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    return minValue;
  }

  /**
   * Converts the evaluated segment result into a finite number.
   */
  private toNumber(
    value: string | number,
    segment: string,
    context: ProcessingContext
  ): number {
    const numericValue = typeof value === "number" ? value : Number(value);

    if (!Number.isFinite(numericValue)) {
      throw new NotationError(
        `MIN argument '${segment}' did not resolve to a finite number.`,
        `MIN:${segment}`,
        context.filePath,
        context.lineNumber
      );
    }

    return numericValue;
  }
}
