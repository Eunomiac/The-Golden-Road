import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";

/**
 * Handles {{NAME}} notation
 */
export class NameHandler implements NotationHandler {
  name = "NAME";

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    // {{NAME}} does not take content, so 'content' should be empty
    if (content.trim() !== "") {
      throw new Error(`{{NAME}} notation does not accept parameters. Found: "${content}"`);
    }

    // {{NAME}} always refers to the PC's name (context.name), not the entity being processed
    const characterName = context.context.name;
    if (!characterName) {
      throw new Error("Character name not found in context for {{NAME}} notation.");
    }

    // Check whether the context has a `display` property. If so, use that.
    // Note: This refers to context.display, not thisEntity.display
    if (typeof context.context === "object" && context.context !== null && "display" in context.context) {
      const display = (context.context as Record<string, unknown>).display;
      if (typeof display === "string") {
        return this.getShortForm(display);
      }
    }

    // Return short form of the character's name
    return this.getShortForm(characterName);
  }

  /**
   * Gets short form of name (first word, excluding articles and titles)
   * Not counting articles (e.g. "a", "an", or "the") or titles (words ending with a period, e.g. "Dr.", "Mr.", "Ms."),
   * strip all but the first full word from the `name` value, and return that.
   * Keep all words preceding the first full word (articles and titles should be included in the returned value).
   */
  private getShortForm(name: string): string {
    const articlesAndTitles = ["a", "an", "the", "dr.", "mr.", "ms.", "mrs.", "prof.", "rev.", "fr.", "sr.", "jr."];
    const words = name.split(" ");
    let firstName = "";
    let foundFirstFullWord = false;

    for (const word of words) {
      const lowerWord = word.toLowerCase();
      const isTitle = lowerWord.endsWith(".");
      const isArticleOrTitle = articlesAndTitles.includes(lowerWord) || isTitle;

      if (!foundFirstFullWord && isArticleOrTitle) {
        firstName += word + " ";
      } else if (!foundFirstFullWord) {
        firstName += word;
        foundFirstFullWord = true;
      } else {
        // Stop after the first full word
        break;
      }
    }

    return firstName.trim();
  }
}
