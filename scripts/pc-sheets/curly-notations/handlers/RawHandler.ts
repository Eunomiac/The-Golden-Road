import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";

/**
 * Handles {{RAW:<curlyreference>}} notation
 * Returns the resolved value as HTML (no escaping)
 */
export class RawHandler implements NotationHandler {
  name = "RAW";
  private referenceResolver: ReferenceResolver;

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    const reference = content.trim();

    try {
      const resolved = this.referenceResolver.resolve(reference, context);

      // Process recursively in case the resolved value contains notations
      const processed = processor.process(String(resolved), context);

      // Return as-is (HTML)
      return processed;
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
}
