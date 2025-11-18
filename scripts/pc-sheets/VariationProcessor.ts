import type { PCSheetData } from "./types";
import { SystemDataLoader } from "./curly-notations/SystemDataLoader";
import { CurlyNotationProcessor } from "./curly-notations/CurlyNotationProcessor";
import type { ProcessingContext } from "./curly-notations/ProcessingContext";
import { ScarAttributeResolver, type ScarJSON } from "./ScarAttributeResolver";

/**
 * Variation data structure from JSON
 */
export interface VariationJSON {
  key: string;
  value?: number | {
    base?: number;
    free?: number;
    deviation?: number;
    total?: number;
  };
  display?: string;
  narrative?: string;
  entangledScar?: string;
  activation?: string;
  tags?: string[];
  keywords?: string[];
  source?: {
    book: string;
    page: number;
  };
  vars?: Record<string, unknown>;
  deviations?: string[];  // Array of deviation keys
  secondaryVariations?: VariationJSON[];
}

/**
 * Processed variation data
 */
export interface ProcessedVariation {
  key: string;
  display: string;
  narrative?: string;
  effect: string;  // Processed effect text
  purchaseLevel: number;  // Original purchase level
  finalMagnitude: number;  // Purchase level + sum of deviation magMods
  [key: string]: unknown;  // Other properties
}

/**
 * Processes variations, handling effect selection and deviation application
 */
export class VariationProcessor {
  private systemDataLoader: SystemDataLoader;
  private notationProcessor: CurlyNotationProcessor;

  constructor() {
    this.systemDataLoader = new SystemDataLoader();
    this.notationProcessor = new CurlyNotationProcessor(true);
  }

  /**
   * Processes a single variation from JSON data
   */
  processVariation(
    variationJson: VariationJSON,
    pcData: PCSheetData,
    scars?: ScarJSON[]
  ): ProcessedVariation {
    // Step 1: Load system data
    const systemData = this.systemDataLoader.getSystemData("variations", variationJson.key);

    // Step 2: Merge context data with system data
    const mergedVariation = this.mergeVariationData(variationJson, systemData);

    // Step 3: Determine purchase level
    const purchaseLevel = this.getPurchaseLevel(variationJson);

    // Step 4: Apply deviations
    const { finalMagnitude, mergedWithDeviations } = this.applyDeviations(
      mergedVariation,
      variationJson.deviations ?? [],
      purchaseLevel
    );

    // Step 5: Derive scar attributes and merge with vars
    const scarAttributes = this.deriveScarAttributes(variationJson, scars, pcData);
    const mergedVars = {
      ...variationJson.vars,
      ...scarAttributes
    };

    // Step 6: Select and process effect
    const effect = this.selectAndProcessEffect(
      mergedWithDeviations,
      purchaseLevel,
      pcData,
      mergedVars
    );

    // Step 7: Build processed variation
    const narrative = variationJson.narrative ??
      (typeof mergedWithDeviations.narrative === "string" ? mergedWithDeviations.narrative : undefined);

    const processed: ProcessedVariation = {
      key: variationJson.key,
      display: variationJson.display ??
        (typeof mergedWithDeviations.name === "string" ? mergedWithDeviations.name : variationJson.key),
      narrative,
      effect,
      purchaseLevel,
      finalMagnitude,
      ...this.copyOtherProperties(mergedWithDeviations, variationJson)
    };

    return processed;
  }

