export type AdvantageType = "merit" | "variation" | "scar";

export interface AdvantageSourceReference {
  book: string;
  page: number;
}

export interface AdvantageValueRange {
  base?: number;
  free?: number;
  deviation?: number;
  total?: number;
  min?: number;
  max?: number;
}

type EmptyAdditional = Record<string, unknown>;

export type AdvantageJSON<
  ValueType = number | AdvantageValueRange,
  AdditionalFields extends Record<string, unknown> = EmptyAdditional
> = {
  key: string;
  value?: ValueType;
  display?: string;
  narrative?: string;
  vars?: Record<string, unknown>;
  deviations?: string[];
  source?: AdvantageSourceReference;
} & AdditionalFields;

export type AdvantageEffectDefinition = string | Record<string, string>;

export interface AdvantageDeviationReplacementRule {
  pattern: string;
  replace: string;
}

export interface AdvantageDeviationDefinition {
  key: string;
  name?: string;
  tooltip?: string;
  magMod?: number;
  replace?: Record<string, unknown>;
  regexpReplace?: AdvantageDeviationReplacementRule[];
  [key: string]: unknown;
}

export type AdvantageSystemData<
  AdditionalFields extends Record<string, unknown> = EmptyAdditional
> = {
  key: string;
  name?: string;
  display?: string;
  narrative?: string;
  effect?: AdvantageEffectDefinition;
  value?: number | AdvantageValueRange;
  keywords?: string[];
  tags?: string[];
  activation?: string;
  options?: Record<string, unknown>;
  deviations?: Record<string, AdvantageDeviationDefinition>;
  source?: AdvantageSourceReference;
} & AdditionalFields;

export interface ProcessedAdvantage {
  key: string;
  display: string;
  narrative?: string;
  effect?: string;
  purchaseLevel?: number;
  source?: AdvantageSourceReference;
  [key: string]: unknown;
}

export interface VariationValueObject {
  base?: number;
  free?: number;
  deviation?: number;
  total?: number;
}

export type VariationValue = number | VariationValueObject;

export interface VariationJSONAdditionalFields extends Record<string, unknown> {
  entangledScar?: string;
  activation?: string;
  tags?: string[];
  keywords?: string[];
  secondaryVariations?: VariationJSON[];
  type?: "physical" | "mental" | "social";
  selectedDeviations?: string[];
}

export type VariationJSON = AdvantageJSON<VariationValue, VariationJSONAdditionalFields>;

export interface AdvantageKeywordBadge {
  key: string;
  className: string;
  html: string;
}

export interface VariationDeviationBadge {
  key: string;
  html: string;
  magMod: number;
}

export interface ProcessedVariation extends ProcessedAdvantage {
  effect: string;
  purchaseLevel: number;
  finalMagnitude: number;
  parentVariationKey?: string;
  parentMeritKey?: string;
  secondaryVariations?: ProcessedVariation[];
  valueDots?: string[];
  keywordBadges?: AdvantageKeywordBadge[];
  deviationBadges?: VariationDeviationBadge[];
}

export interface ScarValueObject extends AdvantageValueRange {
  deviation?: number;
}

export type ScarValue = number | ScarValueObject;

export interface ScarJSONAdditionalFields extends Record<string, unknown> {
  type: "physical" | "mental" | "social";
  entangledVariations?: string[];
  selectedDeviations?: string[];
  activation?: string;
}

export type ScarJSON = AdvantageJSON<ScarValue, ScarJSONAdditionalFields>;

export interface ScarDeviationBadge {
  key: string;
  html: string;
  magMod: number;
}

export interface ScarStatDisplay {
  key: "scarPower" | "scarFinesse" | "scarResistance";
  label: string;
  value: number;
  valueHtml: string;
}

export interface ScarInfoLine {
  activationHtml?: string;
  typeLabel: string;
  stats: ScarStatDisplay[];
}

export interface ProcessedScar extends ProcessedAdvantage {
  type: "physical" | "mental" | "social";
  effect: string;
  purchaseLevel: number;
  entangledVariations?: string[];
  activation?: string;
  activationTags?: string[];
  valueDots?: string[];
  deviationBadges?: ScarDeviationBadge[];
  infoLine?: ScarInfoLine;
  keywordBadges?: AdvantageKeywordBadge[];
}

export interface MeritLevelDefinition {
  name: string;
  effect: string;
  drawback?: string;
}

export interface MeritJSONAdditionalFields extends Record<string, unknown> {
  drawback?: string;
  tags?: string[];
  cssClasses?: string | string[];
  levels?: Record<number, MeritLevelDefinition>;
  secondaryMerits?: MeritJSON[];
  secondaryVariations?: VariationJSON[];
}

export type MeritJSON = AdvantageJSON<number, MeritJSONAdditionalFields>;

export interface ProcessedMerit extends ProcessedAdvantage {
  name: string;
  value?: number;
  effect?: string;
  levels?: Record<number, MeritLevelDefinition>;
  tags?: string[];
  cssClasses?: string | string[];
  parentMeritKey?: string;
  secondaryMerits?: ProcessedMerit[];
  secondaryVariations?: ProcessedVariation[];
}
