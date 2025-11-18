import type { ProcessingContext } from "./ProcessingContext";
import { SystemDataLoader } from "./SystemDataLoader";
import { ShorthandResolver } from "./ShorthandResolver";
import { NotationError } from "./NotationError";

/**
 * Resolves curly references (dot-notation paths) to their actual values
 */
export class ReferenceResolver {
  private systemDataLoader: SystemDataLoader;
  private shorthandResolver: ShorthandResolver;

  constructor() {
    this.systemDataLoader = new SystemDataLoader();
    this.shorthandResolver = new ShorthandResolver();
  }

  /**
   * Resolves a curly reference to its value
   */
  resolve(reference: string, context: ProcessingContext): unknown {
    // Step 1: Check if it starts with context indicator or is a bare context word
    let dotKey: string;
    let root: unknown;

    if (reference === "this") {
      // Bare "this" refers to the entity itself
      if (!context.thisEntity) {
        throw new NotationError(
          "Cannot resolve 'this' reference: no entity context available",
          reference,
          context.filePath,
          context.lineNumber,
          "this reference"
        );
      }
      return context.thisEntity;
    } else if (reference.startsWith("this.")) {
      if (!context.thisEntity) {
        throw new NotationError(
          "Cannot resolve 'this' reference: no entity context available",
          reference,
          context.filePath,
          context.lineNumber,
          "this reference"
        );
      }
      dotKey = reference.substring(5); // Remove "this."
      root = context.thisEntity;
    } else if (reference.startsWith("context.")) {
      dotKey = reference.substring(8); // Remove "context."
      root = context.context;
    } else if (reference.startsWith("vars.")) {
      if (!context.vars) {
        throw new NotationError(
          "Cannot resolve 'vars' reference: no vars context available",
          reference,
          context.filePath,
          context.lineNumber,
          "vars reference"
        );
      }
      dotKey = reference.substring(5); // Remove "vars."
      root = context.vars;
    } else {
      // Check if it's a shorthand first (before trying direct context path)
      const shorthand = this.shorthandResolver.resolve(reference);
      if (shorthand) {
        // Recursively resolve the shorthand
        return this.resolve(shorthand, context);
      }

      // Try to resolve as direct context path
      try {
        dotKey = reference;
        root = context.context;
        const directResult = this.resolveDotKey(dotKey, root);

        // If we got a result, return it (but still need to merge system data if applicable)
        if (directResult !== null && directResult !== undefined) {
          // Continue with system data merging below
          const topLevelProperty = this.getTopLevelProperty(`context.${reference}`);
          if (topLevelProperty) {
            const entityKey = this.getEntityKey(reference);
            if (entityKey) {
              const systemData = this.systemDataLoader.getSystemData(topLevelProperty, entityKey);
              if (systemData && typeof directResult === "object" && !Array.isArray(directResult)) {
                return this.mergeSystemData(directResult as Record<string, unknown>, systemData);
              }
            }
          }
          return directResult;
        }
      } catch (error) {
        // Direct resolution failed - re-throw the error since shorthand also failed
        throw error;
      }

      // If we get here, direct resolution returned null/undefined but didn't throw
      // This shouldn't happen, but handle it gracefully
      dotKey = reference;
      root = context.context;
    }

    // Step 2: Resolve the dot-key path
    const contextData = this.resolveDotKey(dotKey, root);

    // Step 3: Determine if we need to merge with system data
    if (contextData === null || contextData === undefined) {
      return contextData;
    }

    // Get top-level property for system data lookup
    const topLevelProperty = this.getTopLevelProperty(reference);
    if (!topLevelProperty) {
      return contextData;
    }

    // Get entity key (last segment of dot-key)
    const entityKey = this.getEntityKey(dotKey);
    if (!entityKey) {
      return contextData;
    }

    // Load system data
    const systemData = this.systemDataLoader.getSystemData(topLevelProperty, entityKey);
    if (!systemData) {
      return contextData;
    }

    // Handle number context data (replace system data's value property)
    if (typeof contextData === "number") {
      return this.mergeSystemDataWithNumber(contextData, systemData);
    }

    // Only merge if context data is an object literal
    if (typeof contextData !== "object" || Array.isArray(contextData)) {
      return contextData;
    }

    // Step 4: Merge system data with context data
    return this.mergeSystemData(contextData as Record<string, unknown>, systemData);
  }

