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

export interface AdvantageRegexpReplacement {
  pattern: string;
  replace: string;
  sourceDeviation: string;
}

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
  regexpReplacements: AdvantageRegexpReplacement[];
}

export function applyAdvantageDeviations(
  params: ApplyDeviationParams
): DeviationApplicationResult {
  const allowMagMod = params.allowMagMod ?? true;
  const mergedResult: Record<string, unknown> = { ...params.mergedAdvantage };
  const systemDeviations = (params.mergedAdvantage.deviations as Record<string, AdvantageDeviationDefinition> | undefined) ?? {};
  const replacedKeys = new Map<string, string>();
  let adjustedValue = params.baseValue;
  const regexpReplacements: AdvantageRegexpReplacement[] = [];

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

    if (Array.isArray(deviation.regexpReplace)) {
      for (const rule of deviation.regexpReplace) {
        if (typeof rule.pattern !== "string" || typeof rule.replace !== "string") {
          throw new Error(
            `Advantage "${params.contextKey}" deviation "${deviationKey}" defines an invalid regexpReplace entry.`
          );
        }
        regexpReplacements.push({
          pattern: rule.pattern,
          replace: rule.replace,
          sourceDeviation: deviationKey
        });
      }
    }
  }

  return {
    adjustedValue,
    mergedData: mergedResult,
    regexpReplacements
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

function toPositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function toSignedInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value === 0) {
    return 0;
  }
  return value > 0 ? Math.floor(value) : -Math.floor(Math.abs(value));
}

function hasStructuredMagnitude(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return "base" in record || "deviation" in record || "free" in record;
}

export function hasDotlineStructure(value: unknown): boolean {
  return hasStructuredMagnitude(value);
}

export function buildAdvantageDotline(rawValue: unknown): string[] | undefined {
  if (rawValue === undefined || rawValue === null) {
    return undefined;
  }

  let baseCount = 0;
  let deviationCount = 0;
  let freeCount = 0;

  if (typeof rawValue === "number") {
    baseCount = toPositiveInteger(rawValue);
  } else if (typeof rawValue === "object") {
    const record = rawValue as Record<string, unknown>;
    const totalCount = toPositiveInteger(record["total"]);
    const explicitBase = toPositiveInteger(record["base"]);
    const maxCount = toPositiveInteger(record["max"]);
    const minCount = toPositiveInteger(record["min"]);

    if (totalCount > 0) {
      baseCount = totalCount;
    } else if (explicitBase > 0) {
      baseCount = explicitBase;
    } else if (maxCount > 0) {
      baseCount = maxCount;
    } else if (minCount > 0) {
      baseCount = minCount;
    }
    deviationCount = toSignedInteger(record["deviation"]);
    freeCount = Math.min(1, toPositiveInteger(record["free"]));
  } else {
    return undefined;
  }

  const dots: string[][] = [];
  for (let i = 0; i < baseCount; i++) {
    dots.push(["full-dot"]);
  }

  if (deviationCount < 0) {
    const convertCount = Math.min(dots.length, Math.abs(deviationCount));
    for (let i = 0; i < convertCount; i++) {
      const idx = dots.length - 1 - i;
      if (idx >= 0) {
        dots[idx] = ["ghost-dot"];
      }
    }
  } else if (deviationCount > 0) {
    for (let i = 0; i < deviationCount; i++) {
      dots.push(["deviation-dot"]);
    }
  }

  if (freeCount > 0) {
    for (let i = dots.length - 1; i >= 0; i--) {
      if (!dots[i].includes("ghost-dot")) {
        if (!dots[i].includes("free-dot")) {
          dots[i].push("free-dot");
        }
        break;
      }
    }
  }

  if (dots.length === 0) {
    return undefined;
  }

  return dots.map((classes) => classes.join(" ").trim());
}
