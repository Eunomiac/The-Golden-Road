import type { ProcessingContext } from "./ProcessingContext";
import type { NotationHandler } from "./NotationHandler";
import { ReferenceResolver } from "./ReferenceResolver";
import { NotationError } from "./NotationError";
import {
  NameHandler,
  PronounHandler,
  BreakHandler,
  ValueHandler,
  NameValueHandler,
  SourceHandler,
  CalcHandler,
  DisplayHandler,
  InlineListHandler,
  RawHandler,
  IfHandler
} from "./handlers";

/**
 * Main processor for curly notations
 */
export class CurlyNotationProcessor {
  private strict: boolean;
  private notationHandlers: Map<string, NotationHandler>;
  private referenceResolver: ReferenceResolver;

  constructor(strict: boolean = true) {
    this.strict = strict;
    this.notationHandlers = new Map();
    this.referenceResolver = new ReferenceResolver();

    // Register built-in handlers
    this.registerDefaultHandlers();
  }

  /**
   * Processes a text string, replacing all curly notations
   */
  process(text: string, context: ProcessingContext): string {
    // Ensure strict mode is set from context
    const effectiveStrict = context.strict !== undefined ? context.strict : this.strict;
    const processingContext: ProcessingContext = {
      ...context,
      strict: effectiveStrict
    };

    const pattern = /\{\{([^{}]+)\}\}/;
    let result = text;
    let match;

    // Loop until no more notations found
    while ((match = pattern.exec(result)) !== null) {
      const fullMatch = match[0];  // e.g., "{{VALUE:athletics}}"
      const content = match[1];    // e.g., "VALUE:athletics"
      const matchIndex = match.index;

      try {
        // Process the notation
        const processed = this.processNotation(content, processingContext);

        // Replace at specific position
        result = result.substring(0, matchIndex) +
                 String(processed) +
                 result.substring(matchIndex + fullMatch.length);
      } catch (error) {
        if (error instanceof NotationError) {
          if (effectiveStrict) {
            throw error;
          } else {
            // Replace with inline error
            const errorHtml = error.toInlineError();
            result = result.substring(0, matchIndex) +
                     errorHtml +
                     result.substring(matchIndex + fullMatch.length);
          }
        } else {
          // Re-throw non-NotationError errors
          throw error;
        }
      }

      // Reset regex to start from beginning (string changed)
      pattern.lastIndex = 0;
    }

    return result;
  }

  /**
   * Processes a single notation (content after {{ and before }})
   */
  private processNotation(content: string, context: ProcessingContext): string | number {
    const trimmed = content.trim();

    // Check for pronoun notations (lowercase, special case)
    const pronounPattern = /^(he|his|him|himself|he's)$/i;
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
      // Otherwise, treat as a curly reference
      return this.processReference(trimmed, context);
    }

    const notationName = trimmed.substring(0, colonIndex).trim().toUpperCase();
    const notationContent = trimmed.substring(colonIndex + 1).trim();

    const handler = this.notationHandlers.get(notationName);
    if (handler) {
      return handler.process(notationContent, context, this);
    }

    // Not a known notation, treat as a curly reference
    return this.processReference(trimmed, context);
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
    this.registerNotation("DISPLAY", new DisplayHandler(this.referenceResolver));
    this.registerNotation("INLINELIST", new InlineListHandler(this.referenceResolver));
    this.registerNotation("RAW", new RawHandler(this.referenceResolver));
    this.registerNotation("IF", new IfHandler(this.referenceResolver));
  }
}
