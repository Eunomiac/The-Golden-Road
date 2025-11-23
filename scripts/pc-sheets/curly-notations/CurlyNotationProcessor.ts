import type { ProcessingContext } from "./ProcessingContext";
import type { NotationHandler } from "./NotationHandler";
import { ReferenceResolver } from "./ReferenceResolver";
import { NotationError } from "./NotationError";
import { validateHtmlStructure } from "./utils/htmlValidation";
import type { TooltipLogPayload } from "./utils/tooltipDebug";
import { logTooltipDebug } from "./utils/tooltipDebug";
import {
  NameHandler,
  PronounHandler,
  BreakHandler,
  ValueHandler,
  NameValueHandler,
  SourceHandler,
  CalcHandler,
  MaxHandler,
  MinHandler,
  RoundupHandler,
  RounddownHandler,
  DisplayHandler,
  InlineListHandler,
  RawHandler,
  IfTrueHandler,
  IfFalseHandler,
  IfNaHandler,
  IfInHandler,
  IfNotInHandler,
  SwitchHandler,
  OptionListHandler,
  InlineOptionHandler,
  TooltipHandler,
  UseHandler
} from "./handlers";

/**
 * Main processor for curly notations
 */
export class CurlyNotationProcessor {
  private strict: boolean;
  private notationHandlers: Map<string, NotationHandler>;
  private referenceResolver: ReferenceResolver;
  private tooltipReplacementStack: Array<Array<{ placeholder: string; html: string }>>;
  private tooltipReplacementMap: Map<string, string>;
  private currentContainerSnapshot: string;
  private processingDepth: number;

  constructor(strict: boolean = true) {
    this.strict = strict;
    this.notationHandlers = new Map();
    this.referenceResolver = new ReferenceResolver();
    this.tooltipReplacementStack = [];
    this.tooltipReplacementMap = new Map();
    this.currentContainerSnapshot = "";
    this.processingDepth = 0;

    // Register built-in handlers
    this.registerDefaultHandlers();
  }

