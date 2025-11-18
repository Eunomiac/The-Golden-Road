import * as fs from "fs";
import * as path from "path";

/**
 * Maps top-level properties to their system data files
 */
const SYSTEM_DATA_FILE_MAP: Record<string, string> = {
  skills: "_skills.json",
  attributes: "_attributes.json",
  merits: "_merits.json",
  variations: "_variations.json",
  adaptations: "_adaptations.json",
  scars: "_scars.json"
};

/**
 * Loads system data files for merging with context data
 */
export class SystemDataLoader {
  /**
   * Gets system data for a given entity
   * Returns null if system data file doesn't exist or entity not found
   */
  getSystemData(topLevelProperty: string, entityKey: string): Record<string, unknown> | null {
    const fileName = SYSTEM_DATA_FILE_MAP[topLevelProperty];

    if (!fileName) {
      // No system data file for this property (e.g., adaptations, scars may not exist yet)
      return null;
    }

    const jsonPath = path.resolve("wiki-src", "system-data", fileName);

    if (!fs.existsSync(jsonPath)) {
      return null;
    }

    try {
      const jsonContent = fs.readFileSync(jsonPath, { encoding: "utf8" });
      const systemData = JSON.parse(jsonContent) as Record<string, unknown>;
      return (systemData[entityKey] as Record<string, unknown>) ?? null;
    } catch {
      return null;
    }
  }
}
