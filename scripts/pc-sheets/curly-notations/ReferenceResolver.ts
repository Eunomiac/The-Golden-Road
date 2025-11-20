import type { ProcessingContext } from "./ProcessingContext";
import type { PCSheetData, TraitDataAttribute } from "../types";
import { AttributeMental, AttributePhysical, AttributeSocial } from "../types";
import { SystemDataLoader } from "./SystemDataLoader";
import { ShorthandResolver } from "./ShorthandResolver";
import { NotationError } from "./NotationError";

type ScarType = "physical" | "mental" | "social";
type ScarStatName = "scarPower" | "scarFinesse" | "scarResistance";
type AttributeKey = AttributeMental | AttributePhysical | AttributeSocial;

const SCAR_STAT_METADATA: Record<ScarStatName, {
  display: string;
  attributeMap: Record<ScarType, AttributeKey>;
}> = {
  scarPower: {
    display: "Scar Power",
    attributeMap: {
      physical: AttributePhysical.str,
      mental: AttributeMental.int,
      social: AttributeSocial.pre
    }
  },
  scarFinesse: {
    display: "Scar Finesse",
    attributeMap: {
      physical: AttributePhysical.dex,
      mental: AttributeMental.wit,
      social: AttributeSocial.man
    }
  },
  scarResistance: {
    display: "Scar Resistance",
    attributeMap: {
      physical: AttributePhysical.sta,
      mental: AttributeMental.res,
      social: AttributeSocial.com
    }
  }
};

const ATTRIBUTE_DISPLAY_NAMES: Record<AttributeKey, string> = {
  [AttributeMental.int]: "Intelligence",
  [AttributeMental.wit]: "Wits",
  [AttributeMental.res]: "Resolve",
  [AttributePhysical.str]: "Strength",
  [AttributePhysical.dex]: "Dexterity",
  [AttributePhysical.sta]: "Stamina",
  [AttributeSocial.pre]: "Presence",
  [AttributeSocial.man]: "Manipulation",
  [AttributeSocial.com]: "Composure"
};

const BASE_ATTRIBUTE_REFERENCES: Record<string, AttributeKey> = {
  baseInt: AttributeMental.int,
  baseWit: AttributeMental.wit,
  baseRes: AttributeMental.res,
  baseStr: AttributePhysical.str,
  baseDex: AttributePhysical.dex,
  baseSta: AttributePhysical.sta,
  basePre: AttributeSocial.pre,
  baseMan: AttributeSocial.man,
  baseCom: AttributeSocial.com
};

/**
 * Resolves curly references (dot-notation paths) to their actual values
 */
export class ReferenceResolver {
  private systemDataLoader: SystemDataLoader;
  private shorthandResolver: ShorthandResolver;
  private readonly scarStatNames = new Set<ScarStatName>(["scarPower", "scarFinesse", "scarResistance"]);
  private readonly mentalAttributes = new Set<AttributeMental>(Object.values(AttributeMental) as AttributeMental[]);
  private readonly physicalAttributes = new Set<AttributePhysical>(Object.values(AttributePhysical) as AttributePhysical[]);
  private readonly socialAttributes = new Set<AttributeSocial>(Object.values(AttributeSocial) as AttributeSocial[]);

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

    const scarStatResult = this.tryResolveScarStat(reference, context);
    if (scarStatResult.handled) {
      return scarStatResult.value;
    }

    const baseAttributeResult = this.tryResolveBaseAttribute(reference, context);
    if (baseAttributeResult.handled) {
      return baseAttributeResult.value;
    }

    if (reference.startsWith("json.")) {
      return this.resolveJsonReference(reference.substring(5), context);
    }

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

  private tryResolveScarStat(
    reference: string,
    context: ProcessingContext
  ): { handled: boolean; value?: Record<string, unknown> } {
    if (!this.scarStatNames.has(reference as ScarStatName)) {
      return { handled: false };
    }

    if (!context.thisEntity) {
      throw new NotationError(
        `Cannot resolve '${reference}' outside of a scar or variation context.`,
        reference,
        context.filePath,
        context.lineNumber
      );
    }

    const value = this.computeScarStat(reference as ScarStatName, context);
    return { handled: true, value };
  }

