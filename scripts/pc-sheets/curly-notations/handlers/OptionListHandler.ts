import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";
import { splitTopLevelArgs } from "../utils/splitTopLevel";

/**
 * Handles {{OPTIONLIST:<sources>}} notation.
 * Builds a <ul> where each <li> is pulled from thisEntity.options[key].
 */
export class OptionListHandler implements NotationHandler {
  name = "OPTIONLIST";
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
        "OPTIONLIST requires at least one option source.",
        `OPTIONLIST:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    const keywords: string[] = [];
    for (const segment of segments) {
      const value = this.resolveSegment(segment, context);
      this.collectKeywords(value, keywords, segment, context, content);
    }

    if (keywords.length === 0) {
      throw new NotationError(
        "OPTIONLIST did not resolve any option keywords.",
        `OPTIONLIST:${content}`,
        context.filePath,
        context.lineNumber
      );
    }

    const options = this.extractOptionsMap(context);
    const renderedItems = keywords
      .map((keyword) => {
        if (!(keyword in options)) {
          throw new NotationError(
            `OPTIONLIST option '${keyword}' is not defined for this entity.`,
            `OPTIONLIST:${content}`,
            context.filePath,
            context.lineNumber
          );
        }

        const template = options[keyword];
        if (template === undefined) {
          throw new NotationError(
            `OPTIONLIST option '${keyword}' is not defined for this entity.`,
            `OPTIONLIST:${content}`,
            context.filePath,
            context.lineNumber
          );
        }

        if (template === null) {
          return null;
        }

        if (typeof template !== "string") {
          throw new NotationError(
            `OPTIONLIST option '${keyword}' must be a string template or null.`,
            `OPTIONLIST:${content}`,
            context.filePath,
            context.lineNumber
          );
        }
        const rendered = processor.process(template, context);
        return `<li>${rendered}</li>`;
      })
      .filter((item): item is string => item !== null);

    return `<ul class="option-list">${renderedItems.join("")}</ul>`;
  }

  private resolveSegment(segment: string, context: ProcessingContext): unknown {
    const trimmed = segment.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    const isDoubleQuoted = trimmed.startsWith("\"") && trimmed.endsWith("\"");
    const isSingleQuoted = trimmed.startsWith("'") && trimmed.endsWith("'");
    if (isDoubleQuoted || isSingleQuoted) {
      return trimmed.slice(1, -1);
    }

    return this.referenceResolver.resolve(trimmed, context);
  }

  private collectKeywords(
    value: unknown,
    keywords: string[],
    segment: string,
    context: ProcessingContext,
    fullContent: string
  ): void {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => this.collectKeywords(entry, keywords, segment, context, fullContent));
      return;
    }

    if (typeof value === "string") {
      value
        .split(",")
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .forEach((token) => keywords.push(token));
      return;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      keywords.push(String(value));
      return;
    }

    throw new NotationError(
      `OPTIONLIST source '${segment}' must resolve to a string or array.`,
      `OPTIONLIST:${fullContent}`,
      context.filePath,
      context.lineNumber
    );
  }

  private extractOptionsMap(
    context: ProcessingContext
  ): Record<string, string | null | undefined> {
    const options = context.thisEntity?.options;
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new NotationError(
        "OPTIONLIST requires the current entity to define an 'options' map.",
        "OPTIONLIST",
        context.filePath,
        context.lineNumber
      );
    }
    return options as Record<string, string | null | undefined>;
  }
}
