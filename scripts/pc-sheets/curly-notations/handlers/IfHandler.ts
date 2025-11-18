import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";

/**
 * Handles {{IF:<condition>:<trueValue>:<falseValue>}} notation
 */
export class IfHandler implements NotationHandler {
  name = "IF";
  private referenceResolver: ReferenceResolver;

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string | number {
    // Parse: condition:trueValue:falseValue
    const parts = content.split(":").map((p) => p.trim());

    if (parts.length < 3) {
      throw new NotationError(
        "IF requires three parts: condition, trueValue, falseValue",
        `IF:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    const conditionRef = parts[0] ?? "";
    const trueValue = parts.slice(1, -1).join(":"); // In case trueValue contains colons
    const falseValue = parts[parts.length - 1] ?? "";

    try {
      // Resolve condition
      const condition = this.referenceResolver.resolve(conditionRef, context);
      const isTruthy = this.isTruthy(condition);

      // Process the appropriate value
      const valueToProcess = isTruthy ? trueValue : falseValue;
      return processor.process(valueToProcess, context);
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
   * Determines if a value is truthy
   */
  private isTruthy(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      return value.length > 0;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    // Objects are truthy
    return true;
  }
}
