/**
 * TypeScript type definitions for PC Sheet system
 * Defines the structure of JSON input and Handlebars context output
 */


/**
 * Skill value can be a simple number or an object with additional properties
 */
export type TraitJSON =
  | number
  | {
      value: number | {
        base?: number;
        bonus?: number;
        broken?: number;
        total?: number;
      };
      bonus?: number;
      broken?: number;
      total?: number;
      tags?: TraitTag[];
      specs?: string[]; // each element is a comma-separated list starting with the specialization text, followed by its specialization tags if any (e.g. "Electricity,interdisciplinary,expert")
      narrative?: string;
    };
/**
 * Attribute priority levels for grouping attributes
 */
export enum TraitPriority { "primary" = "primary", "secondary" = "secondary", "tertiary" = "tertiary" }
export enum TraitCategory { "mental" = "mental", "physical" = "physical", "social" = "social" }

export enum AttributeMental { "int" = "int", "wit" = "wit", "res" = "res" }
export enum AttributePhysical { "str" = "str", "dex" = "dex", "sta" = "sta" }
export enum AttributeSocial { "pre" = "pre", "man" = "man", "com" = "com" }

export type Attribute<T extends TraitCategory | undefined = undefined> =
  T extends TraitCategory.mental ? AttributeMental
  : T extends TraitCategory.physical ? AttributePhysical
  : T extends TraitCategory.social ? AttributeSocial
  : (AttributeMental | AttributePhysical | AttributeSocial);


export enum SkillMental { "academics" = "academics", "computer" = "computer", "crafts" = "crafts", "investigation" = "investigation", "medicine" = "medicine", "occult" = "occult", "politics" = "politics", "science" = "science" }
export enum SkillPhysical { "athletics" = "athletics", "brawl" = "brawl", "drive" = "drive", "firearms" = "firearms", "larceny" = "larceny", "stealth" = "stealth", "survival" = "survival", "weaponry" = "weaponry" }
export enum SkillSocial { "animalKen" = "animalKen", "empathy" = "empathy", "expression" = "expression", "intimidation" = "intimidation", "persuasion" = "persuasion", "socialize" = "socialize", "streetwise" = "streetwise", "subterfuge" = "subterfuge" }

export type Skill<T extends TraitCategory | undefined = undefined> =
  T extends TraitCategory.mental ? SkillMental
  : T extends TraitCategory.physical ? SkillPhysical
  : T extends TraitCategory.social ? SkillSocial
  : (SkillMental | SkillPhysical | SkillSocial);

/**
 * Skill tag types
 */
export enum TraitTag { "asset" = "asset", "hypercompetent" = "hypercompetent", "overt" = "overt" }

/**
 * Specialization tag types
 */
export enum SpecializationTag { "interdisciplinary" = "interdisciplinary", "expert" = "expert" }

/**
 * Skill value data
 */
export interface TraitValueData {
  base: number;
  bonus?: number;
  broken?: number;
  total: number;
  max: number;
}
/**
 * Specialization data
 */
export interface SpecializationData {
  text: string;
  tags: SpecializationTag[];
  tagString: string; // Text to display for the tags (e.g. "⁂, +2")
}
/**
 * Dot types within a dotline
 */
export enum DotType { "full" = "full", "empty" = "empty", "bonus" = "bonus", "broken" = "broken" }

export interface DotlineData {
  dots: DotType[];
}

export interface TraitDataBase {
  cssClasses: string[];
  value: TraitValueData;
  dotline: DotlineData;
  tags: TraitTag[];
  specs: SpecializationData[];
  tooltip?: string;
  tooltipID?: string;
}

/**
 * TraitData for attributes - key is an Attribute
 */
export interface TraitDataAttribute extends TraitDataBase {
  key: Attribute;
}

/**
 * TraitData for skills - key is a Skill
 */
export interface TraitDataSkill extends TraitDataBase {
  key: Skill;
}

/**
 * TraitData for derived traits (health, willpower, etc.) - key is a string
 */
export interface TraitDataDerived extends TraitDataBase {
  key: string;
}

