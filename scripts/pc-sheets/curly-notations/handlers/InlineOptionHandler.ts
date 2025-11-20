import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";
import { splitTopLevelArgs } from "../utils/splitTopLevel";

/**
 * Handles {{INLINEOPTION:<source>}} notation.
 * Returns the processed option text for a single keyword.
 */
export class InlineOptionHandler implements NotationHandler {
  name = "INLINEOPTION";
  private referenceResolver: ReferenceResolver;

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    const segments = splitTopLevelArgs(content);
    if (segments.length === 0) {
      throw new NotationError(
        "INLINEOPTION requires a single option source.",
        `INLINEOPTION:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    if (segments.length > 1) {
      throw new NotationError(
        "INLINEOPTION accepts exactly one argument.",
        `INLINEOPTION:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    const keyword = this.resolveKeyword(segments[0], context);
    const options = this.extractOptionsMap(context);
    const template = options[keyword];

    if (typeof template !== "string") {
      throw new NotationError(
        `INLINEOPTION keyword '${keyword}' is not defined for this entity.`,
        `INLINEOPTION:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    return processor.process(template, context);
  }

  private resolveKeyword(segment: string, context: ProcessingContext): string {
    const trimmed = segment.trim();
    if (trimmed.length === 0) {
      throw new NotationError(
        "INLINEOPTION argument cannot be empty.",
        "INLINEOPTION",
        context.filePath,
        context.lineNumber
      );
    }

    const isDoubleQuoted = trimmed.startsWith("\"") && trimmed.endsWith("\"");
    const isSingleQuoted = trimmed.startsWith("'") && trimmed.endsWith("'");
    if (isDoubleQuoted || isSingleQuoted) {
      return trimmed.slice(1, -1);
    }

    try {
      const resolved = this.referenceResolver.resolve(trimmed, context);
      if (resolved === null || resolved === undefined) {
        throw new NotationError(
          "INLINEOPTION reference resolved to null/undefined.",
          trimmed,
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
        `Unable to resolve INLINEOPTION reference '${trimmed}'.`,
        trimmed,
        context.filePath,
        context.lineNumber,
        error instanceof Error ? error.message : undefined
      );
    }
  }

  private extractOptionsMap(
    context: ProcessingContext
  ): Record<string, string> {
    const options = context.thisEntity?.options;
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new NotationError(
        "INLINEOPTION requires the current entity to define an 'options' map.",
        "INLINEOPTION",
        context.filePath,
        context.lineNumber
      );
    }
    return options as Record<string, string>;
  }
}