  /**
   * Processes a text string, replacing all curly notations
   */
  process(
    text: string,
    context: ProcessingContext,
    options?: { finalizeTooltips?: boolean }
  ): string {
    this.processingDepth += 1;
    const isTopLevelCall = this.processingDepth === 1;
    // Ensure strict mode is set from context
    const effectiveStrict = context.strict !== undefined ? context.strict : this.strict;
    const processingContext: ProcessingContext = {
      ...context,
      strict: effectiveStrict
    };

    const finalizeTooltips = options?.finalizeTooltips !== false;
    const previousSnapshot = this.currentContainerSnapshot;
    this.currentContainerSnapshot = text;

    try {
      const initialSnippet = this.extractTooltipNotation(text);
      this.logTooltipState("process:start", initialSnippet, text, {
        contextFile: processingContext.filePath,
        contextLine: processingContext.lineNumber,
        finalizeTooltips,
        strictMode: effectiveStrict
      });

      this.tooltipReplacementStack.push([]);

      let result = text;
      let searchIndex = 0;

      // Loop until no more notations found
      while (true) {
        const notation = this.findNextNotation(result, searchIndex);
        if (!notation) {
          break;
        }

        const { start, end, content, raw } = notation;

        try {
          // Process the notation
          const processed = this.processNotation(content, processingContext, result, raw);

          // Replace at specific position
          result = result.substring(0, start) +
                   String(processed) +
                   result.substring(end);
          this.currentContainerSnapshot = result;
        } catch (error) {
          if (error instanceof NotationError) {
            if (effectiveStrict) {
              throw error;
            } else {
              // Replace with inline error
              const errorHtml = error.toInlineError();
              result = result.substring(0, start) +
                       errorHtml +
                       result.substring(end);
              this.currentContainerSnapshot = result;
            }
          } else {
            // Re-throw non-NotationError errors
            throw error;
          }
        }

        // Continue scanning from the start of the replacement to catch newly inserted notations
        searchIndex = Math.max(0, start);
      }

      const currentQueue = this.tooltipReplacementStack.pop() ?? [];
      const placeholderCount = currentQueue.length;
      const shouldKeepPlaceholders = this.shouldLeaveTooltipPlaceholders();

      if (placeholderCount > 0) {
        // Debug: show string snapshot before tooltip placeholders are replaced.
        this.logTooltipState(
          "substitution:pre",
          this.collectQueueHtml(currentQueue),
          result,
          { placeholderCount }
        );
      }

      if (!shouldKeepPlaceholders && finalizeTooltips) {
        result = this.applyTooltipReplacements(result, currentQueue);
        this.currentContainerSnapshot = result;

        if (placeholderCount > 0) {
          // Debug: capture the final rendered HTML after tooltip placeholders are applied.
          this.logTooltipState(
            "substitution:post",
            this.extractTooltipMarkup(result),
            result,
            { placeholderCount }
          );
        }
      } else if (placeholderCount > 0) {
        const reason = !finalizeTooltips
          ? "finalizeTooltips=false"
          : "TOOLTIP_DEBUG_PLACEHOLDERS=true";

        // Debug: placeholders remain in the output, so note why they were kept.
        this.logTooltipState(
          "substitution:deferred",
          this.collectQueueHtml(currentQueue),
          result,
          { placeholderCount, reason }
        );
      }

      let processedResult = result;

      if (!finalizeTooltips) {
        // Keep entries in the map for later substitution
        return processedResult;
      }

      processedResult = this.assertNoResidualCurly(processedResult, isTopLevelCall);
      if (isTopLevelCall) {
        processedResult = this.applyGeneralReplacements(processedResult);
        this.assertHtmlValidity(processedResult, processingContext);
      }

      return processedResult;
    } finally {
      this.currentContainerSnapshot = previousSnapshot;
      this.processingDepth -= 1;
    }
  }

  /**
   * Processes a single notation (content after {{ and before }})
   */
  private processNotation(
    content: string,
    context: ProcessingContext,
    containerSnapshot: string,
    rawNotation: string
  ): string | number {
    const trimmed = content.trim();

    // Check for pronoun notations (lowercase, special case)
    const pronounPattern = /^(he|his|hiss|him|himself|he's)$/i;
    const pronounMatch = trimmed.match(pronounPattern);
    if (pronounMatch) {
      const handler = new PronounHandler();
      // Pass the original case to preserve capitalization
      return handler.process(trimmed, context, this);
    }

    // Check for defined notation (uppercase, followed by colon)
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
      // No colon - might be a simple reference or NAME/BR
      const upperTrimmed = trimmed.toUpperCase();
      if (upperTrimmed === "NAME") {
        const handler = new NameHandler();
        return handler.process("", context, this);
      }
      if (upperTrimmed === "BR") {
        const handler = new BreakHandler();
        return handler.process("", context, this);
      }

      const contextSnippet = this.createContextSnippet(containerSnapshot, rawNotation);
      const snippetSuffix = contextSnippet ? ` Context: ${contextSnippet}` : "";
      throw new NotationError(
        `Unsupported naked notation '${trimmed}'. Use explicit handlers such as NAMEVALUE/DISPLAY/VALUE/USE.${snippetSuffix}`,
        trimmed,
        context.filePath,
        context.lineNumber
      );
    }

    const notationName = trimmed.substring(0, colonIndex).trim().toUpperCase();
    const notationContent = trimmed.substring(colonIndex + 1).trim();

    if (notationName === "TOOLTIP") {
      // Debug: record the normalized TOOLTIP expression before dispatching to its handler.
      this.logTooltipState(
        "notation:dispatch",
        rawNotation,
        containerSnapshot,
        {
          contextFile: context.filePath,
          contextLine: context.lineNumber,
          notationContent
        }
      );
    }

    const handler = this.notationHandlers.get(notationName);
    if (handler) {
      return handler.process(notationContent, context, this);
    }

    // Not a known notation, treat as a curly reference
    return this.processReference(trimmed, context);
  }

