import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";

/**
 * Handles {{VALUE:<curlyreference>[:<default>]}} notation
 */
export class ValueHandler implements NotationHandler {
  name = "VALUE";
  private referenceResolver: ReferenceResolver;

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string | number {
    // Parse content: may have default value after colon
    const parts = content.split(":");
    const reference = parts[0]?.trim() ?? "";
    const defaultValue = parts[1]?.trim();

    try {
      const resolved = this.referenceResolver.resolve(reference, context);

      // If it's a number, return it directly
      if (typeof resolved === "number") {
        return resolved;
      }

      // If it's an object, extract value
      if (typeof resolved === "object" && resolved !== null && !Array.isArray(resolved)) {
        return this.extractValue(resolved as Record<string, unknown>, reference, context, defaultValue);
      }

      // If we have a default, use it
      if (defaultValue !== undefined) {
        const defaultNum = Number(defaultValue);
        if (!isNaN(defaultNum)) {
          return defaultNum;
        }
        return defaultValue;
      }

      throw new NotationError(
        `Cannot extract value from reference: ${reference}`,
        `VALUE:${content}`,
        context.filePath,
        context.lineNumber,
        `Resolved type: ${typeof resolved}`
      );
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
   * Extracts numeric value from an object
   */
  private extractValue(
    obj: Record<string, unknown>,
    reference: string,
    context: ProcessingContext,
    defaultValue?: string
  ): number {
    // Check if entity.value is a number
    if ("value" in obj && typeof obj.value === "number") {
      return obj.value;
    }

    // Check nested value property
    if ("value" in obj && typeof obj.value === "object" && obj.value !== null) {
      const valueObj = obj.value as Record<string, unknown>;

      // Check in order: total, value, base, min
      if ("total" in valueObj && typeof valueObj.total === "number") {
        return valueObj.total;
      }
      if ("value" in valueObj && typeof valueObj.value === "number") {
        return valueObj.value;
      }
      if ("base" in valueObj && typeof valueObj.base === "number") {
        return valueObj.base;
      }
      if ("min" in valueObj && typeof valueObj.min === "number") {
        return valueObj.min;
      }
    } else {
      // Check direct properties
      if ("total" in obj && typeof obj.total === "number") {
        return obj.total;
      }
      if ("value" in obj && typeof obj.value === "number") {
        return obj.value;
      }
      if ("base" in obj && typeof obj.base === "number") {
        return obj.base;
      }
      if ("min" in obj && typeof obj.min === "number") {
        return obj.min;
      }
    }

    // No value found
    if (defaultValue !== undefined) {
      const defaultNum = Number(defaultValue);
      if (!isNaN(defaultNum)) {
        return defaultNum;
      }
    }

    throw new NotationError(
      `Cannot extract numeric value from reference: ${reference}`,
      `VALUE:${reference}`,
      context.filePath,
      context.lineNumber,
      "Value extraction failed"
    );
  }
}
