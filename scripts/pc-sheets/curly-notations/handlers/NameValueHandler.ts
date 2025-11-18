import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";

/**
 * Handles {{NAMEVALUE:<curlyreference>}} notation
 */
export class NameValueHandler implements NotationHandler {
  name = "NAMEVALUE";
  private referenceResolver: ReferenceResolver;

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    const reference = content.trim();

    try {
      const resolved = this.referenceResolver.resolve(reference, context);

      if (typeof resolved !== "object" || resolved === null) {
        throw new NotationError(
          `NAMEVALUE requires an object, got: ${typeof resolved}`,
          `NAMEVALUE:${reference}`,
          context.filePath,
          context.lineNumber
        );
      }

      const entity = resolved as Record<string, unknown>;
      const displayName = this.getDisplayName(entity, context, processor);
      const value = this.getValue(entity, context);

      return `<strong class='trait-def'>${displayName} (${value})</strong>`;
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
   * Derives display name from entity
   */
  private getDisplayName(
    entity: Record<string, unknown>,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    let displayName: string | undefined;

    if ("display" in entity && typeof entity.display === "string") {
      displayName = entity.display;
    } else if ("name" in entity && typeof entity.name === "string") {
      displayName = entity.name;
    }

    if (!displayName) {
      throw new NotationError(
        "Cannot derive display name: entity has no 'display' or 'name' property",
        "NAMEVALUE",
        context.filePath,
        context.lineNumber
      );
    }

    // Recursively process displayName if it contains notations
    return processor.process(displayName, context);
  }

  /**
   * Derives value from entity and formats with sign
   */
  private getValue(
    entity: Record<string, unknown>,
    context: ProcessingContext
  ): string {
    let value: number | undefined;

    // Check nested value properties
    if ("value" in entity && typeof entity.value === "object" && entity.value !== null) {
      const valueObj = entity.value as Record<string, unknown>;

      if ("total" in valueObj && typeof valueObj.total === "number") {
        value = valueObj.total;
      } else if ("value" in valueObj && typeof valueObj.value === "number") {
        value = valueObj.value;
      } else if (typeof valueObj === "number") {
        value = valueObj;
      } else if ("base" in valueObj && typeof valueObj.base === "number") {
        value = valueObj.base;
      } else if ("min" in valueObj && typeof valueObj.min === "number") {
        value = valueObj.min;
      }
    } else if ("value" in entity && typeof entity.value === "number") {
      value = entity.value;
    } else if ("total" in entity && typeof entity.total === "number") {
      value = entity.total;
    } else if ("base" in entity && typeof entity.base === "number") {
      value = entity.base;
    } else if ("min" in entity && typeof entity.min === "number") {
      value = entity.min;
    }

    if (value === undefined) {
      throw new NotationError(
        "Cannot derive value: entity has no numeric value property",
        "NAMEVALUE",
        context.filePath,
        context.lineNumber
      );
    }

    return this.formatSignedNumber(value);
  }

  /**
   * Formats a number with sign (Unicode minus for negatives)
   */
  private formatSignedNumber(num: number): string {
    if (num < 0) {
      return `−${Math.abs(num)}`; // Unicode minus sign
    } else {
      return `+${num}`;
    }
  }
}
