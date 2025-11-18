import type { PCSheetData } from "./types";
import { SystemDataLoader } from "./curly-notations/SystemDataLoader";
import { CurlyNotationProcessor } from "./curly-notations/CurlyNotationProcessor";
import type { ProcessingContext } from "./curly-notations/ProcessingContext";

/**
 * Merit data structure from JSON
 */
export interface MeritJSON {
  key: string;
  value?: number;
  display?: string;
  narrative?: string;
  drawback?: string;
  vars?: Record<string, unknown>;
  source?: {
    book: string;
    page: number;
  };
}

/**
 * Level data for style-type merits
 */
export interface LevelData {
  name: string;
  effect: string;
  drawback?: string;
}

/**
 * Processed merit data
 */
export interface ProcessedMerit {
  key: string;
  name: string;
  value?: number;
  narrative?: string;
  effect?: string;
  levels?: Record<number, LevelData>;
  tags?: string[];
  source?: {
    book: string;
    page: number;
  };
  cssClasses?: string | string[];
  [key: string]: unknown; // Other properties
}

/**
 * Processes merits, handling effect selection and level processing
 */
export class MeritProcessor {
  private systemDataLoader: SystemDataLoader;
  private notationProcessor: CurlyNotationProcessor;

  constructor() {
    this.systemDataLoader = new SystemDataLoader();
    this.notationProcessor = new CurlyNotationProcessor(true);
  }

  /**
   * Processes a single merit from JSON data
   */
  processMerit(
    meritJson: MeritJSON,
    pcData: PCSheetData
  ): ProcessedMerit {
    console.log(`🔍 MeritProcessor: Processing merit "${meritJson.key}"`);
    // Step 1: Load system data
    const systemData = this.systemDataLoader.getSystemData("merits", meritJson.key);
    console.log(`🔍 MeritProcessor: System data for "${meritJson.key}":`, systemData ? "Found" : "Not found");

    // Step 2: Merge context data with system data
    const mergedMerit = this.mergeMeritData(meritJson, systemData);
    console.log(`🔍 MeritProcessor: Merged merit for "${meritJson.key}":`, {
      hasName: !!mergedMerit.name,
      hasEffect: !!mergedMerit.effect,
      hasLevels: !!mergedMerit.levels,
      value: mergedMerit.value,
      contextValue: meritJson.value
    });

    // Step 3: Get purchase level
    // Priority: 1. PC file value (if exists), 2. System data value (if it's a number), 3. Error if system value is an object
    let purchaseLevel: number;

    if (meritJson.value !== undefined && meritJson.value !== null) {
      // PC file has a value, use it
      if (typeof meritJson.value !== "number") {
        throw new Error(
          `Merit "${meritJson.key}" has an invalid value in PC file: ${JSON.stringify(meritJson.value)}. Expected a number.`
        );
      }
      purchaseLevel = meritJson.value;
    } else {
      // PC file doesn't have a value, check system data
      const systemValue = mergedMerit.value;

      if (typeof systemValue === "number") {
        // System data has a numeric value, use it
        purchaseLevel = systemValue;
      } else if (typeof systemValue === "object" && systemValue !== null && !Array.isArray(systemValue)) {
        // System data has an object value (e.g., {min: 1, max: 5}), which means the PC must specify a value
        throw new Error(
          `Merit "${meritJson.key}" requires a value to be specified in the PC file. ` +
          `System data defines it as a range: ${JSON.stringify(systemValue)}`
        );
      } else {
        // No value found anywhere, default to 1
        purchaseLevel = 1;
      }
    }

    console.log(`🔍 MeritProcessor: Purchase level for "${meritJson.key}":`, purchaseLevel);

    // Step 4: Ensure the merged merit has the value property set correctly
    // The merged merit should have the value from context data (which overwrites system data)
    mergedMerit.value = purchaseLevel;

    // Step 5: Process effect and narrative through curly notation processor
    const processingContext: ProcessingContext = {
      context: pcData,
      thisEntity: mergedMerit,
      vars: meritJson.vars,
      strict: true
    };

    // Resolve the effect text, supporting either a single string or a map of level-specific strings
    const effectTemplate = this.resolveEffectTemplate(mergedMerit.effect, purchaseLevel);
    let effect: string | undefined;
    if (effectTemplate) {
      effect = this.notationProcessor.process(effectTemplate, processingContext);
    }

    let narrative: string | undefined;
    if (meritJson.narrative) {
      narrative = this.notationProcessor.process(meritJson.narrative, processingContext);
    } else if (mergedMerit.narrative && typeof mergedMerit.narrative === "string") {
      narrative = this.notationProcessor.process(mergedMerit.narrative, processingContext);
    }

    // Step 5: Process levels for style-type merits
    let levels: Record<number, LevelData> | undefined;
    if (mergedMerit.levels && typeof mergedMerit.levels === "object" && !Array.isArray(mergedMerit.levels)) {
      const levelsObj = mergedMerit.levels as Record<string, unknown>;
      levels = {};

      for (const [levelKey, levelData] of Object.entries(levelsObj)) {
        const levelNum = parseInt(levelKey, 10);
        if (isNaN(levelNum)) continue;

        const level = levelData as Record<string, unknown>;
        const processedLevel: LevelData = {
          name: typeof level.name === "string" ? level.name : "",
          effect: typeof level.effect === "string"
            ? this.notationProcessor.process(level.effect, processingContext)
            : "",
          drawback: typeof level.drawback === "string"
            ? this.notationProcessor.process(level.drawback, processingContext)
            : undefined
        };

        levels[levelNum] = processedLevel;
      }
    }

    // Step 6: Process name and drawback through curly notation processor
    let processedName: string;
    const nameSource = meritJson.display ??
      (typeof mergedMerit.name === "string" ? mergedMerit.name : meritJson.key);
    if (typeof nameSource === "string") {
      processedName = this.notationProcessor.process(nameSource, processingContext);
    } else {
      processedName = meritJson.key;
    }

    let processedDrawback: string | undefined;
    const drawbackSource = meritJson.drawback ??
      (typeof mergedMerit.drawback === "string" ? mergedMerit.drawback : undefined);
    if (typeof drawbackSource === "string") {
      processedDrawback = this.notationProcessor.process(drawbackSource, processingContext);
    }

    // Step 7: Build processed merit
    const processed: ProcessedMerit = {
      key: meritJson.key,
      name: processedName,
      value: purchaseLevel > 0 ? purchaseLevel : undefined,
      narrative,
      effect,
      levels,
      tags: Array.isArray(mergedMerit.tags) ? mergedMerit.tags as string[] : undefined,
      source: meritJson.source ??
        (mergedMerit.source && typeof mergedMerit.source === "object" && !Array.isArray(mergedMerit.source)
          ? mergedMerit.source as { book: string; page: number }
          : undefined),
      ...this.copyOtherProperties(mergedMerit, meritJson)
    };

    // Override drawback with processed version if it exists
    if (processedDrawback !== undefined) {
      processed.drawback = processedDrawback;
    }

    console.log(`🔍 MeritProcessor: Final processed merit "${meritJson.key}":`, {
      key: processed.key,
      name: processed.name,
      value: processed.value,
      hasNarrative: !!processed.narrative,
      hasEffect: !!processed.effect,
      hasLevels: !!processed.levels,
      tags: processed.tags
    });

    return processed;
  }

