import type { PCSheetData } from "./types";
import type { ProcessingContext } from "./curly-notations/ProcessingContext";
import type { ProcessedScar, ScarJSON, ScarValue } from "./shared/advantage/types";
import { buildAdvantageDotline, hasDotlineStructure, scarPurchaseStrategy } from "./shared/advantage/helpers";
import { BaseAdvantageProcessor } from "./shared/advantage/BaseAdvantageProcessor";

const ACTIVATION_TAG_MAP: Record<string, string> = {
  controlled: "activationControlled",
  involuntary: "activationInvoluntary",
  persistent: "activationPersistent"
};

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
    const replacements = prepared.regexpReplacements;
    if (selectedDeviationKeys.length > 0) {
      mergedScar.selectedDeviations = selectedDeviationKeys;
    }

    const mergedVars = this.mergeVars(mergedScar.vars, scarJson.vars);

    const processingContext: ProcessingContext = {
      context: pcData,
      thisEntity: mergedScar,
      vars: mergedVars,
      strict: true
    };

    let effect = this.textRenderer.process(prepared.effectTemplate, processingContext, { prefix: "Effect:" }) ?? "";
    effect = this.applyRegexpReplacements(effect, replacements, processingContext) ?? effect;

    const narrativeSource = this.pickString(scarJson.narrative, mergedScar.narrative);
    let narrative = narrativeSource
      ? this.textRenderer.process(narrativeSource, processingContext)
      : undefined;
    narrative = this.applyRegexpReplacements(narrative, replacements, processingContext);

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
    const activation = this.pickString(
      (scarJson as { activation?: string }).activation,
      typeof mergedScar.activation === "string" ? (mergedScar.activation as string) : undefined
    ) ?? "unknown";
    const activationTags = this.buildActivationTags(activation);
    const dotlineSource = typeof scarJson.value !== "undefined"
      ? scarJson.value
      : (hasDotlineStructure(prepared.rawValue) ? prepared.rawValue : undefined);
    const valueDots = buildAdvantageDotline(dotlineSource ?? finalLevel);

    return {
      key: scarJson.key,
      display,
      type: scarType,
      narrative,
      effect,
      purchaseLevel: finalLevel,
      ...(valueDots ? { valueDots } : {}),
      entangledVariations: scarEntangled ??
        (Array.isArray(mergedScar.entangledVariations)
          ? (mergedScar.entangledVariations as string[])
          : undefined),
      activation,
      activationTags: activationTags.length > 0 ? activationTags : undefined,
      source: (scarJson.source ?? mergedScar.source) as { book: string; page: number } | undefined
    };
  }

  private mergeVars(
    systemVars: unknown,
    playerVars: unknown
  ): Record<string, unknown> | undefined {
    const normalize = (value: unknown): Record<string, unknown> | null => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      return value as Record<string, unknown>;
    };

    const baseVars = normalize(systemVars);
    const overrideVars = normalize(playerVars);

    if (!baseVars && !overrideVars) {
      return undefined;
    }

    return {
      ...(baseVars ?? {}),
      ...(overrideVars ?? {})
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

  private buildActivationTags(value: string): string[] {
    if (typeof value !== "string" || value.trim().length === 0) {
      return [];
    }
    return value
      .split(/[^a-zA-Z]+/)
      .map((entry) => entry.toLowerCase())
      .map((entry) => ACTIVATION_TAG_MAP[entry])
      .filter((entry): entry is string => Boolean(entry));
  }
}
