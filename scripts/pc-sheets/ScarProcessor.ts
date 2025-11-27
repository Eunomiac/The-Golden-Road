import Handlebars = require("handlebars");
import type { PCSheetData, TraitDataAttribute } from "./types";
import { AttributeMental, AttributePhysical, AttributeSocial } from "./types";
import type { ProcessingContext } from "./curly-notations/ProcessingContext";
import type {
  ProcessedScar,
  ScarDeviationBadge,
  ScarInfoLine,
  ScarJSON,
  ScarStatDisplay,
  ScarValue
} from "./shared/advantage/types";
import { buildAdvantageDotline, hasDotlineStructure, scarPurchaseStrategy } from "./shared/advantage/helpers";
import { BaseAdvantageProcessor } from "./shared/advantage/BaseAdvantageProcessor";
import type { AdvantageDeviationDefinition } from "./shared/advantage/types";

type ScarType = "physical" | "mental" | "social";
type ScarStatKey = "scarPower" | "scarFinesse" | "scarResistance";
type ScarAttributeReference = "scarPowerAttribute" | "scarFinesseAttribute" | "scarResistanceAttribute";
type AttributeKey = AttributeMental | AttributePhysical | AttributeSocial;

const ACTIVATION_TAG_MAP: Record<string, string> = {
  controlled: "activationControlled",
  involuntary: "activationInvoluntary",
  persistent: "activationPersistent"
};

const ACTIVATION_LABELS: Record<string, string> = {
  activationControlled: "Controlled",
  activationInvoluntary: "Involuntary",
  activationPersistent: "Persistent"
};

const SCAR_TYPE_LABELS: Record<ScarType, string> = {
  physical: "Physical",
  mental: "Mental",
  social: "Social"
};

const SCAR_STAT_CONFIG: Record<ScarStatKey, {
  label: string;
  attributeRef: ScarAttributeReference;
  attributeMap: Record<ScarType, AttributeKey>;
}> = {
  scarPower: {
    label: "Power",
    attributeRef: "scarPowerAttribute",
    attributeMap: {
      physical: AttributePhysical.str,
      mental: AttributeMental.int,
      social: AttributeSocial.pre
    }
  },
  scarFinesse: {
    label: "Finesse",
    attributeRef: "scarFinesseAttribute",
    attributeMap: {
      physical: AttributePhysical.dex,
      mental: AttributeMental.wit,
      social: AttributeSocial.man
    }
  },
  scarResistance: {
    label: "Resistance",
    attributeRef: "scarResistanceAttribute",
    attributeMap: {
      physical: AttributePhysical.sta,
      mental: AttributeMental.res,
      social: AttributeSocial.com
    }
  }
};