  /**
   * Registers a tooltip placeholder and defers insertion until post-processing.
   */
  registerTooltipReplacement(html: string): string {
    const currentQueue = this.tooltipReplacementStack[this.tooltipReplacementStack.length - 1];
    if (!currentQueue) {
      return html;
    }

    const placeholder = `@@TOOLTIP-${Math.random().toString(36).substring(2, 15)}@@`;
    currentQueue.push({ placeholder, html });
    this.tooltipReplacementMap.set(placeholder, html);

    // Debug: track each placeholder as it is queued for later substitution.
    this.logTooltipState(
      "placeholder:queued",
      html,
      this.currentContainerSnapshot,
      {
        placeholder,
        queueDepth: currentQueue.length
      }
    );
    return placeholder;
  }

  private applyTooltipReplacements(
    text: string,
    queue: Array<{ placeholder: string; html: string }>
  ): string {
    if (queue.length === 0) {
      return text;
    }

    let result = text;
    for (const { placeholder, html } of queue) {
      // Debug: report each placeholder replacement as it occurs.
      result = result.split(placeholder).join(html);
      this.currentContainerSnapshot = result;
      this.logTooltipState(
        "placeholder:apply",
        html,
        result,
        { placeholder }
      );
      this.tooltipReplacementMap.delete(placeholder);
    }

    queue.length = 0;
    return result;
  }

  finalizeTooltipPlaceholders(
    text: string | undefined,
    context?: ProcessingContext
  ): string | undefined {
    if (typeof text !== "string") {
      // Debug: nothing to finalize when the input is not a string.
      this.logTooltipState(
        "finalize:skipped-non-string",
        "",
        "",
        { valueType: typeof text }
      );
      return text;
    }

    if (this.shouldLeaveTooltipPlaceholders()) {
      // Debug: placeholders are preserved because TOOLTIP_DEBUG_PLACEHOLDERS is enabled.
      const preserved = text;
      this.logTooltipState(
        "finalize:placeholders-preserved",
        this.extractTooltipNotation(preserved),
        preserved
      );
      return preserved;
    }

    const placeholderPattern = /@@TOOLTIP-[a-z0-9]+@@/gi;
    const placeholderMatches = text.match(placeholderPattern) ?? [];
    placeholderPattern.lastIndex = 0;

    this.logTooltipState(
      "finalize:start",
      this.extractTooltipNotation(text),
      text,
      { placeholderCount: placeholderMatches.length }
    );

    let replacementsApplied = 0;
    const replacedText = text.replace(placeholderPattern, (placeholder) => {
      const replacement = this.tooltipReplacementMap.get(placeholder);
      this.logTooltipState(
        "finalize:placeholder",
        replacement ?? placeholder,
        text,
        {
          placeholder,
          hasReplacement: typeof replacement === "string"
        }
      );

      if (replacement) {
        this.tooltipReplacementMap.delete(placeholder);
        replacementsApplied += 1;
        return replacement;
      }
      return placeholder;
    });

    let finalizedText = replacedText;
    finalizedText = this.assertNoResidualCurly(finalizedText, true);
    if (context?.strict !== false) {
      finalizedText = this.applyGeneralReplacements(finalizedText);
    }

    this.logTooltipState(
      "finalize:end",
      this.extractTooltipMarkup(finalizedText),
      finalizedText,
      { replacementsApplied }
    );

    return finalizedText;
  }

  private shouldLeaveTooltipPlaceholders(): boolean {
    return typeof process !== "undefined" &&
      !!process.env &&
      process.env.TOOLTIP_DEBUG_PLACEHOLDERS === "true";
  }

