import * as fs from "fs";
import * as path from "path";

/**
 * Resolves shorthand references to full dot-notation paths
 */
export class ShorthandResolver {
  private shorthandMap: Record<string, string> | null = null;

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
    if (this.shorthandMap !== null) {
      return this.shorthandMap;
    }

    const jsonPath = path.resolve("wiki-src", "system-data", "_shorthand_reference.json");

    if (!fs.existsSync(jsonPath)) {
      this.shorthandMap = {};
      return this.shorthandMap;
    }

    try {
      const jsonContent = fs.readFileSync(jsonPath, { encoding: "utf8" });
      this.shorthandMap = JSON.parse(jsonContent);
      return this.shorthandMap;
    } catch (error) {
      // If file is malformed, return empty map
      this.shorthandMap = {};
      return this.shorthandMap;
    }
  }
}