  private tryResolveBaseAttribute(
    reference: string,
    context: ProcessingContext
  ): { handled: boolean; value?: Record<string, unknown> } {
    const attributeKey = BASE_ATTRIBUTE_REFERENCES[reference];
    if (!attributeKey) {
      return { handled: false };
    }

    const attributeRecord = this.getAttributeRecord(attributeKey, context.context);
    if (!attributeRecord) {
      throw new NotationError(
        `Attribute '${attributeKey}' is unavailable while resolving '${reference}'.`,
        reference,
        context.filePath,
        context.lineNumber
      );
    }

    const baseValue = this.extractBaseAttributeValue(attributeRecord, reference, context);
    const entity = this.buildBaseAttributeEntity(reference, attributeKey, baseValue);
    return { handled: true, value: entity };
  }

  private computeScarStat(
    statName: ScarStatName,
    context: ProcessingContext
  ): Record<string, unknown> {
    if (!context.thisEntity) {
      throw new NotationError(
        `Cannot resolve '${statName}' without an entity context.`,
        statName,
        context.filePath,
        context.lineNumber
      );
    }

    const scarType = this.resolveScarType(context.thisEntity as Record<string, unknown>, context, statName);
    const attributeKey = SCAR_STAT_METADATA[statName].attributeMap[scarType];
    const baseValue = this.getAttributeBaseValue(attributeKey, context.context, statName, context);
    return this.buildScarStatEntity(statName, baseValue);
  }

  private resolveScarType(
    entity: Record<string, unknown>,
    context: ProcessingContext,
    reference: ScarStatName
  ): ScarType {
    const directType = this.normalizeScarType(entity.type);
    if (directType) {
      return directType;
    }

    const entangledScarKey = this.extractEntangledScarKey(entity);
    if (entangledScarKey) {
      const scar = this.findScar(entangledScarKey, context.context);
      if (!scar) {
        throw new NotationError(
          `Entangled scar '${entangledScarKey}' (referenced by '${this.getEntityLabel(entity)}') was not found in the character data.`,
          reference,
          context.filePath,
          context.lineNumber
        );
      }

      const scarType = this.normalizeScarType((scar as Record<string, unknown>).type);
      if (!scarType) {
        throw new NotationError(
          `Entangled scar '${entangledScarKey}' is missing a valid type (must be physical, mental, or social).`,
          reference,
          context.filePath,
          context.lineNumber
        );
      }

      return scarType;
    }

    throw new NotationError(
      `Unable to resolve scar type for '${this.getEntityLabel(entity)}'. Add a 'type' property or specify an entangled scar.`,
      reference,
      context.filePath,
      context.lineNumber
    );
  }

