import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";

/**
 * Book abbreviation to full title mapping
 */
const BOOK_MAP: Record<string, string> = {
  CoD: "Chronicles of Darkness",
  HL: "Hurt Locker",
  DtR: "Deviant: the Renegades",
  SG: "Shallow Graves",
  CC: "The Clade Companion"
};

/**
 * Handles {{SOURCE:<book>/<page>}} notation
 */
export class SourceHandler implements NotationHandler {
  name = "SOURCE";

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    const parts = content.split("/");
    if (parts.length !== 2) {
      return `<span class='source-citation'><span class='source-title'>Invalid source</span></span>`;
    }

    const bookKey = parts[0]?.trim() ?? "";
    const page = parts[1]?.trim() ?? "";

    const bookTitle = BOOK_MAP[bookKey] ?? bookKey;

    return `<span class='source-citation'><span class='source-title'>${bookTitle}</span><span class='source-page'>p.${page}</span></span>`;
  }
}
