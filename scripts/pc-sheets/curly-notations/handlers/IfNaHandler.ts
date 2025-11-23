import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { NotationError } from "../NotationError";
import { extractFirstTopLevelArg } from "../utils/splitTopLevel";

/**
 * Handles {{IFNA:<expression>,<fallback>}}
 * Evaluates the expression; if it throws a NotationError, renders the fallback instead.
 */
export class IfNaHandler implements NotationHandler {
  name = "IFNA";

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    let {
      argument: primaryExpression,
      remainder: fallbackExpression
    } = extractFirstTopLevelArg(content);

    if (!primaryExpression) {
      throw new NotationError(
        "IFNA requires an expression argument.",
        `IFNA:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    if (fallbackExpression === null) {
      fallbackExpression = "";
    }

    try {
      return processor.process(primaryExpression, context);
    } catch (error) {
      if (error instanceof NotationError) {
        return this.processFallback(fallbackExpression, context, processor);
      }
      throw error;
    }
  }

  private processFallback(
    fallback: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    if (fallback.trim().length === 0) {
      return "";
    }

    const fallbackResult = processor.process(fallback, context);
    return typeof fallbackResult === "string"
      ? fallbackResult
      : String(fallbackResult);
  }
}
