import * as fs from "fs";
import * as path from "path";
import * as JSON5 from "json5";

/**
 * Resolves shorthand references to full dot-notation paths
 */
export class ShorthandResolver {
  private shorthandMap?: Record<string, string>;

  /**
   * Resolves a shorthand reference to its full path
   * Returns null if not found
   */
  resolve(reference: string): string | null {
    if (reference.includes(".")) {
      // Not a shorthand (has dots)
      return null;
    }

    const map = this.loadShorthandMap();
    return map[reference] ?? null;
  }

  /**
   * Loads the shorthand reference map from JSON file
   */
  private loadShorthandMap(): Record<string, string> {
    if (this.shorthandMap) {
      return this.shorthandMap;
    }

    const jsonPath = path.resolve("wiki-src", "system-data", "_shorthand_reference.json5");

    if (!fs.existsSync(jsonPath)) {
      this.shorthandMap = {};
      return this.shorthandMap;
    }

    try {
      const jsonContent = fs.readFileSync(jsonPath, { encoding: "utf8" });
      const parsed = JSON5.parse(jsonContent);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        this.shorthandMap = {};
      } else {
        this.shorthandMap = parsed as Record<string, string>;
      }
      return this.shorthandMap;
    } catch (error) {
      // If file is malformed, return empty map
      this.shorthandMap = {};
      return this.shorthandMap;
    }
  }
}
