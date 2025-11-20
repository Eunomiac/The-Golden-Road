import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";
import { splitTopLevelArgs } from "../utils/splitTopLevel";

/**
 * Handles {{SWITCH:reference,case1,result1,...}} notation.
 */
export class SwitchHandler implements NotationHandler {
  name = "SWITCH";
  private referenceResolver: ReferenceResolver;

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string | number {
    const segments = splitTopLevelArgs(content);

    if (segments.length < 3 || segments.length % 2 === 0) {
      throw new NotationError(
        "SWITCH requires a reference followed by case/result pairs.",
        `SWITCH:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    const referenceExpr = segments[0];
    const resolvedReference = this.resolveReference(referenceExpr, context);

    for (let i = 1; i < segments.length; i += 2) {
      const caseLabel = segments[i];
      const resultExpr = segments[i + 1];

      if (resultExpr === undefined) {
        throw new NotationError(
          "SWITCH is missing a result for one of the cases.",
          `SWITCH:${content}`,
          context.filePath,
          context.lineNumber
        );
      }

      if (caseLabel === resolvedReference) {
        return processor.process(resultExpr, context);
      }
    }

    throw new NotationError(
      `SWITCH did not find a matching case for value '${resolvedReference}'.`,
      `SWITCH:${content}`,
      context.filePath,
      context.lineNumber
    );
  }

  private resolveReference(reference: string, context: ProcessingContext): string {
    try {
      const resolved = this.referenceResolver.resolve(reference, context);
      if (resolved === null || resolved === undefined) {
        throw new NotationError(
          "SWITCH reference resolved to null/undefined.",
          reference,
          context.filePath,
          context.lineNumber
        );
      }
      return typeof resolved === "string" ? resolved : String(resolved);
    } catch (error) {
      if (error instanceof NotationError) {
        throw error;
      }
      throw new NotationError(
        `Unable to resolve SWITCH reference '${reference}'.`,
        reference,
        context.filePath,
        context.lineNumber,
        error instanceof Error ? error.message : undefined
      );
    }
  }
}
