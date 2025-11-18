import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";

/**
 * Handles pronoun notations: {{he}}, {{his}}, {{him}}, {{himself}}, {{he's}}
 */
export class PronounHandler implements NotationHandler {
  name = "PRONOUN";

  private readonly pronounMap: Record<string, Record<string, string>> = {
    he: {
      m: "he",
      f: "she",
      a: "it",
      default: "they"
    },
    his: {
      m: "his",
      f: "hers",
      a: "its",
      default: "theirs"
    },
    him: {
      m: "him",
      f: "her",
      a: "it",
      default: "them"
    },
    himself: {
      m: "himself",
      f: "herself",
      a: "itself",
      default: "themself"
    },
    "he's": {
      m: "he's",
      f: "she's",
      a: "it's",
      default: "they're"
    }
  };

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    // Content is the pronoun type (e.g., "he", "his", etc.)
    const pronounType = content.trim().toLowerCase();
    const sex = context.context.sex;

    const pronounSet = this.pronounMap[pronounType];
    if (!pronounSet) {
      return content; // Unknown pronoun type, return as-is
    }

    let replacement: string;
    if (sex === "m" || sex === "f" || sex === "a") {
      replacement = pronounSet[sex] ?? pronounSet.default;
    } else {
      replacement = pronounSet.default;
    }

    // Preserve capitalization
    if (content.charAt(0) === content.charAt(0).toUpperCase()) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }

    return replacement;
  }
}
