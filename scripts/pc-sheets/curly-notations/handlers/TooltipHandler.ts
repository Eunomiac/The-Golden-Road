import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";
import { extractFirstTopLevelArg } from "../utils/splitTopLevel";
import { findDisallowedTags, validateHtmlStructure } from "../utils/htmlValidation";
import { logTooltipDebug } from "../utils/tooltipDebug";

/**
 * Handles {{TOOLTIP:anchor,content}} notation by injecting inline tooltip markup.
 * The anchor text behaves like existing trait labels and the tooltip contents render as raw HTML.
 */
export class TooltipHandler implements NotationHandler {
  name = "TOOLTIP";
  private referenceResolver: ReferenceResolver;
  private static readonly ALLOWED_TAGS = new Set<string>([
    "span",
    "strong",
    "em",
    "b",
    "i",
    "u",
    "small",
    "sub",
    "sup",
    "mark",
    "code",
    "kbd",
    "samp",
    "var",
    "abbr",
    "cite",
    "dfn",
    "q",
    "a",
    "br"
  ]);

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    const {
      anchorExpression,
      tooltipExpression,
      tooltipClasses
    } = this.parseArguments(content, context);

    // Debug: capture parsed TOOLTIP arguments for tracing.
    logTooltipDebug({
      stage: "handler:parsed",
      tooltipContent: `{{TOOLTIP:${content}}}`,
      containerContent: processor.getCurrentContainerSnapshot(),
      metadata: {
        anchorExpression,
        tooltipExpression,
        tooltipClasses,
        contextFile: context.filePath,
        contextLine: context.lineNumber
      }
    });

    // Process anchor text so it can include nested notations.
    const anchorText = this.toString(
      processor.process(anchorExpression, context),
      "TOOLTIP anchor",
      context,
      anchorExpression
    );

    // Debug: document the evaluated anchor text (after nested processing).
    logTooltipDebug({
      stage: "handler:anchor-resolved",
      tooltipContent: anchorText,
      containerContent: processor.getCurrentContainerSnapshot(),
      metadata: { anchorExpression }
    });

    // Resolve tooltip content via reference or nested notation processing.
    const tooltipHtml = this.resolveTooltipContent(
      tooltipExpression,
      context,
      processor
    );

    // Debug: capture the final tooltip HTML content prior to wrapping.
    logTooltipDebug({
      stage: "handler:content-resolved",
      tooltipContent: tooltipHtml,
      containerContent: processor.getCurrentContainerSnapshot(),
      metadata: { tooltipExpression }
    });

    this.validateTooltipHtml(tooltipHtml, context, tooltipExpression);

    const anchorId = this.generateAnchorId();

    const tooltipClassAttr = tooltipClasses.trim().length > 0
      ? tooltipClasses
      : "tooltip";

    const tooltipMarkup = [
      `<span class="has-tooltip" style="anchor-name: --${anchorId};">`,
      anchorText,
      "</span>",
      `<span class="${tooltipClassAttr}" style="position-anchor: --${anchorId};">`,
      tooltipHtml,
      "</span>"
    ].join("");

    // Debug: surface the markup that will replace the placeholder later in the pipeline.
    logTooltipDebug({
      stage: "handler:markup-generated",
      tooltipContent: tooltipMarkup,
      containerContent: processor.getCurrentContainerSnapshot(),
      metadata: {
        anchorId,
        tooltipClasses: tooltipClassAttr
      }
    });

    return processor.registerTooltipReplacement(tooltipMarkup);
  }

  /**
   * Resolves tooltip content, treating references (context/vars/this/json) specially.
   */
  private resolveTooltipContent(
    expression: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    const trimmedExpression = expression.trim();

    if (this.shouldResolveReference(trimmedExpression)) {
      const resolved = this.referenceResolver.resolve(trimmedExpression, context);

      if (typeof resolved !== "string") {
        throw new NotationError(
          "TOOLTIP reference must resolve to a string of raw HTML.",
          `TOOLTIP:${expression}`,
          context.filePath,
          context.lineNumber
        );
      }

      return resolved;
    }

    // Fallback: process nested notations or literal HTML directly.
    return this.toString(
      processor.process(expression, context),
      "TOOLTIP content",
      context,
      expression
    );
  }

  /**
   * Determines whether the tooltip expression should be treated as a reference.
   */
  private shouldResolveReference(expression: string): boolean {
    return expression.startsWith("context.") ||
      expression.startsWith("this.") ||
      expression.startsWith("vars.") ||
      expression.startsWith("json.");
  }

  /**
   * Converts processed values to strings while preserving error context.
   */
  private toString(
    value: string | number,
    description: string,
    context: ProcessingContext,
    expression: string
  ): string {
    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number") {
      return String(value);
    }

    throw new NotationError(
      `${description} must resolve to text.`,
      `TOOLTIP:${expression}`,
      context.filePath,
      context.lineNumber
    );
  }

  /**
   * Generates a stable anchor name compatible with existing tooltip CSS.
   */
  private generateAnchorId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private parseArguments(
    rawContent: string,
    context: ProcessingContext
  ): {
    anchorExpression: string;
    tooltipExpression: string;
    tooltipClasses: string;
  } {
    const firstSplit = extractFirstTopLevelArg(rawContent);
    if (!firstSplit.argument || firstSplit.remainder === null) {
      throw new NotationError(
        "TOOLTIP requires at least anchor and content arguments.",
        `TOOLTIP:${rawContent}`,
        context.filePath,
        context.lineNumber
      );
    }

    const secondSplit = extractFirstTopLevelArg(firstSplit.remainder);

    if (secondSplit.remainder === null) {
      return {
        anchorExpression: firstSplit.argument,
        tooltipExpression: secondSplit.argument,
        tooltipClasses: "tooltip"
      };
    }

    const classList = this.parseClassList(firstSplit.argument);
    if (classList.length === 0) {
      throw new NotationError(
        "TOOLTIP class argument cannot be empty.",
        `TOOLTIP:${rawContent}`,
        context.filePath,
        context.lineNumber
      );
    }

    return {
      anchorExpression: secondSplit.argument,
      tooltipExpression: secondSplit.remainder ?? "",
      tooltipClasses: ["tooltip", ...classList].join(" ")
    };
  }

  private parseClassList(input: string): string[] {
    return input
      .split(/\s+/)
      .map((className) => className.trim())
      .filter((className) => className.length > 0);
  }

  private validateTooltipHtml(
    html: string,
    context: ProcessingContext,
    expression: string
  ): void {
    const structure = validateHtmlStructure(html);
    if (!structure.isValid) {
      throw new NotationError(
        `TOOLTIP content contains malformed HTML: ${structure.message ?? "Unbalanced tags detected."}`,
        `TOOLTIP:${expression}`,
        context.filePath,
        context.lineNumber
      );
    }

    const disallowedTags = findDisallowedTags(html, TooltipHandler.ALLOWED_TAGS);
    if (disallowedTags.length > 0) {
      const snippet = html.length > 0
        ? html.slice(0, Math.min(html.length, 160)) + (html.length > 160 ? "…" : "")
        : undefined;
      const contextDetail = snippet
        ? ` Context: ${snippet}`
        : "";
      throw new NotationError(
        `TOOLTIP content contains disallowed tag(s): ${disallowedTags.join(", ")}.${contextDetail}`,
        `TOOLTIP:${expression}`,
        context.filePath,
        context.lineNumber
      );
    }
  }
}
