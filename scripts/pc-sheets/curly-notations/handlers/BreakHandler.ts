import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";

/**
 * Handles {{BR}} notation
 */
export class BreakHandler implements NotationHandler {
  name = "BR";

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    // BR doesn't take content; emit double line break to avoid invalid block nesting
    return "<br><br>";
  }
}
