import type {
  AdvantageJSON,
  AdvantageKeywordBadge,
  AdvantageValueRange,
  ScarValue,
  VariationValue
} from "./types";
import { SystemDataLoader } from "../../curly-notations/SystemDataLoader";
import type { ProcessingContext } from "../../curly-notations/ProcessingContext";
import type { PurchaseLevelStrategy } from "./helpers";
import {
  AdvantageRegexpReplacement,
  applyAdvantageDeviations,
  mergeAdvantageData,
  selectEffectTemplate
} from "./helpers";
import { AdvantageTextRenderer } from "./textRenderer";

type SupportedAdvantageValue = number | AdvantageValueRange | VariationValue | ScarValue;

export interface AdvantagePreparationOptions<
  TJSON extends AdvantageJSON<SupportedAdvantageValue, Record<string, unknown>>
> {
  purchaseStrategy: PurchaseLevelStrategy<TJSON["value"] | undefined>;
  deviationKeys?: string[];
  applyDeviations?: boolean;
  allowMagMod?: boolean;
}

export interface PreparedAdvantage {
  mergedAdvantage: Record<string, unknown>;
  purchaseLevel: number;
  adjustedValue: number;
  effectTemplate: string;
  regexpReplacements: AdvantageRegexpReplacement[];
  rawValue: unknown;
}

export abstract class BaseAdvantageProcessor<
  TJSON extends AdvantageJSON<SupportedAdvantageValue, Record<string, unknown>>
> {
  protected systemDataLoader: SystemDataLoader;
  protected textRenderer: AdvantageTextRenderer;
  private dataAlias: string;

  protected constructor(dataAlias: string) {
    this.dataAlias = dataAlias;
    this.systemDataLoader = new SystemDataLoader();
    this.textRenderer = new AdvantageTextRenderer();
  }

  protected prepareAdvantage(
    json: TJSON,
    options: AdvantagePreparationOptions<TJSON>
  ): PreparedAdvantage {
    const systemData = this.systemDataLoader.getSystemData(this.dataAlias, json.key);
    const merged = mergeAdvantageData(
      json as unknown as Record<string, unknown>,
      systemData as Record<string, unknown> | null
    );

    const rawValue = (typeof json.value !== "undefined"
      ? json.value
      : (merged.value as TJSON["value"] | undefined)) as TJSON["value"] | undefined;
    const purchaseLevel = options.purchaseStrategy(rawValue);
    merged.value = purchaseLevel;

    const deviationKeys = options.deviationKeys ?? [];
    const shouldApplyDeviations = options.applyDeviations !== false && deviationKeys.length > 0;

    let adjustedValue = purchaseLevel;
    let mergedWithDeviations = merged;

    let regexpReplacements: AdvantageRegexpReplacement[] = [];

    if (shouldApplyDeviations) {
      const result = applyAdvantageDeviations({
        baseValue: purchaseLevel,
        mergedAdvantage: merged,
        deviationKeys,
        allowMagMod: options.allowMagMod !== false,
        contextKey: json.key
      });
      adjustedValue = result.adjustedValue;
      mergedWithDeviations = result.mergedData;
      regexpReplacements = result.regexpReplacements;
    }

    const effectTemplate = selectEffectTemplate(
      mergedWithDeviations.effect,
      purchaseLevel,
      json.key
    );

    return {
      mergedAdvantage: mergedWithDeviations,
      purchaseLevel,
      adjustedValue,
      effectTemplate,
      regexpReplacements,
      rawValue
    };
  }

  protected applyRegexpReplacements(
    value: string | undefined,
    replacements: AdvantageRegexpReplacement[],
    context: ProcessingContext
  ): string | undefined {
    if (typeof value !== "string" || replacements.length === 0) {
      return value;
    }

    let updated = value;
    for (const rule of replacements) {
      const patternText = this.textRenderer.process(rule.pattern, context, { wrap: false }) ?? "";
      const replaceText = this.textRenderer.process(rule.replace, context, { wrap: false }) ?? "";

      if (patternText.length === 0) {
        throw new Error(
          `regexpReplace from deviation "${rule.sourceDeviation}" produced an empty pattern.`
        );
      }

      try {
        const regex = new RegExp(patternText, "g");
        updated = updated.replace(regex, replaceText);
      } catch (error) {
        throw new Error(
          `Invalid regexpReplace pattern "${patternText}" from deviation "${rule.sourceDeviation}".`
        );
      }
    }

    return updated;
  }

  protected buildKeywordBadges(
    rawKeywords: unknown,
    processingContext: ProcessingContext
  ): AdvantageKeywordBadge[] | undefined {
    if (!Array.isArray(rawKeywords)) {
      return undefined;
    }

    const keywords = rawKeywords
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);

    if (keywords.length === 0) {
      return undefined;
    }

    const badges: AdvantageKeywordBadge[] = [];

    for (const keyword of keywords) {
      const definition = this.systemDataLoader.getSystemData("rules", keyword);
      const displayName = this.getKeywordDisplayName(keyword, definition);
      const className = this.buildKeywordClassName(keyword);
      const hasTooltip = this.hasTooltipContent(definition);
      let html = displayName;

      if (hasTooltip) {
        const tooltipNotation = `{{TOOLTIP:${displayName},json.rules.${keyword}}}`;
        html = this.textRenderer.process(tooltipNotation, processingContext, { wrap: false }) ?? displayName;
      }

      badges.push({
        key: keyword,
        className,
        html
      });
    }

    return badges.length > 0 ? badges : undefined;
  }

  private getKeywordDisplayName(
    keyword: string,
    definition: Record<string, unknown> | null
  ): string {
    if (definition && typeof definition.title === "string") {
      const trimmed = definition.title.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    return this.startCase(keyword);
  }

  private buildKeywordClassName(keyword: string): string {
    const normalized = keyword
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized.length > 0 ? `keyword-${normalized}` : "keyword";
  }

  private hasTooltipContent(definition: Record<string, unknown> | null): boolean {
    if (!definition) {
      return false;
    }
    if (typeof definition.title === "string" && definition.title.trim().length > 0) {
      return true;
    }
    if (typeof definition.subtitle === "string" && definition.subtitle.trim().length > 0) {
      return true;
    }
    if (Array.isArray(definition.blocks) && definition.blocks.length > 0) {
      return true;
    }
    if (typeof definition.format === "string" && definition.format.trim().length > 0) {
      return true;
    }
    if (definition.source && typeof definition.source === "object") {
      return true;
    }
    return false;
  }

  private startCase(value: string): string {
    if (!value) {
      return "";
    }
    return value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .split(" ")
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
}