  /**
   * Merges merit context data with system data
   * Arrays are combined and deduplicated; other properties are overwritten by context data
   */
  private mergeMeritData(
    contextData: MeritJSON,
    systemData: Record<string, unknown> | null
  ): Record<string, unknown> {
    if (!systemData) {
      // No system data, return context data as object
      return { ...contextData };
    }

    const result: Record<string, unknown> = { ...systemData };
    const contextObj = contextData as unknown as Record<string, unknown>;

    // Merge each property from context data
    for (const key in contextObj) {
      const contextValue = contextObj[key];
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

  /**
   * Copies other properties from merged merit and context data
   * Note: drawback is handled separately and processed through curly notation processor
   */
  private copyOtherProperties(
    mergedMerit: Record<string, unknown>,
    contextData: MeritJSON
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Copy properties that should be included
    const propertiesToCopy = [
      "vars",
      "cssClasses"
      // Note: "drawback" is excluded here because it's processed separately
    ];

    for (const prop of propertiesToCopy) {
      if (prop in contextData && contextData[prop as keyof MeritJSON] !== undefined) {
        result[prop] = contextData[prop as keyof MeritJSON];
      } else if (prop in mergedMerit && mergedMerit[prop] !== undefined) {
        result[prop] = mergedMerit[prop];
      }
    }

    return result;
  }

  /**
   * Resolves the correct effect template for the current purchase level
   * Supports either a single string or an object keyed by level numbers
   */
  private resolveEffectTemplate(
    effectData: unknown,
    purchaseLevel: number
  ): string | undefined {
    if (typeof effectData === "string") {
      return effectData;
    }

    if (effectData && typeof effectData === "object" && !Array.isArray(effectData)) {
      const key = purchaseLevel.toString();
      const effectMap = effectData as Record<string, unknown>;
      const matchedEffect = effectMap[key];

      if (typeof matchedEffect === "string") {
        return matchedEffect;
      }
    }

    return undefined;
  }
}