  /**
   * Resolves a dot-key path through an object/array structure
   */
  private resolveDotKey(dotKey: string, root: unknown): unknown {
    if (!dotKey) {
      return root;
    }

    const segments = dotKey.split(".");
    let current: unknown = root;

    for (const segment of segments) {
      if (current === null || current === undefined) {
        return null;
      }

      if (Array.isArray(current)) {
        // Search array for element with matching key
        const found = current.find((item) => {
          if (typeof item === "object" && item !== null && "key" in item) {
            return item.key === segment;
          }
          return false;
        });

        if (!found) {
          throw new NotationError(
            `Entity '${segment}' not found in array`,
            dotKey,
            undefined,
            undefined,
            `Array search for key: ${segment}`
          );
        }

        current = found;
      } else if (typeof current === "object" && current !== null) {
        // Access object property
        if (segment in current) {
          current = (current as Record<string, unknown>)[segment];
        } else {
          throw new NotationError(
            `Property '${segment}' not found`,
            dotKey,
            undefined,
            undefined,
            `Object property access: ${segment}`
          );
        }
      } else {
        throw new NotationError(
          `Cannot access property '${segment}' on non-object value`,
          dotKey,
          undefined,
          undefined,
          `Type: ${typeof current}`
        );
      }
    }

    return current;
  }

  /**
   * Gets the top-level property from a reference
   * e.g., "context.skills.physical.athletics" -> "skills"
   */
  private getTopLevelProperty(reference: string): string | null {
    if (reference.startsWith("context.")) {
      const parts = reference.substring(8).split(".");
      return parts[0] ?? null;
    } else if (reference.startsWith("this.") || reference.startsWith("vars.")) {
      // For 'this' and 'vars', we can't determine top-level property easily
      // This would need to be passed differently, but for now return null
      return null;
    }
    return null;
  }

  /**
   * Gets the entity key (last segment) from a dot-key
   * e.g., "skills.physical.athletics" -> "athletics"
   */
  private getEntityKey(dotKey: string): string | null {
    const segments = dotKey.split(".");
    return segments[segments.length - 1] ?? null;
  }

  /**
   * Merges system data with number context data
   */
  private mergeSystemDataWithNumber(
    contextData: number,
    systemData: Record<string, unknown>
  ): Record<string, unknown> {
    if (!("value" in systemData)) {
      throw new NotationError(
        "System data does not have 'value' property for number context data",
        "",
        undefined,
        undefined,
        "System data merge"
      );
    }

    // Replace entire value object with the number
    return {
      ...systemData,
      value: contextData
    };
  }

  /**
   * Merges system data with context data
   * Arrays are combined and deduplicated; other properties are overwritten by context data
   */
  private mergeSystemData(
    contextData: Record<string, unknown>,
    systemData: Record<string, unknown>
  ): Record<string, unknown> {
    // Handle case where context data is null
    if (contextData === null) {
      // Ignore context data, return system data as-is
      return systemData;
    }

    const result: Record<string, unknown> = { ...systemData };

    // Merge each property from context data
    for (const key in contextData) {
      const contextValue = contextData[key];
      const systemValue = systemData[key];

      // If both are arrays, combine and deduplicate
      if (Array.isArray(contextValue) && Array.isArray(systemValue)) {
        result[key] = this.mergeArrays(systemValue, contextValue);
      } else {
        // Otherwise, context data overwrites system data
        result[key] = contextValue;
      }
    }

    return result;
  }

  /**
   * Combines two arrays and removes duplicate values
   */
  private mergeArrays(systemArray: unknown[], contextArray: unknown[]): unknown[] {
    const combined = [...systemArray, ...contextArray];

    // Deduplicate using Set for primitives, or JSON.stringify for objects
    const seen = new Set<string>();
    const result: unknown[] = [];

    for (const item of combined) {
      let key: string;

      if (item === null || item === undefined) {
        key = String(item);
      } else if (typeof item === "object") {
        // For objects, use JSON.stringify for comparison
        key = JSON.stringify(item);
      } else {
        // For primitives, use the value directly
        key = String(item);
      }

      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    return result;
  }
}
