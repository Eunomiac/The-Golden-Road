import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";
import { extractFirstTopLevelArg } from "../utils/splitTopLevel";

abstract class BaseIfMembershipHandler implements NotationHandler {
  protected referenceResolver: ReferenceResolver;
  abstract name: string;

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  protected abstract shouldRender(matches: boolean): boolean;

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    const parsed = this.extractArguments(content, context);
    const rawNeedle = processor.process(parsed.needleExpression, context);
    const needleValue = this.normalizeNeedleValue(rawNeedle);
    const haystackValue = this.referenceResolver.resolve(parsed.haystackExpression, context);

    const containsNeedle = this.checkMembership(
      needleValue,
      haystackValue,
      parsed.haystackExpression,
      content,
      context
    );

    if (!this.shouldRender(containsNeedle) || parsed.renderableContent.length === 0) {
      return "";
    }

    return processor.process(parsed.renderableContent, context);
  }

  private extractArguments(
    content: string,
    context: ProcessingContext
  ): {
    needleExpression: string;
    haystackExpression: string;
    renderableContent: string;
  } {
    const { argument: needleExpression, remainder: afterNeedle } = extractFirstTopLevelArg(content);

    if (!needleExpression) {
      throw new NotationError(
        `${this.name} requires a needle argument before the first comma.`,
        `${this.name}:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    if (afterNeedle === null) {
      throw new NotationError(
        `${this.name} requires a haystack argument after the needle.`,
        `${this.name}:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    const { argument: haystackExpression, remainder: trailingContent } = extractFirstTopLevelArg(afterNeedle);

    if (!haystackExpression) {
      throw new NotationError(
        `${this.name} requires a haystack argument following the needle.`,
        `${this.name}:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    return {
      needleExpression,
      haystackExpression,
      renderableContent: trailingContent ?? ""
    };
  }

  /**
   * Determines whether the haystack contains the provided needle.
   */
  private checkMembership(
    needle: string | number | boolean,
    haystack: unknown,
    haystackExpression: string,
    fullNotation: string,
    context: ProcessingContext
  ): boolean {
    if (Array.isArray(haystack)) {
      return haystack.some((entry) => entry === needle);
    }

    if (haystack && typeof haystack === "object") {
      const key = this.toKeyString(needle, haystackExpression, fullNotation, context);
      return Object.prototype.hasOwnProperty.call(haystack as Record<string, unknown>, key);
    }

    throw new NotationError(
      `${this.name} haystack '${haystackExpression}' must resolve to an array or object (received ${typeof haystack}).`,
      `${this.name}:${fullNotation}`,
      context.filePath,
      context.lineNumber
    );
  }

  /**
   * Converts the needle to a string key for object lookups.
   */
  private toKeyString(
    needle: string | number | boolean,
    haystackExpression: string,
    fullNotation: string,
    context: ProcessingContext
  ): string {
    if (needle === null || needle === undefined) {
      throw new NotationError(
        `${this.name} needle cannot be null or undefined when matching object keys.`,
        `${this.name}:${fullNotation}`,
        context.filePath,
        context.lineNumber,
        `Haystack reference: ${haystackExpression}`
      );
    }

    if (typeof needle === "string") {
      return needle;
    }

    if (typeof needle === "number" || typeof needle === "boolean") {
      return String(needle);
    }

    throw new NotationError(
      `${this.name} needle must resolve to a string, number, or boolean when matching object keys.`,
      `${this.name}:${fullNotation}`,
      context.filePath,
      context.lineNumber,
      `Resolved needle type: ${typeof needle}`
    );
  }

  /**
   * Normalizes the evaluated needle into a comparable primitive.
   */
  private normalizeNeedleValue(value: unknown): string | number | boolean {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  }
}

/**
 * Handles {{IFIN:<needle>,<haystack>,<content>}} notation.
 */
export class IfInHandler extends BaseIfMembershipHandler {
  public name = "IFIN";

  protected shouldRender(matches: boolean): boolean {
    return matches;
  }
}

/**
 * Handles {{IFNOTIN:<needle>,<haystack>,<content>}} notation.
 */
export class IfNotInHandler extends BaseIfMembershipHandler {
  public name = "IFNOTIN";

  protected shouldRender(matches: boolean): boolean {
    return !matches;
  }
}