/**
 * Union type for all TraitData variants
 */
export type TraitData<T extends Attribute | Skill | undefined = undefined> =
  T extends Attribute ? TraitDataAttribute
  : T extends Skill ? TraitDataSkill
  : TraitDataDerived;

/**
 * Raw JSON structure from JSON files
 */
export interface PCJSONData {
  player: string;
  name: string;
  sex: "m" | "f" | "nb" | "v" | "x" | "a" | "c" | "u";
  dob?: string;
  imageUrl?: string;
  concept?: string;
  origin: string;
  clade: string;
  forms?: string[];
  overview?: string;
  health: TraitJSON;
  willpower: TraitJSON;
  acclimation: TraitJSON;
  stability: TraitJSON;
  size: number;
  defense: number;
  initiative: number;
  speed: number;
  armor?: {
    general: number;
    ballistic: number;
  }
  attributePriorities: Record<TraitCategory, TraitPriority>;
  attributes: Record<Attribute, TraitJSON>;
  skillPriorities: Record<TraitCategory, TraitPriority>;
  skills: Record<Skill, TraitJSON>;
  merits?: Array<{
    key: string;
    value?: number;
    display?: string;
    narrative?: string;
    vars?: Record<string, unknown>;
    source?: {
      book: string;
      page: number;
    };
  }>;
  variations?: Array<{
    key: string;
    value?: number | {
      base?: number;
      free?: number;
      deviation?: number;
      total?: number;
    };
    display?: string;
    narrative?: string;
    entangledScar?: string;
    activation?: string;
    tags?: string[];
    keywords?: string[];
    source?: {
      book: string;
      page: number;
    };
    vars?: Record<string, unknown>;
    deviations?: string[];
    secondaryVariations?: Array<unknown>;
  }>;
  scars?: Array<{
    key: string;
    type: "physical" | "mental" | "social";
    value?: number | {
      base?: number;
      deviation?: number;
      total?: number;
    };
    display?: string;
    narrative?: string;
    entangledVariations?: string[];
    source?: {
      book: string;
      page: number;
    };
  }>;
  bio?: string;
}

/**
 * Complete Handlebars context data structure
 * This is what gets passed to the template
 */
export interface PCSheetData {
  // Header data
  player: string;
  name: string;
  sex: "m" | "f" | "nb" | "v" | "x" | "a" | "c" | "u";
  dob: string;
  imageUrl: string;
  concept: string;
  origin: string;
  clade: string;
  forms: string[];
  overview: string;

  // Derived Trait Data
  health: TraitDataDerived;
  willpower: TraitDataDerived;
  acclimation: TraitDataDerived;
  stability: TraitDataDerived;
  size: number;
  defense: number;
  initiative: number;
  speed: number;
  armor: {
    general: number;
    ballistic: number;
  }

  // Attributes
  attributes: {
    mental: Record<AttributeMental, TraitDataAttribute>;
    physical: Record<AttributePhysical, TraitDataAttribute>;
    social: Record<AttributeSocial, TraitDataAttribute>;
  };
  attributePriorities: Record<TraitCategory, TraitPriority>;

  // Skills
  skills: {
    mental: Record<SkillMental, TraitDataSkill>;
    physical: Record<SkillPhysical, TraitDataSkill>;
    social: Record<SkillSocial, TraitDataSkill>;
  };
  skillPriorities: Record<TraitCategory, TraitPriority>;

  // Merits and Variations
  merits?: Array<{
    key: string;
    name: string;
    value?: number;
    narrative?: string;
    effect?: string;
    levels?: Record<number, {
      name: string;
      effect: string;
      drawback?: string;
    }>;
    tags?: string[];
    source?: {
      book: string;
      page: number;
    };
    [key: string]: unknown;
  }>;
  variations?: Array<{
    key: string;
    display: string;
    narrative?: string;
    effect: string;
    purchaseLevel: number;
    finalMagnitude: number;
    [key: string]: unknown;
  }>;

  // Optional HTML fields (wrapped as SafeString in implementation)
  bio?: string;
}
