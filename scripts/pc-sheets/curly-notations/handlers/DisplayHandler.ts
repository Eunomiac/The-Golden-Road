import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";

/**
 * Handles {{DISPLAY:<curlyreference>,DisplayFormat,...OptionalClasses}} notation
 */
export class DisplayHandler implements NotationHandler {
  name = "DISPLAY";
  private referenceResolver: ReferenceResolver;

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    const parts = content.split(",").map((p) => p.trim());
    const reference = parts[0] ?? "";
    const format = parts[1] ?? "none";
    const classes = parts.slice(2);

    try {
      const resolved = this.referenceResolver.resolve(reference, context);
      let text: string;

      if (typeof resolved === "string") {
        text = resolved;
      } else if (typeof resolved === "object" && resolved !== null) {
        // Get display name using same logic as NAMEVALUE
        const entity = resolved as Record<string, unknown>;
        if ("display" in entity && typeof entity.display === "string") {
          text = entity.display;
        } else if ("name" in entity && typeof entity.name === "string") {
          text = entity.name;
        } else {
          throw new NotationError(
            "Cannot derive display text from object",
            `DISPLAY:${reference}`,
            context.filePath,
            context.lineNumber
          );
        }
        // Recursively process if it contains notations
        text = processor.process(text, context);
      } else {
        text = String(resolved);
      }

      // Apply formatting
      const formatted = this.applyFormat(text, format);

      // Wrap in span with classes if provided
      if (classes.length > 0) {
        return `<span class='${classes.join(" ")}'>${formatted}</span>`;
      }

      return formatted;
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
   * Applies formatting to text
   */
  private applyFormat(text: string, format: string): string {
    switch (format.toLowerCase()) {
      case "proper":
        return this.toTitleCase(text);
      case "capitalize":
        return text.charAt(0).toUpperCase() + text.slice(1);
      case "upper":
        return text.toUpperCase();
      case "lower":
        return text.toLowerCase();
      case "none":
      default:
        return text;
    }
  }

  /**
   * Converts text to title case (capitalize first letter of each word,
   * except articles/prepositions/conjunctions unless first word)
   */
  private toTitleCase(text: string): string {
    const articles = ["a", "an", "the"];
    const prepositions = ["of", "in", "on", "at", "to", "for", "with", "by"];
    const conjunctions = ["and", "or", "but", "nor", "so", "yet"];
    const skipWords = new Set([...articles, ...prepositions, ...conjunctions]);

    const words = text.split(/\s+/);
    return words
      .map((word, index) => {
        // Preserve existing capitalization (assume it's intentional)
        if (word !== word.toLowerCase()) {
          return word;
        }

        const lowerWord = word.toLowerCase();
        if (index === 0 || !skipWords.has(lowerWord)) {
          return word.charAt(0).toUpperCase() + word.slice(1);
        }
        return word;
      })
      .join(" ");
  }
}
