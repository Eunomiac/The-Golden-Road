import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";
import { splitTopLevelArgs } from "../utils/splitTopLevel";

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
    const segments = splitTopLevelArgs(content);
    const referencePart = segments.shift() ?? "";
    const options = this.parseOptions(segments);

    const { reference: rawReference, defaultValue: rawDefault } = this.parseReferenceAndDefault(referencePart);

    const reference = this.evaluateArgument(rawReference, processor, context);
    const defaultValue = rawDefault ? this.evaluateArgument(rawDefault, processor, context) : undefined;

    if (reference.length === 0) {
      throw new NotationError(
        "VALUE requires a reference argument.",
        `VALUE:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    try {
      const resolved = this.referenceResolver.resolve(reference, context);
      const numericValue = this.coerceToNumber(resolved, reference, context, defaultValue, options);
      return options.signed ? this.formatSignedNumber(numericValue) : numericValue;

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
  private parseReferenceAndDefault(referencePart: string): { reference: string; defaultValue?: string } {
    let depth = 0;

    for (let i = 0; i < referencePart.length; i++) {
      const char = referencePart[i];
      const next = referencePart[i + 1];

      if (char === "{" && next === "{") {
        depth += 1;
        i += 1;
        continue;
      }

      if (char === "}" && next === "}") {
        depth = Math.max(depth - 1, 0);
        i += 1;
        continue;
      }

      if (char === ":" && depth === 0) {
        const reference = referencePart.slice(0, i).trim();
        const defaultValue = referencePart.slice(i + 1).trim();
        return {
          reference,
          defaultValue: defaultValue.length > 0 ? defaultValue : undefined
        };
      }
    }

    return {
      reference: referencePart.trim()
    };
  }

  private coerceToNumber(
    resolved: unknown,
    reference: string,
    context: ProcessingContext,
    defaultValue: string | undefined,
    options: { signed: boolean; base: boolean }
  ): number {
    if (typeof resolved === "number") {
      return resolved;
    }

    if (typeof resolved === "object" && resolved !== null && !Array.isArray(resolved)) {
      return this.extractValue(resolved as Record<string, unknown>, reference, context, defaultValue, options);
    }

    if (defaultValue !== undefined) {
      const defaultNum = Number(defaultValue);
      if (!Number.isNaN(defaultNum)) {
        return defaultNum;
      }
    }

    throw new NotationError(
      `Cannot extract value from reference: ${reference}`,
      `VALUE:${reference}`,
      context.filePath,
      context.lineNumber,
      `Resolved type: ${typeof resolved}`
    );
  }

  private extractValue(
    obj: Record<string, unknown>,
    reference: string,
    context: ProcessingContext,
    defaultValue: string | undefined,
    options: { signed: boolean; base: boolean }
  ): number {
    // Check if entity.value is a number
    if ("value" in obj && typeof obj.value === "number") {
      return obj.value;
    }

    // Check nested value property
    if ("value" in obj && typeof obj.value === "object" && obj.value !== null) {
      const valueObj = obj.value as Record<string, unknown>;

      // Check in order: total, value, base, min
      if (options.base) {
        if ("base" in valueObj && typeof valueObj.base === "number") {
          return valueObj.base;
        }
      }

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
      if (options.base) {
        if ("base" in obj && typeof obj.base === "number") {
          return obj.base;
        }
      }

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
      if (!Number.isNaN(defaultNum)) {
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

  private parseOptions(optionTokens: string[]): { signed: boolean; base: boolean } {
    const normalizedTokens = optionTokens
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 0);

    return {
      signed: normalizedTokens.includes("signed"),
      base: normalizedTokens.includes("base")
    };
  }

  private formatSignedNumber(value: number): string {
    if (value < 0) {
      return `−${Math.abs(value)}`;
    }
    return `+${value}`;
  }

  private evaluateArgument(
    argument: string,
    processor: CurlyNotationProcessor,
    context: ProcessingContext
  ): string {
    const trimmed = argument.trim();
    if (trimmed.length === 0) {
      return "";
    }

    if (!trimmed.includes("{{")) {
      return trimmed;
    }

    const evaluated = processor.process(trimmed, context, { finalizeTooltips: false });
    return evaluated.trim();
  }
}
