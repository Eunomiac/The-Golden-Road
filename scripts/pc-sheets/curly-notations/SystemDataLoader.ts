import * as fs from "fs";
import * as path from "path";

/**
 * Maps logical aliases to their corresponding system data files.
 */
const DATA_FILE_MAP: Record<string, string> = {
  skills: "_skills.json",
  attributes: "_attributes.json",
  merits: "_merits.json",
  variations: "_variations.json",
  adaptations: "_adaptations.json",
  scars: "_scars.json",
  conditions: "_conditions.json",
  tilts: "_tilts.json"
};

/**
 * Loads system data files for merging with context data and ad hoc references.
 */
export class SystemDataLoader {
  private cache: Map<string, Record<string, unknown>>;

  constructor() {
    this.cache = new Map();
  }

  /**
   * Gets system data for a given entity.
   * Returns null if the system data file does not exist or the entity is not found.
   */
  getSystemData(topLevelProperty: string, entityKey: string): Record<string, unknown> | null {
    const systemData = this.loadJson(topLevelProperty);
    if (!systemData) {
      return null;
    }

    return (systemData[entityKey] as Record<string, unknown>) ?? null;
  }

  /**
   * Resolves arbitrary JSON references such as json.conditions.informed.
   */
  getJsonReference(alias: string, pathSegments: string[]): unknown {
    const systemData = this.loadJson(alias);
    if (!systemData) {
      return null;
    }

    return this.resolvePath(systemData, pathSegments);
  }

  /**
   * Loads and caches a JSON file by alias.
   */
  private loadJson(alias: string): Record<string, unknown> | null {
    const fileName = DATA_FILE_MAP[alias];
    if (!fileName) {
      return null;
    }

    if (this.cache.has(alias)) {
      return this.cache.get(alias) ?? null;
    }

    const jsonPath = path.resolve("wiki-src", "system-data", fileName);
    if (!fs.existsSync(jsonPath)) {
      return null;
    }

    try {
      const jsonContent = fs.readFileSync(jsonPath, { encoding: "utf8" });
      const parsed = JSON.parse(jsonContent) as Record<string, unknown>;
      this.cache.set(alias, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Traverses a JSON object using dot-path semantics.
   */
  private resolvePath(root: unknown, pathSegments: string[]): unknown {
    let current: unknown = root;

    for (const segment of pathSegments) {
      if (current === null || current === undefined) {
        return null;
      }

      if (Array.isArray(current)) {
        const index = Number(segment);
        if (!Number.isInteger(index) || index < 0 || index >= current.length) {
          return null;
        }
        current = current[index];
        continue;
      }

      if (typeof current === "object") {
        current = (current as Record<string, unknown>)[segment];
        continue;
      }

      return null;
    }

    return current ?? null;
  }
}
