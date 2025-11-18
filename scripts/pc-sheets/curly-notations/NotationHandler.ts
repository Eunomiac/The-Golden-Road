import type { ProcessingContext } from "./ProcessingContext";
import type { CurlyNotationProcessor } from "./CurlyNotationProcessor";

/**
 * Interface for notation handlers
 */
export interface NotationHandler {
  name: string;
  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string | number;
}
