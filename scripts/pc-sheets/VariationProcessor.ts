import type { PCSheetData } from "./types";
import type { ProcessingContext } from "./curly-notations/ProcessingContext";
import { buildAdvantageDotline, hasDotlineStructure, variationPurchaseStrategy } from "./shared/advantage/helpers";
import type {
  ProcessedVariation,
  VariationJSON
} from "./shared/advantage/types";
import { BaseAdvantageProcessor } from "./shared/advantage/BaseAdvantageProcessor";

export class VariationProcessor extends BaseAdvantageProcessor<VariationJSON> {
  constructor() {
    super("variations");
  }

  /**
   * Processes a single variation from JSON data
   */
  processVariation(
    variationJson: VariationJSON,
    pcData: PCSheetData
  ): ProcessedVariation {
    const selectedDeviationKeys = this.getSelectedDeviationKeys(variationJson);
    const prepared = this.prepareAdvantage(variationJson, {
      purchaseStrategy: (value) => variationPurchaseStrategy(value),
      deviationKeys: selectedDeviationKeys,
      allowMagMod: true
    });
    const mergedVariation = prepared.mergedAdvantage;
    const purchaseLevel = prepared.purchaseLevel;
    const finalMagnitude = prepared.adjustedValue;
    const replacements = prepared.regexpReplacements;
    if (selectedDeviationKeys.length > 0) {
      mergedVariation.selectedDeviations = selectedDeviationKeys;
    }

    const mergedVars = this.combineVars(mergedVariation, variationJson);
    const entangledScarKey = this.getEntangledScarKey(variationJson, mergedVariation);

    // Step 5: Select and process effect
    const resolvedType = this.resolveVariationType(
      variationJson,
      mergedVariation,
      pcData,
      entangledScarKey
    );
    if (resolvedType) {
      mergedVariation.type = resolvedType;
    }

    const effectContext: ProcessingContext = {
      context: pcData,
      thisEntity: mergedVariation,
      vars: mergedVars ?? variationJson.vars,
      strict: true
    };

    let effect = this.textRenderer.process(
      prepared.effectTemplate,
      effectContext,
      { prefix: "Effect:" }
    ) ?? "";
    effect = this.applyRegexpReplacements(effect, replacements, effectContext) ?? effect;

    // Step 6: Build processed variation
    const narrativeSource = this.pickFirstString(
      variationJson.narrative,
      mergedVariation.narrative
    );

    let narrative = narrativeSource
      ? this.processTextField(narrativeSource, effectContext, true)
      : undefined;
    narrative = this.applyRegexpReplacements(narrative, replacements, effectContext);

    const displaySource = this.pickFirstString(
      variationJson.display,
      mergedVariation.display,
      mergedVariation.name,
      variationJson.key
    );

    const processedDisplay = displaySource
      ? this.processTextField(displaySource, effectContext, false)
      : undefined;

    const dotlineSource = typeof variationJson.value !== "undefined"
      ? variationJson.value
      : (hasDotlineStructure(prepared.rawValue) ? prepared.rawValue : undefined);
    const valueDots = buildAdvantageDotline(dotlineSource ?? prepared.adjustedValue);

    const processed: ProcessedVariation = {
      key: variationJson.key,
      display: processedDisplay ?? variationJson.key,
      narrative,
      effect,
      purchaseLevel,
      finalMagnitude,
      ...(valueDots ? { valueDots } : {}),
      ...this.copyOtherProperties(mergedVariation, variationJson)
    };

    if (entangledScarKey) {
      processed.entangledScar = entangledScarKey;
    } else if ("entangledScar" in processed) {
      delete (processed as Record<string, unknown>).entangledScar;
    }

    return processed;
  }

  // mergeVariationData/getPurchaseLevel removed (handled by shared helpers)