  /**
   * Processes a curly reference (not a defined notation)
   */
  private processReference(reference: string, context: ProcessingContext): string {
    try {
      const resolved = this.referenceResolver.resolve(reference, context);

      // Convert to string
      if (typeof resolved === "string") {
        return resolved;
      }
      if (typeof resolved === "number") {
        return String(resolved);
      }
      if (typeof resolved === "object" && resolved !== null) {
        // Try to get a string representation
        if ("display" in resolved && typeof resolved.display === "string") {
          return resolved.display;
        }
        if ("name" in resolved && typeof resolved.name === "string") {
          return resolved.name;
        }
        return JSON.stringify(resolved);
      }

      return String(resolved);
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
   * Provides the current container snapshot so handlers can include it in debug output.
   */
  getCurrentContainerSnapshot(): string {
    return this.currentContainerSnapshot;
  }

  /**
   * Registers a notation handler
   */
  registerNotation(name: string, handler: NotationHandler): void {
    this.notationHandlers.set(name.toUpperCase(), handler);
  }

  /**
   * Registers all default handlers
   */
  private registerDefaultHandlers(): void {
    this.registerNotation("VALUE", new ValueHandler(this.referenceResolver));
    this.registerNotation("NAMEVALUE", new NameValueHandler(this.referenceResolver));
    this.registerNotation("SOURCE", new SourceHandler());
    this.registerNotation("CALC", new CalcHandler());
    this.registerNotation("MAX", new MaxHandler());
    this.registerNotation("MIN", new MinHandler());
    this.registerNotation("ROUNDUP", new RoundupHandler());
    this.registerNotation("ROUNDDOWN", new RounddownHandler());
    this.registerNotation("DISPLAY", new DisplayHandler(this.referenceResolver));
    this.registerNotation("INLINELIST", new InlineListHandler(this.referenceResolver));
    this.registerNotation("RAW", new RawHandler(this.referenceResolver));
    this.registerNotation("IFTRUE", new IfTrueHandler());
    this.registerNotation("IFFALSE", new IfFalseHandler());
    this.registerNotation("IFNA", new IfNaHandler());
    this.registerNotation("IFIN", new IfInHandler(this.referenceResolver));
    this.registerNotation("IFNOTIN", new IfNotInHandler(this.referenceResolver));
    this.registerNotation("SWITCH", new SwitchHandler(this.referenceResolver));
    this.registerNotation("OPTIONLIST", new OptionListHandler(this.referenceResolver));
    this.registerNotation("INLINEOPTION", new InlineOptionHandler(this.referenceResolver));
    this.registerNotation("TOOLTIP", new TooltipHandler(this.referenceResolver));
    this.registerNotation("USE", new UseHandler(this.referenceResolver));
  }

  private assertHtmlValidity(html: string, context?: ProcessingContext): void {
    const validation = validateHtmlStructure(html);
    if (!validation.isValid) {
      const snippetSuffix = validation.contextSnippet
        ? ` Context: ${validation.contextSnippet}`
        : "";
      throw new NotationError(
        `HTML validation failed: ${validation.message ?? "Unbalanced tags detected."}${snippetSuffix}`,
        "HTML_VALIDATION",
        context?.filePath,
        context?.lineNumber
      );
    }
  }

  private applyGeneralReplacements(html: string): string {
    if (typeof html !== "string" || html.length === 0) {
      return html;
    }

    const segments = html.split(/(<[^>]+>)/g);
    const transformed = segments.map((segment) => {
      if (segment.startsWith("<") && segment.endsWith(">")) {
        return segment;
      }
      return this.normalizeTextSegment(segment);
    });

    return transformed.join("");
  }

  private normalizeTextSegment(segment: string): string {
    if (segment.length === 0) {
      return segment;
    }

    let normalized = segment;

    // Replace em-dash variants with a standard em dash surrounded by single spaces.
    normalized = normalized.replace(/\s*--+\s*/g, " — ");

    // Replace visually spaced hyphen-minus with a minus sign.
    normalized = normalized.replace(/\s+-\s+/g, " − ");

    // Replace hyphen-digit sequences following whitespace/opening punctuation with minus sign.
    normalized = normalized.replace(/(^|[\s([{])-(\d)/g, (_match, prefix: string, digit: string) => {
      return `${prefix}−${digit}`;
    });

    return normalized;
  }

  private logTooltipState(
    stage: string,
    tooltipContent: string,
    containerContent: string,
    metadata?: TooltipLogPayload
  ): void {
    logTooltipDebug({
      stage,
      tooltipContent,
      containerContent,
      metadata
    });
  }

  private extractTooltipNotation(text: string): string {
    const pattern = /\{\{[^{}]*TOOLTIP[^{}]*\}\}/i;
    const match = text.match(pattern);
    return match ? match[0] : "";
  }

  private findNextNotation(
    text: string,
    fromIndex: number
  ): { start: number; end: number; content: string; raw: string } | null {
    const length = text.length;

    for (let i = fromIndex; i < length - 1; i++) {
      if (text[i] === "{" && text[i + 1] === "{") {
        let depth = 1;
        let j = i + 2;

        while (j < length - 1) {
          if (text[j] === "{" && text[j + 1] === "{") {
            depth += 1;
            j += 2;
            continue;
          }

          if (text[j] === "}" && text[j + 1] === "}") {
            depth -= 1;
            j += 2;

            if (depth === 0) {
              const raw = text.slice(i, j);
              return {
                start: i,
                end: j,
                raw,
                content: raw.substring(2, raw.length - 2)
              };
            }
            continue;
          }

          j += 1;
        }

        const snippet = text.slice(i, Math.min(length, i + 120));
        throw new NotationError(
          `Unclosed curly notation detected near "${snippet}".`,
          snippet,
          undefined,
          undefined,
          "Parser could not find matching '}}'."
        );
      }
    }

    return null;
  }

  private extractTooltipMarkup(text: string): string {
    const pattern = /<span[^>]*class="[^"]*has-tooltip[^"]*"[^>]*>[\s\S]*?<div[^>]*>[\s\S]*?<\/div>/i;
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
    return this.extractTooltipNotation(text);
  }

  private collectQueueHtml(queue: Array<{ placeholder: string; html: string }>): string {
    if (queue.length === 0) {
      return "";
    }
    return queue.map((entry) => entry.html).join("\n-----\n");
  }

  private createContextSnippet(source: string, target: string): string | null {
    if (typeof source !== "string" || source.length === 0) {
      return null;
    }

    const index = source.indexOf(target);
    const radius = 80;

    if (index === -1) {
      const truncated = source.slice(0, radius * 2);
      return truncated.length < source.length ? `${truncated}…` : truncated;
    }

    const start = Math.max(0, index - radius);
    const end = Math.min(source.length, index + target.length + radius);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < source.length ? "…" : "";
    return `${prefix}${source.slice(start, end)}${suffix}`;
  }

  private assertNoResidualCurly(text: string, enforce: boolean): string {
    if (!enforce) {
      return text;
    }

    if (typeof text === "string" && /\{\{[^{}]+\}\}/.test(text)) {
      const matchIndex = text.indexOf("{{");
      const contextRadius = 80;
      const start = Math.max(0, matchIndex - contextRadius);
      const end = Math.min(text.length, matchIndex + contextRadius);
      const snippet = text.slice(start, end);
      const preview = `${start > 0 ? "…" : ""}${snippet}${end < text.length ? "…" : ""}`;
      throw new NotationError(
        `General replacement attempted before all curly notations were resolved. Context: "${preview}"`,
        "GENERAL_REPLACEMENT",
        undefined,
        undefined,
        `Remaining snippet: ${preview}`
      );
    }
    return text;
  }
}