  /**
   * Merges variation context data with system data
   * Arrays are combined and deduplicated; other properties are overwritten by context data
   */
  private mergeVariationData(
    contextData: VariationJSON,
    systemData: Record<string, unknown> | null
  ): Record<string, unknown> {
    if (!systemData) {
      // No system data, return context data as object
      return { ...contextData };
    }

    const result: Record<string, unknown> = { ...systemData };

    // Merge each property from context data
    const contextObj = contextData as unknown as Record<string, unknown>;
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
   * Gets the purchase level from variation value
   */
  private getPurchaseLevel(variation: VariationJSON): number {
    if (typeof variation.value === "number") {
      return variation.value;
    }

    if (variation.value && typeof variation.value === "object") {
      // Use base if available, otherwise total
      if (typeof variation.value.base === "number") {
        return variation.value.base;
      }
      if (typeof variation.value.total === "number") {
        return variation.value.total;
      }
    }

    // Default to 1 if no value specified
    return 1;
  }

  /**
   * Applies deviations to a variation
   * Returns final magnitude and merged variation data
   */
  private applyDeviations(
    mergedVariation: Record<string, unknown>,
    deviationKeys: string[],
    purchaseLevel: number
  ): {
    finalMagnitude: number;
    mergedWithDeviations: Record<string, unknown>;
  } {
    let finalMagnitude = purchaseLevel;
    let result = { ...mergedVariation };

    // Get deviations from system data
    const systemDeviations = (mergedVariation.deviations as Record<string, unknown> | undefined) ?? {};

    // Apply each deviation in order
    for (const deviationKey of deviationKeys) {
      const deviation = systemDeviations[deviationKey] as Record<string, unknown> | undefined;

      if (!deviation) {
        continue; // Skip if deviation not found
      }

      // Apply magMod
      if (typeof deviation.magMod === "number") {
        finalMagnitude += deviation.magMod;
      }

      // Apply replace
      if (deviation.replace && typeof deviation.replace === "object") {
        const replaceObj = deviation.replace as Record<string, unknown>;

        // Replace matching keys (entire property replacement, not deep merge)
        for (const key in replaceObj) {
          result[key] = replaceObj[key];
        }
      }
    }

    return {
      finalMagnitude,
      mergedWithDeviations: result
    };
  }

  /**
   * Selects the appropriate effect based on purchase level and processes it
   */
  private selectAndProcessEffect(
    mergedVariation: Record<string, unknown>,
    purchaseLevel: number,
    pcData: PCSheetData,
    vars?: Record<string, unknown>
  ): string {
    const effect = mergedVariation.effect;

    if (!effect) {
      return ""; // No effect defined
    }

    let effectText: string;

    if (typeof effect === "string") {
      // Simple string effect
      effectText = effect;
    } else if (typeof effect === "object" && effect !== null && !Array.isArray(effect)) {
      // Record<number, string> - select by purchase level
      const effectRecord = effect as Record<string, unknown>;
      const levelKey = purchaseLevel.toString();
      effectText = (effectRecord[levelKey] as string) ?? "";
    } else {
      return ""; // Invalid effect format
    }

    // Process effect text through curly notation processor
    const processingContext: ProcessingContext = {
      context: pcData,
      thisEntity: mergedVariation,
      vars,
      strict: true
    };

    return this.notationProcessor.process(effectText, processingContext);
  }

  /**
   * Derives scar attributes (scarPower, scarFinesse, scarResistance) from the variation's entangled scar
   */
  private deriveScarAttributes(
    variationJson: VariationJSON,
    scars: ScarJSON[] | undefined,
    pcData: PCSheetData
  ): Record<string, number> {
    // Check for entangledScar
    const scarKey = variationJson.entangledScar;

    if (!scarKey || !scars) {
      return {}; // No entangled scar reference or no scars array
    }

    // Find the scar
    const scar = ScarAttributeResolver.findScar(scars, scarKey);

    if (!scar) {
      return {}; // Scar not found
    }

    // Derive attributes
    const attributes = ScarAttributeResolver.deriveScarAttributes(scar, pcData);

    return attributes ?? {};
  }

  /**
   * Copies other properties from merged variation and context data
   */
  private copyOtherProperties(
    mergedVariation: Record<string, unknown>,
    contextData: VariationJSON
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Copy properties that should be included
    const propertiesToCopy = [
      "entangledScar",
      "activation",
      "tags",
      "keywords",
      "source",
      "vars",
      "secondaryVariations"
    ];

    for (const prop of propertiesToCopy) {
      if (prop in contextData && contextData[prop as keyof VariationJSON] !== undefined) {
        result[prop] = contextData[prop as keyof VariationJSON];
      } else if (prop in mergedVariation && mergedVariation[prop] !== undefined) {
        result[prop] = mergedVariation[prop];
      }
    }

    return result;
  }
}
