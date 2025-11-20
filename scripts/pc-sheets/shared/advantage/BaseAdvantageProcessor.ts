import type { AdvantageJSON } from "./types";
import { SystemDataLoader } from "../../curly-notations/SystemDataLoader";
import type { PurchaseLevelStrategy } from "./helpers";
import {
  applyAdvantageDeviations,
  mergeAdvantageData,
  selectEffectTemplate
} from "./helpers";
import { AdvantageTextRenderer } from "./textRenderer";

export interface AdvantagePreparationOptions<TJSON extends AdvantageJSON> {
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
}

export abstract class BaseAdvantageProcessor<
  TJSON extends AdvantageJSON<unknown, Record<string, unknown>>
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

    const rawValue = (json.value ?? merged.value) as TJSON["value"] | undefined;
    const purchaseLevel = options.purchaseStrategy(rawValue);
    merged.value = purchaseLevel;

    const deviationKeys = options.deviationKeys ?? [];
    const shouldApplyDeviations = options.applyDeviations !== false && deviationKeys.length > 0;

    let adjustedValue = purchaseLevel;
    let mergedWithDeviations = merged;

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
      effectTemplate
    };
  }
}
