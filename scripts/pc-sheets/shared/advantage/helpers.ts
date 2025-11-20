import type {
  AdvantageDeviationDefinition,
  AdvantageJSON,
  AdvantageSystemData,
  AdvantageValueRange,
  ScarValue,
  ScarValueObject,
  VariationValue,
  VariationValueObject
} from "./types";

export function mergeAdvantageData(
  contextData: Record<string, unknown>,
  systemData: Record<string, unknown> | null,
  allowSystemDeviations?: boolean
): Record<string, unknown> {
  if (!systemData) {
    return { ...contextData };
  }

  const result: Record<string, unknown> = { ...systemData };
  const contextObj = contextData as unknown as Record<string, unknown>;

  for (const key in contextObj) {
    const contextValue = contextObj[key];
    const systemValue = systemData[key];

    if (key === "deviations" && !allowSystemDeviations) {
      result[key] = systemValue;
      continue;
    }

    if (Array.isArray(contextValue)) {
      if (Array.isArray(systemValue)) {
        result[key] = overwriteArray(contextValue);
      } else {
        result[key] = overwriteArray(contextValue);
      }
      continue;
    }

    if (
      contextValue &&
      typeof contextValue === "object" &&
      systemValue &&
      typeof systemValue === "object" &&
      !Array.isArray(systemValue)
    ) {
      result[key] = {
        ...(systemValue as Record<string, unknown>),
        ...(contextValue as Record<string, unknown>)
      };
      continue;
    }

    result[key] = contextValue;
  }

  return result;
}

function overwriteArray(source: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];

  for (const item of source) {
    const key = typeof item === "object" && item !== null
      ? JSON.stringify(item)
      : String(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

export type PurchaseLevelStrategy<TValue> = (value: TValue | undefined) => number;

export const meritPurchaseStrategy: PurchaseLevelStrategy<number | undefined> = (value) => {
  if (typeof value === "number") {
    return value;
  }
  return 1;
};

export const variationPurchaseStrategy: PurchaseLevelStrategy<VariationValue | undefined> = (value) => {
  if (typeof value === "number") {
    return value;
  }
  const obj = value as VariationValueObject | undefined;
  if (obj && typeof obj.total === "number") {
    return obj.total;
  }
  if (obj && typeof obj.base === "number") {
    return obj.base;
  }
  return 1;
};

export const scarPurchaseStrategy: PurchaseLevelStrategy<ScarValue | undefined> = (value) => {
  if (typeof value === "number") {
    return value;
  }
  const obj = value as ScarValueObject | undefined;
  if (obj && typeof obj.base === "number") {
    return obj.base;
  }
  if (obj && typeof obj.total === "number") {
    return obj.total;
  }
  if (obj && typeof obj.min === "number") {
    return obj.min;
  }
  return 1;
};

export interface ApplyDeviationParams {
  baseValue: number;
  mergedAdvantage: Record<string, unknown>;
  deviationKeys: string[];
  contextKey: string;
  allowMagMod?: boolean;
}

export interface DeviationApplicationResult {
  adjustedValue: number;
  mergedData: Record<string, unknown>;
}

export function applyAdvantageDeviations(
  params: ApplyDeviationParams
): DeviationApplicationResult {
  const allowMagMod = params.allowMagMod ?? true;
  const mergedResult: Record<string, unknown> = { ...params.mergedAdvantage };
  const systemDeviations = (params.mergedAdvantage.deviations as Record<string, AdvantageDeviationDefinition> | undefined) ?? {};
  const replacedKeys = new Map<string, string>();
  let adjustedValue = params.baseValue;

  for (const deviationKey of params.deviationKeys) {
    const deviation = systemDeviations[deviationKey];
    if (!deviation) {
      continue;
    }

    if (allowMagMod && typeof deviation.magMod === "number") {
      adjustedValue += deviation.magMod;
    }

    if (deviation.replace && typeof deviation.replace === "object") {
      const replaceObj = deviation.replace as Record<string, unknown>;
      for (const prop in replaceObj) {
        const previous = replacedKeys.get(prop);
        if (previous) {
          throw new Error(
            `Advantage "${params.contextKey}" has conflicting replace definitions for "${prop}" between deviations "${previous}" and "${deviationKey}".`
          );
        }
        replacedKeys.set(prop, deviationKey);
        mergedResult[prop] = replaceObj[prop];
      }
    }
  }

  return {
    adjustedValue,
    mergedData: mergedResult
  };
}

export function selectEffectTemplate(
  effectData: unknown,
  purchaseLevel: number,
  contextKey: string
): string {
  if (typeof effectData === "string") {
    return effectData;
  }

  if (effectData && typeof effectData === "object" && !Array.isArray(effectData)) {
    const effectMap = effectData as Record<string, unknown>;
    const text = effectMap[purchaseLevel.toString()];
    if (typeof text === "string") {
      return text;
    }
    const keys = Object.keys(effectMap);
    throw new Error(
      `Advantage "${contextKey}" has no effect text for purchase level ${purchaseLevel}. Available levels: ${keys.length > 0 ? keys.join(", ") : "none"}.`
    );
  }

  throw new Error(
    `Advantage "${contextKey}" is missing effect data entirely; cannot resolve purchase level ${purchaseLevel}.`
  );
}
