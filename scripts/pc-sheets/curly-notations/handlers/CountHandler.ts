import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";

/**
 * Handles {{COUNT:<X>}} notation by returning an integer count based on the type of <X>.
 *
 * Type handling:
 * - string: returns the length of the string
 * - number: returns the number rounded to the nearest integer
 * - object: returns the number of key/value pairs
 * - array: returns the length of the array
 * - boolean: returns 1 for true, 0 for false
 * - undefined or null: returns 0
 *
 * This handler never throws an error and gracefully handles all edge cases.
 */
export class CountHandler implements NotationHandler {
  name = "COUNT";
  private referenceResolver: ReferenceResolver;

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): number {
    // Process the content to evaluate any nested notations
    const processed = processor.process(content.trim(), context, { finalizeTooltips: false });

    // Try to get the actual value - first attempt to resolve as a reference
    const value = this.resolveValue(processed, content, context);

    // Count based on the type
    return this.countByType(value);
  }

  /**
   * Attempts to resolve the processed string as a reference, falling back to parsing or using as-is
   */
  private resolveValue(
    processed: string,
    originalContent: string,
    context: ProcessingContext
  ): unknown {
    // If the processed result is empty, return empty string
    if (processed.length === 0) {
      return "";
    }

    // Try to resolve as a reference first
    try {
      const resolved = this.referenceResolver.resolve(processed, context);
      return resolved;
    } catch {
      // If resolution fails, continue to other methods
    }

    // Try to parse as JSON (handles arrays and objects)
    try {
      const parsed = JSON.parse(processed);
      return parsed;
    } catch {
      // If JSON parsing fails, continue to other methods
    }

    // Try to parse as a number
    const numericValue = Number(processed);
    if (!Number.isNaN(numericValue) && Number.isFinite(numericValue)) {
      return numericValue;
    }

    // Try to parse as boolean
    const lowerProcessed = processed.toLowerCase().trim();
    if (lowerProcessed === "true") {
      return true;
    }
    if (lowerProcessed === "false") {
      return false;
    }

    // Default: treat as string
    return processed;
  }

  /**
   * Counts the value based on its type, always returning an integer
   */
  private countByType(value: unknown): number {
    // Handle null and undefined
    if (value === null || value === undefined) {
      return 0;
    }

    // Handle boolean
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }

    // Handle number
    if (typeof value === "number") {
      return Math.round(value);
    }

    // Handle string
    if (typeof value === "string") {
      return value.length;
    }

    // Handle array
    if (Array.isArray(value)) {
      return value.length;
    }

    // Handle object (but not null, which we already handled)
    if (typeof value === "object" && value !== null) {
      return Object.keys(value).length;
    }

    // Fallback: should never reach here, but return 0 to be safe
    return 0;
  }
}
