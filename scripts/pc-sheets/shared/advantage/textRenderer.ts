import { CurlyNotationProcessor } from "../../curly-notations/CurlyNotationProcessor";
import type { ProcessingContext } from "../../curly-notations/ProcessingContext";

export interface TextRenderOptions {
  wrap?: boolean;
  prefix?: string;
}

export class AdvantageTextRenderer {
  private notationProcessor: CurlyNotationProcessor;

  constructor() {
    this.notationProcessor = new CurlyNotationProcessor(true);
  }

  process(
    value: string | undefined,
    context: ProcessingContext,
    options?: TextRenderOptions
  ): string | undefined {
    if (typeof value !== "string" || value.trim().length === 0) {
      return value;
    }

    const processed = this.notationProcessor.process(
      value,
      context,
      { finalizeTooltips: false }
    );

    const wrapped = options?.wrap === false
      ? processed
      : this.wrapParagraphs(processed, options?.prefix);

    return this.notationProcessor.finalizeTooltipPlaceholders(
      wrapped,
      context
    ) ?? wrapped ?? processed;
  }

  private wrapParagraphs(
    text: string,
    prefix?: string
  ): string {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return text;
    }

    let normalized = trimmed;

    const startsWithParagraph = /^<p[\s>]/i.test(normalized);
    if (!startsWithParagraph) {
      normalized = `<p>${normalized}</p>`;
    }

    if (prefix) {
      normalized = normalized.replace(
        /<p([^>]*)>/i,
        (_match, group) => `<p${group ?? ""}><strong>${prefix}</strong> `
      );
    }

    normalized = normalized
      .replace(/<p>\s*<p>/gi, "<p>")
      .replace(/<\/p>\s*<\/p>/gi, "</p>")
      .replace(/<\/p>\s*<p>/gi, "</p><p>");

    return normalized;
  }
}