const SCAR_STATS_ORDER: ScarStatKey[] = ["scarPower", "scarFinesse", "scarResistance"];
const DEVIATION_TOOLTIP_PROPERTY = "__deviationBadgeTooltips";

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

    const scarType: ScarType = (
      (scarJson as { type?: ScarType }).type ??
      (mergedScar.type as ScarType | undefined) ??
      "physical"
    );
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
    const deviationBadges = this.buildDeviationBadges(
      mergedScar,
      selectedDeviationKeys,
      processingContext
    );
    const infoLine = this.buildScarInfoLine(
      scarType,
      activationTags,
      processingContext,
      pcData
    );
    const keywordBadges = this.buildKeywordBadges(mergedScar.keywords, processingContext);

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
      source: (scarJson.source ?? mergedScar.source) as { book: string; page: number } | undefined,
      ...(deviationBadges ? { deviationBadges } : {}),
      ...(infoLine ? { infoLine } : {}),
      ...(keywordBadges ? { keywordBadges } : {})
    };
  }

  private buildScarInfoLine(
    scarType: ScarType,
    activationTags: string[] | undefined,
    processingContext: ProcessingContext,
    pcData: PCSheetData
  ): ScarInfoLine | undefined {
    const typeLabel = SCAR_TYPE_LABELS[scarType];
    const activationHtml = this.buildActivationHtml(activationTags, processingContext);
    const stats: ScarStatDisplay[] = [];

    for (const statKey of SCAR_STATS_ORDER) {
      const metadata = SCAR_STAT_CONFIG[statKey];
      const attributeKey = metadata.attributeMap[scarType];
      const value = this.getAttributeBaseValueFromPC(pcData, attributeKey);
      if (value === null) {
        continue;
      }
      const tooltipNotation = `{{TOOLTIP:tiny-tooltip,${value},{{NAMEVALUE:${metadata.attributeRef}}}}}`;
      const valueHtml =
        this.textRenderer.process(tooltipNotation, processingContext, { wrap: false }) ??
        String(value);
      stats.push({
        key: statKey,
        label: metadata.label,
        value,
        valueHtml
      });
    }

    if (!activationHtml && stats.length === 0) {
      return {
        typeLabel,
        stats
      };
    }

    return {
      activationHtml,
      typeLabel,
      stats
    };
  }

  private buildActivationHtml(
    activationTags: string[] | undefined,
    processingContext: ProcessingContext
  ): string | undefined {
    if (!activationTags || activationTags.length === 0) {
      return undefined;
    }
    const primaryTag = activationTags.find((tag) => ACTIVATION_LABELS[tag]);
    if (!primaryTag) {
      return undefined;
    }
    const label = ACTIVATION_LABELS[primaryTag];
    const tooltipNotation = `{{TOOLTIP:${label},json.traitTags.${primaryTag}.tooltip}}`;
    return this.textRenderer.process(tooltipNotation, processingContext, { wrap: false }) ?? label;
  }

  private buildDeviationBadges(
    scarEntity: Record<string, unknown>,
    selectedDeviationKeys: string[],
    processingContext: ProcessingContext
  ): ScarDeviationBadge[] | undefined {
    if (!Array.isArray(selectedDeviationKeys) || selectedDeviationKeys.length === 0) {
      return undefined;
    }

    const deviations = scarEntity.deviations as Record<string, AdvantageDeviationDefinition> | undefined;
    if (!deviations) {
      return undefined;
    }

    const tooltipRegistry: Record<string, string> = {};
    (scarEntity as Record<string, unknown>)[DEVIATION_TOOLTIP_PROPERTY] = tooltipRegistry;
    const badges: ScarDeviationBadge[] = [];

    selectedDeviationKeys.forEach((deviationKey, index) => {
      const definition = deviations[deviationKey];
      if (!definition) {
        return;
      }

      const displayName =
        typeof definition.name === "string" && definition.name.trim().length > 0
          ? definition.name.trim()
          : deviationKey;
      const magMod = this.coerceModifier(definition.magMod);
      const tooltipSource =
        typeof definition.tooltip === "string" && definition.tooltip.trim().length > 0
          ? definition.tooltip
          : displayName;

      const processedTooltip =
        this.textRenderer.process(tooltipSource, processingContext, { wrap: false }) ??
        tooltipSource;
      const registryKey = `${DEVIATION_TOOLTIP_PROPERTY}_${index}`;
      tooltipRegistry[registryKey] = processedTooltip;

      const anchorLabel = [
        "<span class='scar-deviation-badge-background'></span>",
        "<span class='scar-deviation-badge-header'>Deviation:</span>",
        `<span class="scar-deviation-badge-name">${Handlebars.escapeExpression(displayName)}</span>`,
        `<span class="scar-deviation-badge-mag">${Handlebars.escapeExpression(this.formatSignedModifier(magMod))}</span>`
      ].join("");

      const tooltipNotation = `{{TOOLTIP:tiny-tooltip red-tooltip,${anchorLabel},this.${DEVIATION_TOOLTIP_PROPERTY}.${registryKey}}}`;
      const badgeHtml =
        this.textRenderer.process(tooltipNotation, processingContext, { wrap: false }) ??
        anchorLabel;

      badges.push({
        key: deviationKey,
        html: badgeHtml,
        magMod
      });
    });

    delete (scarEntity as Record<string, unknown>)[DEVIATION_TOOLTIP_PROPERTY];

    return badges.length > 0 ? badges : undefined;
  }

  private getAttributeBaseValueFromPC(
    pcData: PCSheetData,
    attributeKey: AttributeKey
  ): number | null {
    const trait = this.findAttributeTrait(pcData, attributeKey);
    if (!trait || !trait.value) {
      return null;
    }
    const baseValue = typeof trait.value.base === "number"
      ? trait.value.base
      : (typeof trait.value.total === "number" ? trait.value.total : undefined);
    return typeof baseValue === "number" ? baseValue : null;
  }

  private findAttributeTrait(
    pcData: PCSheetData,
    attributeKey: AttributeKey
  ): TraitDataAttribute | undefined {
    const key = attributeKey as unknown as string;
    const mental = pcData.attributes.mental as Record<string, TraitDataAttribute>;
    if (mental[key]) {
      return mental[key];
    }
    const physical = pcData.attributes.physical as Record<string, TraitDataAttribute>;
    if (physical[key]) {
      return physical[key];
    }
    const social = pcData.attributes.social as Record<string, TraitDataAttribute>;
    if (social[key]) {
      return social[key];
    }
    return undefined;
  }

  private formatSignedModifier(value: number): string {
    if (value > 0) {
      return `+${value}`;
    }
    if (value < 0) {
      return `−${Math.abs(value)}`;
    }
    return "+0";
  }

  private coerceModifier(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return Math.trunc(parsed);
      }
    }
    return 0;
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