  /**
   * Combines system-specified vars with player-provided vars.
   */
  private combineVars(
    mergedVariation: Record<string, unknown>,
    variationJson: VariationJSON
  ): Record<string, unknown> | undefined {
    const systemVars = this.extractVars(mergedVariation.vars);
    const playerVars = this.extractVars(variationJson.vars);

    if (!systemVars && !playerVars) {
      return undefined;
    }

    return {
      ...(systemVars ?? {}),
      ...(playerVars ?? {})
    };
  }

  /**
   * Extracts and sanitizes the list of selected deviation keys from player JSON.
   */
  private getSelectedDeviationKeys(
    variationJson: VariationJSON
  ): string[] {
    const preferred =
      this.normalizeDeviationList((variationJson as { selectedDeviations?: unknown }).selectedDeviations);
    if (preferred) {
      return preferred;
    }
    const legacy = this.normalizeDeviationList(variationJson.deviations);
    return legacy ?? [];
  }

  /**
   * Normalizes raw deviation arrays into trimmed string lists.
   */
  private normalizeDeviationList(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
      return null;
    }
    const normalized = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
    return normalized.length > 0 ? normalized : [];
  }

  private processTextField(
    value: string | undefined,
    context: ProcessingContext,
    wrap: boolean
  ): string | undefined {
    return this.textRenderer.process(value, context, { wrap });
  }

  private pickFirstString(...values: Array<unknown>): string | undefined {
    for (const value of values) {
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    return undefined;
  }

  private extractVars(source: unknown): Record<string, unknown> | undefined {
    if (source && typeof source === "object" && !Array.isArray(source)) {
      return source as Record<string, unknown>;
    }
    return undefined;
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
      "secondaryVariations",
      "type"
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
  private resolveVariationType(
    variationJson: VariationJSON,
    mergedVariation: Record<string, unknown>,
    pcData: PCSheetData,
    entangledScarKey?: string
  ): "physical" | "mental" | "social" | undefined {
    const directType = this.normalizeScarType(
      (variationJson as { type?: unknown }).type ?? mergedVariation.type
    );
    if (directType) {
      return directType;
    }

    const normalizedScarKey = entangledScarKey ?? this.getEntangledScarKey(variationJson, mergedVariation);
    if (!normalizedScarKey) {
      return undefined;
    }

    const scar = this.findScarInContext(normalizedScarKey, pcData);
    if (!scar) {
      throw new Error(
        `Variation "${variationJson.key}" references entangled scar "${normalizedScarKey}", but that scar was not found.`
      );
    }

    const scarType = this.normalizeScarType((scar as Record<string, unknown>).type);
    if (!scarType) {
      throw new Error(
        `Entangled scar "${normalizedScarKey}" (referenced by variation "${variationJson.key}") is missing a valid type ("physical", "mental", or "social").`
      );
    }

    return scarType;
  }

  private getEntangledScarKey(
    variationJson: VariationJSON,
    mergedVariation: Record<string, unknown>
  ): string | undefined {
    const entangledFromJson = (variationJson as { entangledScar?: unknown }).entangledScar;
    const candidate = typeof entangledFromJson === "string"
      ? entangledFromJson
      : (typeof mergedVariation.entangledScar === "string"
        ? (mergedVariation.entangledScar as string)
        : undefined);

    if (!candidate) {
      return undefined;
    }

    const trimmed = candidate.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    if (trimmed.toLowerCase() === "none") {
      return undefined;
    }

    return trimmed;
  }

  private findScarInContext(
    scarKey: string,
    pcData: PCSheetData
  ): Record<string, unknown> | undefined {
    if (pcData.scarsByKey && pcData.scarsByKey[scarKey]) {
      return pcData.scarsByKey[scarKey] as Record<string, unknown>;
    }

    if (Array.isArray(pcData.scars)) {
      const scar = pcData.scars.find((entry) => entry.key === scarKey);
      if (scar) {
        return scar as Record<string, unknown>;
      }
    }

    return undefined;
  }

  private normalizeScarType(value: unknown): "physical" | "mental" | "social" | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const normalized = value.toLowerCase();
    if (normalized === "physical" || normalized === "mental" || normalized === "social") {
      return normalized as "physical" | "mental" | "social";
    }
    return undefined;
  }
}