  private extractEntangledScarKey(entity: Record<string, unknown>): string | null {
    const raw = entity.entangledScar;
    if (typeof raw !== "string") {
      return null;
    }

    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeScarType(typeValue: unknown): ScarType | null {
    if (typeof typeValue !== "string") {
      return null;
    }

    const normalized = typeValue.toLowerCase();
    if (normalized === "physical" || normalized === "mental" || normalized === "social") {
      return normalized as ScarType;
    }
    return null;
  }

  private findScar(key: string, pcData: PCSheetData): Record<string, unknown> | null {
    if (pcData.scarsByKey && pcData.scarsByKey[key]) {
      return pcData.scarsByKey[key] as Record<string, unknown>;
    }

    if (Array.isArray(pcData.scars)) {
      const scar = pcData.scars.find((entry) => entry.key === key);
      if (scar) {
        return scar as Record<string, unknown>;
      }
    }

    return null;
  }

  private getAttributeBaseValue(
    attributeKey: AttributeKey,
    pcData: PCSheetData,
    reference: ScarStatName,
    context: ProcessingContext
  ): number {
    const trait = this.getAttributeRecord(attributeKey, pcData);
    if (!trait) {
      throw new NotationError(
        `Attribute '${attributeKey}' is unavailable while resolving '${reference}'.`,
        reference,
        context.filePath,
        context.lineNumber
      );
    }

    const base = trait.value?.base;
    if (typeof base !== "number") {
      throw new NotationError(
        `Attribute '${attributeKey}' is missing a base value while resolving '${reference}'.`,
        reference,
        context.filePath,
        context.lineNumber
      );
    }

    return base;
  }

  private getAttributeRecord(attributeKey: AttributeKey, pcData: PCSheetData): TraitDataAttribute | undefined {
    if (this.isMentalAttribute(attributeKey)) {
      return pcData.attributes.mental[attributeKey as AttributeMental];
    }

    if (this.isPhysicalAttribute(attributeKey)) {
      return pcData.attributes.physical[attributeKey as AttributePhysical];
    }

    if (this.isSocialAttribute(attributeKey)) {
      return pcData.attributes.social[attributeKey as AttributeSocial];
    }

    return undefined;
  }

  private isMentalAttribute(attributeKey: AttributeKey): attributeKey is AttributeMental {
    return this.mentalAttributes.has(attributeKey as AttributeMental);
  }

  private isPhysicalAttribute(attributeKey: AttributeKey): attributeKey is AttributePhysical {
    return this.physicalAttributes.has(attributeKey as AttributePhysical);
  }

  private isSocialAttribute(attributeKey: AttributeKey): attributeKey is AttributeSocial {
    return this.socialAttributes.has(attributeKey as AttributeSocial);
  }

  private extractBaseAttributeValue(
    trait: TraitDataAttribute,
    reference: string,
    context: ProcessingContext
  ): number {
    const baseValue = trait.value?.base ?? trait.value?.total;
    if (typeof baseValue === "number") {
      return baseValue;
    }

    throw new NotationError(
      `Attribute '${trait.key}' is missing a base value while resolving '${reference}'.`,
      reference,
      context.filePath,
      context.lineNumber
    );
  }

  private buildBaseAttributeEntity(
    reference: string,
    attributeKey: AttributeKey,
    value: number
  ): Record<string, unknown> {
    const attributeName = ATTRIBUTE_DISPLAY_NAMES[attributeKey] ?? attributeKey.toUpperCase();
    const displayName = `Base ${attributeName}`;

    return {
      key: reference,
      name: displayName,
      display: displayName,
      value: {
        base: value,
        total: value
      },
      signedOutput: false
    };
  }

  private buildScarStatEntity(statName: ScarStatName, value: number): Record<string, unknown> {
    const metadata = SCAR_STAT_METADATA[statName];
    return {
      key: statName,
      name: metadata.display,
      display: metadata.display,
      value: {
        base: value,
        total: value
      }
    };
  }

  private getEntityLabel(entity: Record<string, unknown>): string {
    if (typeof entity.name === "string" && entity.name.trim().length > 0) {
      return entity.name;
    }
    if (typeof entity.key === "string" && entity.key.trim().length > 0) {
      return entity.key;
    }
    return "the current entity";
  }

  /**
   * Resolves references to standalone system JSON files (json.alias.path).
   */
  private resolveJsonReference(
    reference: string,
    context: ProcessingContext
  ): unknown {
    const segments = reference.split(".").filter((segment) => segment.length > 0);

    if (segments.length < 2) {
      throw new NotationError(
        "JSON references must include a file alias and at least one key.",
        `json.${reference}`,
        context.filePath,
        context.lineNumber
      );
    }

    const [alias, ...pathSegments] = segments;
    const resolved = this.systemDataLoader.getJsonReference(alias, pathSegments);

    if (resolved === null || resolved === undefined) {
      throw new NotationError(
        `JSON reference '${alias}' with path '${pathSegments.join(".")}' could not be resolved.`,
        `json.${reference}`,
        context.filePath,
        context.lineNumber
      );
    }

    return resolved;
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
