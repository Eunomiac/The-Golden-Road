import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { NotationError } from "../NotationError";
import { splitTopLevelArgs } from "../utils/splitTopLevel";

/**
 * Handles {{MAX:valueA,valueB,...}} notation by returning the highest numeric value.
 */
export class MaxHandler implements NotationHandler {
  name = "MAX";

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): number {
    const segments = splitTopLevelArgs(content);

    if (segments.length < 2) {
      throw new NotationError(
        "MAX requires at least two values to compare.",
        `MAX:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    let maxValue: number | undefined;

    for (const segment of segments) {
      // Resolve nested notations to obtain the numeric candidate.
      const evaluated = processor.process(segment, context);
      const numericValue = this.toNumber(evaluated, segment, context);

      if (maxValue === undefined || numericValue > maxValue) {
        maxValue = numericValue;
      }
    }

    if (maxValue === undefined) {
      throw new NotationError(
        "MAX could not derive a numeric value from the provided arguments.",
        `MAX:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    return maxValue;
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
        `MAX argument '${segment}' did not resolve to a finite number.`,
        `MAX:${segment}`,
        context.filePath,
        context.lineNumber
      );
    }

    return numericValue;
  }
}
