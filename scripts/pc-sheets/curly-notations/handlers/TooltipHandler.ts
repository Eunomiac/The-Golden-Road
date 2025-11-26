import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";
import { extractFirstTopLevelArg } from "../utils/splitTopLevel";
import { findDisallowedTags, validateHtmlStructure } from "../utils/htmlValidation";
import { logTooltipDebug } from "../utils/tooltipDebug";
import { resolveBookTitle } from "../utils/bookMap";

interface TooltipCitationDescriptor {
  book: string;
  page: string | number;
}

interface StructuredTooltipDescriptor {
  format?: string | string[];
  title?: string;
  subtitle?: string;
  blocks?: string[];
  citation?: TooltipCitationDescriptor;
  source?: TooltipCitationDescriptor;
}

interface TooltipContentResult {
  html: string;
  extraClasses: string[];
}

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
    "br",
    "ul",
    "ol",
    "li",
    "img"
  ]);

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    try {
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
    const {
      html: tooltipHtml,
      extraClasses: tooltipExtraClasses
    } = this.resolveTooltipContent(
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

    const tooltipClassAttr = this.mergeClassNames(tooltipClasses, tooltipExtraClasses);

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
    } catch (error) {
      // Log the error to console instead of stopping the build
      const errorMessage = error instanceof Error ? error.message : String(error);
      const locationInfo = context.filePath
        ? `${context.filePath}${context.lineNumber ? `:${context.lineNumber}` : ""}`
        : "unknown location";

      console.error(`[TOOLTIP Error] ${locationInfo} - ${errorMessage}`);
      console.error(`  Full notation: {{TOOLTIP:${content}}}`);

      // Return just the anchor text as a fallback
      return this.extractFallbackAnchor(content, context, processor);
    }
  }

  /**
   * Resolves tooltip content, treating references (context/vars/this/json) specially.
   */
  private resolveTooltipContent(
    expression: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): TooltipContentResult {
    const trimmedExpression = expression.trim();

    if (this.shouldResolveReference(trimmedExpression)) {
      const resolved = this.referenceResolver.resolve(trimmedExpression, context);

      if (typeof resolved === "string") {
        return {
          html: resolved,
          extraClasses: []
        };
      }

      if (this.isStructuredTooltipDescriptor(resolved)) {
        return this.formatStructuredTooltip(resolved, context, processor);
      }

      throw new NotationError(
        "TOOLTIP reference must resolve to a string of raw HTML or a structured tooltip object (title/subtitle/blocks/citation).",
        `TOOLTIP:${expression}`,
        context.filePath,
        context.lineNumber
      );
    }

    // Fallback: process nested notations or literal HTML directly.
    return {
      html: this.toString(
      processor.process(expression, context),
      "TOOLTIP content",
      context,
      expression
      ),
      extraClasses: []
    };
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

  private isStructuredTooltipDescriptor(value: unknown): value is StructuredTooltipDescriptor {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const descriptor = value as Record<string, unknown>;
    return this.isNonEmptyString(descriptor.title) ||
      this.isNonEmptyString(descriptor.subtitle) ||
      Array.isArray(descriptor.blocks) ||
      this.isNonEmptyString(descriptor.format) ||
      Array.isArray(descriptor.format) ||
      this.isTooltipCitationDescriptor(descriptor.citation) ||
      this.isTooltipCitationDescriptor(descriptor.source);
  }

  private isTooltipCitationDescriptor(value: unknown): value is TooltipCitationDescriptor {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const record = value as Record<string, unknown>;
    if (!this.isNonEmptyString(record.book)) {
      return false;
    }

    const page = record.page;
    if (typeof page !== "string" && typeof page !== "number") {
      return false;
    }

    return true;
  }

  private formatStructuredTooltip(
    descriptor: StructuredTooltipDescriptor,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): TooltipContentResult {
    const segments: string[] = [];

    if (this.isNonEmptyString(descriptor.title)) {
      segments.push(
        `<span class="tooltip-title">${this.processSegment(descriptor.title, context, processor)}</span>`
      );
    }

    if (this.isNonEmptyString(descriptor.subtitle)) {
      segments.push(
        `<span class="tooltip-subtitle">${this.processSegment(descriptor.subtitle, context, processor)}</span>`
      );
    }

    if (Array.isArray(descriptor.blocks)) {
      for (const block of descriptor.blocks) {
        if (this.isNonEmptyString(block)) {
          segments.push(
            `<span class="tooltip-block">${this.processSegment(block, context, processor)}</span>`
          );
        }
      }
    }

    const citationDescriptor = this.resolveCitationDescriptor(descriptor);
    if (citationDescriptor) {
      segments.push(this.formatTooltipCitation(citationDescriptor));
    }

    return {
      html: segments.join(""),
      extraClasses: this.extractFormatClasses(descriptor.format)
    };
  }

  private resolveCitationDescriptor(
    descriptor: StructuredTooltipDescriptor
  ): TooltipCitationDescriptor | null {
    if (descriptor.citation && this.isTooltipCitationDescriptor(descriptor.citation)) {
      return descriptor.citation;
    }

    if (descriptor.source && this.isTooltipCitationDescriptor(descriptor.source)) {
      return descriptor.source;
    }

    return null;
  }

  private extractFormatClasses(formatField: string | string[] | undefined): string[] {
    if (!formatField) {
      return [];
    }

    const classes: string[] = [];
    const register = (token: string): void => {
      const trimmed = token.trim();
      if (trimmed.length === 0 || classes.includes(trimmed)) {
        return;
      }
      classes.push(trimmed);
    };

    if (typeof formatField === "string") {
      formatField.split(/\s+/).forEach(register);
      return classes;
    }

    formatField.forEach((entry) => {
      if (typeof entry === "string") {
        entry.split(/\s+/).forEach(register);
      }
    });

    return classes;
  }

  private formatTooltipCitation(citation: TooltipCitationDescriptor): string {
    const bookTitle = resolveBookTitle(citation.book);
    const pageText = typeof citation.page === "number"
      ? citation.page.toString(10)
      : citation.page;

    return `<span class="tooltip-block tooltip-citation"><span class="source-citation"><span class="source-title">${bookTitle}</span><span class="source-page">p.${pageText}</span></span></span>`;
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

  private mergeClassNames(baseClasses: string, extraClasses: string[]): string {
    const uniqueClasses: string[] = [];

    const registerClasses = (classes: string[]): void => {
      for (const className of classes) {
        if (uniqueClasses.includes(className)) {
          continue;
        }
        uniqueClasses.push(className);
      }
    };

    const normalizedBase = baseClasses
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    const normalizedExtra = extraClasses
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    registerClasses(normalizedBase);
    registerClasses(normalizedExtra);

    return uniqueClasses.length > 0
      ? uniqueClasses.join(" ")
      : "tooltip";
  }

  /**
   * Extracts just the anchor text as a fallback when tooltip processing fails.
   * Returns the first parameter if it's not a CSS class, otherwise returns the second parameter.
   */
  private extractFallbackAnchor(
    rawContent: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    try {
      const firstSplit = extractFirstTopLevelArg(rawContent);

      // If we can't parse arguments at all, return empty string
      if (!firstSplit.argument || firstSplit.remainder === null) {
        return "";
      }

      const secondSplit = extractFirstTopLevelArg(firstSplit.remainder);

      // If there's only two arguments (anchor and content), use the first as anchor
      if (secondSplit.remainder === null) {
        try {
          const processed = processor.process(firstSplit.argument, context);
          return String(processed);
        } catch {
          // If processing fails, return the raw expression
          return firstSplit.argument;
        }
      }

      // If there are three arguments, the first is CSS classes, second is anchor
      try {
        const processed = processor.process(secondSplit.argument, context);
        return String(processed);
      } catch {
        // If processing fails, return the raw expression
        return secondSplit.argument;
      }
    } catch {
      // If all parsing fails, return empty string
      return "";
    }
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }

  private processSegment(
    segment: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    const trimmed = segment.trim();
    if (!trimmed.includes("{{")) {
      return segment;
    }

    return processor.process(segment, context);
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
