import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { NotationError } from "../NotationError";

/**
 * Handles {{CALC:<formula>}} notation
 */
export class CalcHandler implements NotationHandler {
  name = "CALC";

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string | number {
    // First, process any nested notations in the formula
    const processedFormula = processor.process(content, context);

    // Try to evaluate the formula
    try {
      // Convert to number if it's a string representation of a number
      if (typeof processedFormula === "string") {
        const normalizedFormula = this.normalizeOperators(processedFormula);
        const num = Number(normalizedFormula);
        if (!isNaN(num) && isFinite(num)) {
          return Math.round(num);
        }
      }

      // If it's already a number, return it
      if (typeof processedFormula === "number") {
        return Math.round(processedFormula);
      }

      // Try to evaluate as expression
      // eslint-disable-next-line no-eval
      const safeFormula = typeof processedFormula === "string"
        ? this.normalizeOperators(processedFormula)
        : processedFormula;

      // eslint-disable-next-line no-eval
      const result = eval(safeFormula);

      if (typeof result === "number" && !isNaN(result) && isFinite(result)) {
        return Math.round(result);
      }

      throw new NotationError(
        `CALC expression did not evaluate to a number: ${processedFormula}`,
        `CALC:${content}`,
        context.filePath,
        context.lineNumber
      );
    } catch (error) {
      if (error instanceof NotationError) {
        if (context.strict !== false) {
          throw error;
        }
        return error.toInlineError();
      }

      const message = error instanceof Error ? error.message : String(error);
      const snippet = typeof content === "string"
        ? this.normalizeOperators(content).slice(0, 120)
        : String(content);
      throw new NotationError(
        `CALC expression evaluation failed: ${message}. Context: ${snippet}`,
        `CALC:${content}`,
        context.filePath,
        context.lineNumber
      );
    }
  }

  private normalizeOperators(formula: string): string {
    return formula.replace(/\u2212/g, "-"); // Unicode minus to ASCII hyphen-minus
  }
}
