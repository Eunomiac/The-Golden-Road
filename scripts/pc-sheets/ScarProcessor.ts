import type { PCSheetData } from "./types";
import type { ProcessingContext } from "./curly-notations/ProcessingContext";
import type { ProcessedScar, ScarJSON, ScarValue } from "./shared/advantage/types";
import { scarPurchaseStrategy } from "./shared/advantage/helpers";
import { BaseAdvantageProcessor } from "./shared/advantage/BaseAdvantageProcessor";

export class ScarProcessor extends BaseAdvantageProcessor<ScarJSON> {
  constructor() {
    super("scars");
  }

  processScar(
    scarJson: ScarJSON,
    pcData: PCSheetData
  ): ProcessedScar {
    const selectedDeviationKeys = this.getSelectedDeviationKeys(scarJson);
    const prepared = this.prepareAdvantage(scarJson, {
      purchaseStrategy: (value) => scarPurchaseStrategy(value as ScarValue | undefined),
      deviationKeys: selectedDeviationKeys,
      allowMagMod: true
    });
    const mergedScar = prepared.mergedAdvantage;
    const purchaseLevel = prepared.purchaseLevel;
    const finalLevel = prepared.adjustedValue;
    if (selectedDeviationKeys.length > 0) {
      mergedScar.selectedDeviations = selectedDeviationKeys;
    }

    const processingContext: ProcessingContext = {
      context: pcData,
      thisEntity: mergedScar,
      vars: scarJson.vars,
      strict: true
    };

    const effect = this.textRenderer.process(prepared.effectTemplate, processingContext, { prefix: "Effect:" }) ?? "";

    const narrativeSource = this.pickString(scarJson.narrative, mergedScar.narrative);
    const narrative = narrativeSource
      ? this.textRenderer.process(narrativeSource, processingContext)
      : undefined;

    const displaySource = this.pickString(
      scarJson.display,
      mergedScar.display ?? mergedScar.name
    );
    const display = displaySource
      ? this.textRenderer.process(displaySource, processingContext, { wrap: false }) ?? scarJson.key
      : scarJson.key;

    const scarType = (
      scarJson as { type?: "physical" | "mental" | "social" }
    ).type ?? (
      mergedScar.type as "physical" | "mental" | "social" | undefined
    ) ?? "physical";
    const scarEntangled = (scarJson as { entangledVariations?: string[] }).entangledVariations;

    return {
      key: scarJson.key,
      display,
      type: scarType,
      narrative,
      effect,
      purchaseLevel: finalLevel,
      entangledVariations: scarEntangled ??
        (Array.isArray(mergedScar.entangledVariations)
          ? (mergedScar.entangledVariations as string[])
          : undefined),
      source: (scarJson.source ?? mergedScar.source) as { book: string; page: number } | undefined
    };
  }

  private pickString(
    primary?: string,
    secondary?: unknown
  ): string | undefined {
    if (typeof primary === "string") {
      return primary;
    }
    if (typeof secondary === "string") {
      return secondary;
    }
    return undefined;
  }

  /**
   * Extracts selected deviation keys provided by the player JSON.
   */
  private getSelectedDeviationKeys(
    scarJson: ScarJSON
  ): string[] {
    const preferred =
      this.normalizeDeviationList((scarJson as { selectedDeviations?: unknown }).selectedDeviations);
    if (preferred) {
      return preferred;
    }
    const legacy = this.normalizeDeviationList(scarJson.deviations);
    return legacy ?? [];
  }

  /**
   * Converts raw deviation arrays into clean, trimmed key lists.
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
}
