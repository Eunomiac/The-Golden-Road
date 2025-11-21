import Handlebars = require("handlebars");
import * as fs from "fs";
import * as path from "path";
import type {
  PCJSONData,
  PCSheetData,
  TraitJSON,
  TraitData,
  TraitDataAttribute,
  TraitDataSkill,
  TraitDataDerived,
  TraitValueData,
  SpecializationData,
  Attribute,
  Skill
} from "./types";
import {
  TraitPriority,
  TraitCategory,
  TraitTag,
  SpecializationTag,
  DotType,
  DotlineData,
  AttributeMental,
  AttributePhysical,
  AttributeSocial,
  SkillMental,
  SkillPhysical,
  SkillSocial
} from "./types";
import { CurlyNotationProcessor } from "./curly-notations/CurlyNotationProcessor";
import type { ProcessingContext } from "./curly-notations/ProcessingContext";
import { MeritProcessor } from "./MeritProcessor";
import { VariationProcessor } from "./VariationProcessor";
import { ScarProcessor } from "./ScarProcessor";
import type {
  MeritJSON,
  ProcessedMerit,
  ProcessedScar,
  ProcessedVariation,
  ScarJSON,
  VariationJSON
} from "./shared/advantage/types";

/**
 * Context data for template processing
 * Provides additional context needed for certain template patterns
 * @deprecated Use ProcessingContext from curly-notations module instead
 */
export interface TemplateContext {
  /** Current trait/merit name (for {{NAMEVALUE:this}}) */
  currentTraitName?: string;
  /** Current trait/merit value/cost/rating (for {{VALUE:this.value}}) */
  currentValue?: number;
  /** Current subtype value (for {{subtype}}) */
  currentSubtype?: string;
}

type VariationCategory = "physical" | "mental" | "social";

interface VariationInput {
  variation: VariationJSON;
  parentVariationKey?: string;
  parentMeritKey?: string;
  inheritedScar?: string;
  inheritedType?: VariationCategory;
  requireContext?: boolean;
}

/**
 * Trait definition structure from JSON files
 */
interface TraitDefinition {
  name: string;
  description: string;
  levels: Record<string, string>;
  source: {
    book: string;
    page: number;
  };
}

/**
 * PCSheet class - transforms JSON data into Handlebars context
 * Similar to Foundry's ActorSheet.getData() pattern
 */
export class PCSheet {
  protected jsonData: PCJSONData;
  private static attributesCache: Record<string, TraitDefinition> | null = null;
  private static skillsCache: Record<string, TraitDefinition> | null = null;
  private notationProcessor: CurlyNotationProcessor;
  private meritProcessor: MeritProcessor;
  private variationProcessor: VariationProcessor;
  private scarProcessor: ScarProcessor;

  constructor(jsonData: PCJSONData) {
    this.jsonData = jsonData;
    this.notationProcessor = new CurlyNotationProcessor(true); // Strict mode by default
    this.meritProcessor = new MeritProcessor();
    this.variationProcessor = new VariationProcessor();
    this.scarProcessor = new ScarProcessor();
  }

  /**
   * Loads and caches attributes JSON file
   */
  private static loadAttributes(): Record<string, TraitDefinition> {
    if (this.attributesCache === null) {
      const jsonPath = path.resolve("wiki-src", "system-data", "_attributes.json");
      const jsonContent = fs.readFileSync(jsonPath, { encoding: "utf8" });
      this.attributesCache = JSON.parse(jsonContent);
    }
    return this.attributesCache;
  }

  /**
   * Loads and caches skills JSON file
   */
  private static loadSkills(): Record<string, TraitDefinition> {
    if (this.skillsCache === null) {
      const jsonPath = path.resolve("wiki-src", "system-data", "_skills.json");
      const jsonContent = fs.readFileSync(jsonPath, { encoding: "utf8" });
      this.skillsCache = JSON.parse(jsonContent);
    }
    return this.skillsCache;
  }


  /**
   * Creates a default TraitData object for derived traits
   */
  protected createDefaultTraitData(key: string, max = 5, base = 0): TraitDataDerived {
    max = Math.max(max, base);
    return {
      key,
      value: { base, bonus: 0, broken: 0, total: base, max },
      dotline: { dots: Array(max).fill(DotType.empty) },
      tags: [],
      specs: [],
      cssClasses: []
    };
  }

  /**
   * Returns default Handlebars context with all required fields set to defaults
   */
  protected getDefaults(): PCSheetData {

    return {
      player: "",
      name: "",
      sex: "u",
      dob: "?? / ?? / ??",
      ddv: "?? / ?? / ??",
      imageUrl: "",
      concept: "",
      origin: "",
      clade: "",
      forms: [],
      overview: "Needs overview.",
      health: this.createDefaultTraitData("health", 10),
      willpower: this.createDefaultTraitData("willpower", 10),
      acclimation: this.createDefaultTraitData("acclimation", 5),
      stability: this.createDefaultTraitData("stability", 10),
      size: 5,
      defense: 0,
      initiative: 0,
      speed: 0,
      armor: { general: 0, ballistic: 0 },
      attributes: {
        mental: Object.fromEntries(Object.values(AttributeMental).map((attr) => [attr, this.createDefaultTraitData(attr)] )) as Record<AttributeMental, TraitDataAttribute>,
        physical: Object.fromEntries(Object.values(AttributePhysical).map((attr) => [attr, this.createDefaultTraitData(attr)] )) as Record<AttributePhysical, TraitDataAttribute>,
        social: Object.fromEntries(Object.values(AttributeSocial).map((attr) => [attr, this.createDefaultTraitData(attr)] )) as Record<AttributeSocial, TraitDataAttribute>,
      },
      attributePriorities: {
        mental: TraitPriority.tertiary,
        physical: TraitPriority.tertiary,
        social: TraitPriority.tertiary
      },
      skills: {
        mental: Object.fromEntries(Object.values(SkillMental).map((skill) => [skill, this.createDefaultTraitData(skill)] )) as Record<SkillMental, TraitDataSkill>,
        physical: Object.fromEntries(Object.values(SkillPhysical).map((skill) => [skill, this.createDefaultTraitData(skill)] )) as Record<SkillPhysical, TraitDataSkill>,
        social: Object.fromEntries(Object.values(SkillSocial).map((skill) => [skill, this.createDefaultTraitData(skill)] )) as Record<SkillSocial, TraitDataSkill>,
      },
      skillPriorities: {
        mental: TraitPriority.tertiary,
        physical: TraitPriority.tertiary,
        social: TraitPriority.tertiary
      }
    };
  }

  /**
   * Determines which category an attribute belongs to
   */
  protected getAttributeCategory(attr: Attribute): TraitCategory {
    const mentalAttrs = Object.values(AttributeMental) as string[];
    const physicalAttrs = Object.values(AttributePhysical) as string[];

    if (mentalAttrs.includes(attr)) {
      return TraitCategory.mental;
    }
    if (physicalAttrs.includes(attr)) {
      return TraitCategory.physical;
    }
    return TraitCategory.social;
  }

  /**
   * Determines which category a skill belongs to
   */
  protected getSkillCategory(skill: Skill): TraitCategory {
    const mentalSkills = Object.values(SkillMental) as string[];
    const physicalSkills = Object.values(SkillPhysical) as string[];

    if (mentalSkills.includes(skill)) {
      return TraitCategory.mental;
    }
    if (physicalSkills.includes(skill)) {
      return TraitCategory.physical;
    }
    return TraitCategory.social;
  }

  /**
   * Resolves dotline data from trait value data
   */
  protected resolveDotline(data: TraitValueData): DotlineData {
    const dots: DotType[] = [];

    let brokenCount = data.broken ?? 0,
      bonusCount = data.bonus ?? 0,
      baseCount = data.base,
      emptyCount = data.max;

    // Reduce base count by broken count
    baseCount = Math.max(baseCount - brokenCount, 0)

    // If more broken, reduce bonus count by the remaining broken count
    bonusCount = Math.max(bonusCount - (Math.max(brokenCount - baseCount, 0)), 0)

    // Total "non-empty" dots equals base + broken + bonus
    // Derive emptyCount from max dots remaining
    emptyCount = Math.max(emptyCount - (baseCount + bonusCount + brokenCount), 0)

    // Add full dots for base value
    for (let i = 0; i < data.base; i++) {
      dots.push(DotType.full);
    }
    // Add bonus dots
    for (let i = 0; i < bonusCount; i++) {
      dots.push(DotType.bonus);
    }
    // Mark broken dots (replacing existing dots)
    for (let i = 0; i < brokenCount && i < dots.length; i++) {
      dots[i] = DotType.broken;
    }
    // Fill remaining slots with empty dots
    for (let i = dots.length; i < data.max; i++) {
      dots.push(DotType.empty);
    }

    return { dots };
  }

  protected buildSpecializationTooltip(anchorContent: string, tooltipContent: string): string {
    // Generate a random 16-character anchor ID
    const anchorID = Math.random().toString(36).substring(2, 15);
    return `
      <span class="has-tooltip" style="anchor-name: --${anchorID};">
        ${anchorContent}
      </span>
      <div class="tooltip tiny-tooltip" style="position-anchor: --${anchorID};">
        ${tooltipContent}
      </div>
    `;
  }

  /**
   * Parses specialization string array into SpecializationData array
   * Each string is comma-separated: "Text,tag1,tag2" where tags are optional
   */
  protected parseSpecializations(specs: string[] | undefined): SpecializationData[] {
    if (!specs || specs.length === 0) {
      return [];
    }

    return specs.map((specStr) => {
      const parts = specStr.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
      const text = parts[0] ?? "";
      const tags: SpecializationTag[] = [];
      const tagStrings: string[] = [];

      // Check remaining parts for specialization tags
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (part === SpecializationTag.interdisciplinary) {
          tags.push(SpecializationTag.interdisciplinary);
          tagStrings.push(this.buildSpecializationTooltip("⁂", "<center>Interdisciplinary</center>"));
        } else if (part === SpecializationTag.expert) {
          tags.push(SpecializationTag.expert);
          tagStrings.push(this.buildSpecializationTooltip("+2", "<center>Area of Expertise</center>"));
        }
      }

      return { text, tags, tagString: tagStrings.join(", ") };
    });
  }

  /**
   * Builds CSS classes array for a trait based on its properties
   */
  protected buildCssClasses(tags: TraitTag[] | undefined, priority?: TraitPriority): string[] {
    const classes: string[] = [];

    if (tags && tags.length > 0) {
      classes.push(...tags.map((tag) => `trait-${tag}`));
    }

    if (priority) {
      classes.push(`priority-${priority}`);
    }

    return classes;
  }

  /**
   * Builds tooltip text from trait data
   */
  protected buildTooltip(traitKey: string, pcData: PCSheetData): {tooltipHTML: string, tooltipID: string} | undefined {
    const tooltipHTML: string[] = [];
    const tooltipID: string = Math.random().toString(36).substring(2, 15);

    // Get trait data from PCSheetData
    const traitData = this.getTraitData(traitKey, pcData);
    if (!traitData) {
      return undefined;
    }

    // Determine if it's an attribute or skill
    const isAttr = this.isAttribute(traitData.key as Attribute | Skill);
    let traitDef: TraitDefinition | undefined;
    let jsonKey: string;

    if (isAttr) {
      // Attributes use the same key in JSON (e.g., "int")
      jsonKey = traitData.key as string;
      const attributes = PCSheet.loadAttributes();
      traitDef = attributes[jsonKey];
    } else {
      // Skills use the same key in JSON (e.g., "animalKen")
      jsonKey = traitData.key as string;
      const skills = PCSheet.loadSkills();
      traitDef = skills[jsonKey];
    }

    if (!traitDef) {
      // Trait definition not found in JSON
      return undefined;
    }

    // Get trait display name
    let displayName: string;
    if (isAttr) {
      displayName = this.getAttributeDisplayName(traitData.key as Attribute);
    } else {
      displayName = this.getSkillDisplayName(traitData.key as Skill);
    }

    // Get total value
    const totalValue = traitData.value.total;

    // Get level-specific description
    // Clamp to max level (20 for attributes, 5 for skills) but allow any value including 0
    const maxLevel = isAttr ? 20 : 5;
    const levelKey = Math.min(totalValue, maxLevel).toString();

    // If the specific level doesn't exist in the JSON, return undefined
    if (!(levelKey in traitDef.levels)) {
      return undefined;
    }

    const levelText = traitDef.levels[levelKey];

    // Create processing context for curly notation processing
    const processingContext: ProcessingContext = {
      context: pcData,
      thisEntity: {
        name: displayName,
        display: displayName,
        value: { total: totalValue }
      },
      strict: true
    };

    // Process template notation in description and level text
    const processedDescription = this.processTemplate(traitDef.description, pcData, processingContext);
    const processedLevelText = this.processTemplate(levelText, pcData, processingContext);

    // Build tooltip content
    const tooltipContentHTML = [
      `<span class='tooltip-title tooltip-title-white tooltip-title-left'>${displayName}: ${totalValue}</span>`,
      `<span class='trait-desc-general tooltip-block'>${processedDescription}</span>`,
      `<span class='trait-desc-specific tooltip-block'>${processedLevelText}</span>`
    ].join("");

    tooltipHTML.push(`<div class="tooltip" style="position-anchor: --${tooltipID};">`);
    tooltipHTML.push(tooltipContentHTML);
    tooltipHTML.push(`</div>`);

    return { tooltipHTML: tooltipHTML.join(""), tooltipID };
  }

  /**
   * Type guard to check if a value is an Attribute
   */
  protected isAttribute(value: Attribute | Skill): value is Attribute {
    const mentalAttrs = Object.values(AttributeMental) as string[];
    const physicalAttrs = Object.values(AttributePhysical) as string[];
    const socialAttrs = Object.values(AttributeSocial) as string[];
    return mentalAttrs.includes(value) || physicalAttrs.includes(value) || socialAttrs.includes(value);
  }

  /**
   * Converts TraitJSON to TraitData for derived traits (health, willpower, etc.)
   * These don't have categories or priorities, so they use a simpler conversion
   */
  protected extractDerivedTraitData(key: string, json: TraitJSON): TraitDataDerived {
    let valueData: TraitValueData;
    let tags: TraitTag[] = [];
    let specs: SpecializationData[] = [];
    let narrative: string | undefined;

    if (typeof json === "number") {
      // Simple number case
      const base = json;
      const max = base > 5 ? 10 : 5;
      valueData = {
        base,
        bonus: 0,
        broken: 0,
        total: base,
        max
      };
    } else {
      // Object case
      let base: number;
      let bonus: number;
      let broken: number;
      let total: number;

      // Check if json.value is a number or an object
      if (typeof json.value === "number") {
        // Simple value case: { value: 3, bonus: 1 }
        base = json.value;
        bonus = json.bonus ?? 0;
        broken = json.broken ?? 0;
        total = json.total ?? (base + bonus);
      } else if (typeof json.value === "object" && json.value !== null) {
        // Nested value object case: { value: { base: 4, bonus: 3, total: 7 } }
        const valueObj = json.value as { base?: number; bonus?: number; broken?: number; total?: number };
        base = valueObj.base ?? 0;
        bonus = valueObj.bonus ?? json.bonus ?? 0;
        broken = valueObj.broken ?? json.broken ?? 0;
        total = valueObj.total ?? json.total ?? (base + bonus);
      } else {
        // Fallback: treat as 0
        base = 0;
        bonus = json.bonus ?? 0;
        broken = json.broken ?? 0;
        total = json.total ?? 0;
      }

      const max = base > 5 ? 10 : 5;

      valueData = {
        base,
        bonus,
        broken,
        total,
        max
      };

      tags = json.tags ?? [];
      specs = this.parseSpecializations(json.specs);
      narrative = json.narrative;
    }

    if (["health", "willpower", "stability"].includes(key)) {
      valueData.max = 10;
    }
    const dotline = this.resolveDotline(valueData);
    const cssClasses = this.buildCssClasses(tags);
    // Tooltip will be built later when we have full PCSheetData
    const tooltip: {tooltipHTML: string, tooltipID: string} | undefined = undefined;

    return {
      key,
      value: valueData,
      dotline,
      tags,
      specs,
      cssClasses,
      tooltip: tooltip?.tooltipHTML,
      tooltipID: tooltip?.tooltipID
    };
  }

  /**
   * Extracts and converts TraitJSON to TraitData with all required fields
   * Overloaded to properly handle Attribute and Skill types
   */
  protected extractTraitData(key: Attribute, json: TraitJSON, priority?: TraitPriority): TraitDataAttribute;
  protected extractTraitData(key: Skill, json: TraitJSON, priority?: TraitPriority): TraitDataSkill;
  protected extractTraitData<T extends Attribute | Skill>(
    key: T,
    json: TraitJSON,
    priority?: TraitPriority
  ): TraitData<T> {
    let valueData: TraitValueData;
    let tags: TraitTag[] = [];
    let specs: SpecializationData[] = [];
    let narrative: string | undefined;

    if (typeof json === "number") {
      // Simple number case
      const base = json;
      const max = base > 5 ? 10 : 5;
      valueData = {
        base,
        bonus: 0,
        broken: 0,
        total: base,
        max
      };
    } else {
      // Object case
      let base: number;
      let bonus: number;
      let broken: number;
      let total: number;

      // Check if json.value is a number or an object
      if (typeof json.value === "number") {
        // Simple value case: { value: 3, bonus: 1 }
        base = json.value;
        bonus = json.bonus ?? 0;
        broken = json.broken ?? 0;
        total = json.total ?? (base + bonus);
      } else if (typeof json.value === "object" && json.value !== null) {
        // Nested value object case: { value: { base: 4, bonus: 3, total: 7 } }
        const valueObj = json.value as { base?: number; bonus?: number; broken?: number; total?: number };
        base = valueObj.base ?? 0;
        bonus = valueObj.bonus ?? json.bonus ?? 0;
        broken = valueObj.broken ?? json.broken ?? 0;
        total = valueObj.total ?? json.total ?? (base + bonus);
      } else {
        // Fallback: treat as 0
        base = 0;
        bonus = json.bonus ?? 0;
        broken = json.broken ?? 0;
        total = json.total ?? 0;
      }

      const max = base > 5 ? 10 : 5;

      valueData = {
        base,
        bonus,
        broken,
        total,
        max
      };

      tags = json.tags ?? [];
      specs = this.parseSpecializations(json.specs);
      narrative = json.narrative;
    }


    if (["health", "willpower", "stability"].includes(key)) {
      valueData.max = 10;
    }
    const dotline = this.resolveDotline(valueData);
    const cssClasses = this.buildCssClasses(tags, priority);
    // Tooltip will be built later when we have full PCSheetData
    const tooltip: {tooltipHTML: string, tooltipID: string} | undefined = undefined;

    // Type guard narrows the key type, allowing us to construct the appropriate type
    if (this.isAttribute(key)) {
      const result: TraitDataAttribute = {
        key,
        value: valueData,
        dotline,
        tags,
        specs,
        cssClasses,
        tooltip: tooltip?.tooltipHTML,
        tooltipID: tooltip?.tooltipID
      };
      return result as TraitData<T>;
    } else {
      const result: TraitDataSkill = {
        key,
        value: valueData,
        dotline,
        tags,
        specs,
        cssClasses,
        tooltip: tooltip?.tooltipHTML,
        tooltipID: tooltip?.tooltipID
      };
      return result as TraitData<T>;
    }
  }

  /**
   * Processes JSON data into Handlebars context format
   */
  protected processJSONData(): Partial<PCSheetData> {
    const result: Partial<PCSheetData> = {};

    // Header data
    if (this.jsonData.player !== undefined) {
      result.player = this.jsonData.player;
    }
    if (this.jsonData.name !== undefined) {
      result.name = this.jsonData.name;
    }
    if (this.jsonData.sex !== undefined) {
      result.sex = this.jsonData.sex;
    }
    if (this.jsonData.dob !== undefined) {
      result.dob = this.jsonData.dob;
    }
    if (this.jsonData.ddv !== undefined) {
      result.ddv = this.jsonData.ddv;
    }
    if (this.jsonData.imageUrl !== undefined) {
      result.imageUrl = this.jsonData.imageUrl;
    }
    if (this.jsonData.concept !== undefined) {
      result.concept = this.jsonData.concept;
    }
    if (this.jsonData.origin !== undefined) {
      result.origin = this.jsonData.origin;
    }
    if (this.jsonData.clade !== undefined) {
      result.clade = this.jsonData.clade;
    }
    if (this.jsonData.forms !== undefined) {
      result.forms = this.jsonData.forms;
    }
    if (this.jsonData.overview !== undefined) {
      result.overview = this.jsonData.overview;
    }

    // Derived traits - convert from TraitJSON to TraitData
    if (this.jsonData.health !== undefined) {
      result.health = this.extractDerivedTraitData("health", this.jsonData.health);
    }
    if (this.jsonData.willpower !== undefined) {
      result.willpower = this.extractDerivedTraitData("willpower", this.jsonData.willpower);
    }
    if (this.jsonData.acclimation !== undefined) {
      result.acclimation = this.extractDerivedTraitData("acclimation", this.jsonData.acclimation);
    }
    if (this.jsonData.stability !== undefined) {
      result.stability = this.extractDerivedTraitData("stability", this.jsonData.stability);
    }

    // Derived stats
    if (this.jsonData.size !== undefined) {
      result.size = this.jsonData.size;
    }
    if (this.jsonData.defense !== undefined) {
      result.defense = this.jsonData.defense;
    }
    if (this.jsonData.initiative !== undefined) {
      result.initiative = this.jsonData.initiative;
    }
    if (this.jsonData.speed !== undefined) {
      result.speed = this.jsonData.speed;
    }
    if (this.jsonData.armor !== undefined) {
      result.armor = this.jsonData.armor;
    }

    // Process attributes - organize by category
    if (this.jsonData.attributes !== undefined) {
      const attributes: {
        mental: Partial<Record<AttributeMental, TraitDataAttribute>>;
        physical: Partial<Record<AttributePhysical, TraitDataAttribute>>;
        social: Partial<Record<AttributeSocial, TraitDataAttribute>>;
      } = {
        mental: {},
        physical: {},
        social: {}
      };

      const attributePriorities = this.jsonData.attributePriorities;

      for (const [attrKey, attrValue] of Object.entries(this.jsonData.attributes) as [Attribute, TraitJSON][]) {
        const category = this.getAttributeCategory(attrKey);
        const priority = attributePriorities?.[category];
        const traitData = this.extractTraitData(attrKey, attrValue, priority);
        // Type assertion needed because TypeScript can't narrow the key type based on category
        (attributes[category] as Record<string, TraitDataAttribute>)[attrKey] = traitData;
      }

      result.attributes = attributes as Required<typeof result.attributes>;
    }

    // Process attribute priorities
    if (this.jsonData.attributePriorities !== undefined) {
      result.attributePriorities = this.jsonData.attributePriorities;
    }

    // Process skills - organize by category
    if (this.jsonData.skills !== undefined) {
      const skills: {
        mental: Partial<Record<SkillMental, TraitDataSkill>>;
        physical: Partial<Record<SkillPhysical, TraitDataSkill>>;
        social: Partial<Record<SkillSocial, TraitDataSkill>>;
      } = {
        mental: {},
        physical: {},
        social: {}
      };

      const skillPriorities = this.jsonData.skillPriorities;

      for (const [skillKey, skillValue] of Object.entries(this.jsonData.skills) as [Skill, TraitJSON][]) {
        const category = this.getSkillCategory(skillKey);
        const priority = skillPriorities?.[category];
        const traitData = this.extractTraitData(skillKey, skillValue, priority);
        skills[category][skillKey] = traitData;
      }

      result.skills = skills as Required<typeof result.skills>;
    }

    // Process skill priorities
    if (this.jsonData.skillPriorities !== undefined) {
      result.skillPriorities = this.jsonData.skillPriorities;
    }

    // Merits and variations will be processed in getData() after we have full context
    // For now, just store references to the raw data
    if (this.jsonData.merits !== undefined) {
      (result as any)._meritsRaw = this.jsonData.merits;
    }
    if (this.jsonData.variations !== undefined) {
      (result as any)._variationsRaw = this.jsonData.variations;
    }
    if (this.jsonData.scars !== undefined) {
      (result as any)._scarsRaw = this.jsonData.scars;
    }

    // HTML fields (stored as string, template should use {{{}}} for raw HTML)
    if (this.jsonData.bio !== undefined) {
      result.bio = this.jsonData.bio;
    }

    return result;
  }

  /**
   * Deep merges two objects, with source overriding target
   * Handles nested objects and arrays
   */
  protected mergeData(target: PCSheetData, source: Partial<PCSheetData>): PCSheetData {
    const result: PCSheetData = { ...target };

    // Merge basic properties
    if (source.player !== undefined) result.player = source.player;
    if (source.name !== undefined) result.name = source.name;
    if (source.sex !== undefined) result.sex = source.sex;
    if (source.dob !== undefined) result.dob = source.dob;
    if (source.ddv !== undefined) result.ddv = source.ddv;
    if (source.imageUrl !== undefined) result.imageUrl = source.imageUrl;
    if (source.concept !== undefined) result.concept = source.concept;
    if (source.origin !== undefined) result.origin = source.origin;
    if (source.clade !== undefined) result.clade = source.clade;
    if (source.forms !== undefined) result.forms = source.forms;
    if (source.overview !== undefined) result.overview = source.overview;

    // Merge derived traits (TraitData format)
    if (source.health !== undefined) {
      result.health = source.health;
    }
    if (source.willpower !== undefined) {
      result.willpower = source.willpower;
    }
    if (source.acclimation !== undefined) {
      result.acclimation = source.acclimation;
    }
    if (source.stability !== undefined) {
      result.stability = source.stability;
    }

    result.health.value.max = 10;
    result.willpower.value.max = 10;
    result.acclimation.value.max = 5;
    result.stability.value.max = 10;
    // Merge derived stats
    if (source.size !== undefined) result.size = source.size;
    if (source.defense !== undefined) result.defense = source.defense;
    if (source.initiative !== undefined) result.initiative = source.initiative;
    if (source.speed !== undefined) result.speed = source.speed;
    if (source.armor !== undefined) result.armor = source.armor;

    // Merge nested attributes structure
    if (source.attributes !== undefined) {
      result.attributes = {
        mental: { ...target.attributes.mental, ...source.attributes.mental },
        physical: { ...target.attributes.physical, ...source.attributes.physical },
        social: { ...target.attributes.social, ...source.attributes.social }
      };
    }
    if (source.attributePriorities !== undefined) {
      result.attributePriorities = source.attributePriorities;
    }

    // Merge nested skills structure
    if (source.skills !== undefined) {
      result.skills = {
        mental: { ...target.skills.mental, ...source.skills.mental },
        physical: { ...target.skills.physical, ...source.skills.physical },
        social: { ...target.skills.social, ...source.skills.social }
      };
    }
    if (source.skillPriorities !== undefined) {
      result.skillPriorities = source.skillPriorities;
    }

    // HTML fields
    if (source.bio !== undefined) result.bio = source.bio;

    return result;
  }

  /**
   * Builds tooltips for all traits in the PCSheetData
   */
  protected buildAllTooltips(data: PCSheetData): void {
    // Build tooltips for attributes
    for (const category of [TraitCategory.mental, TraitCategory.physical, TraitCategory.social]) {
      const attrs = data.attributes[category];
      for (const [key, traitData] of Object.entries(attrs)) {
        const tooltip = this.buildTooltip(key, data);
        if (tooltip) {
          traitData.tooltip = tooltip.tooltipHTML;
          traitData.tooltipID = tooltip.tooltipID;
        }
      }
    }

    // Build tooltips for skills
    for (const category of [TraitCategory.mental, TraitCategory.physical, TraitCategory.social]) {
      const skills = data.skills[category];
      for (const [key, traitData] of Object.entries(skills)) {
        const tooltip = this.buildTooltip(key, data);
        if (tooltip) {
          traitData.tooltip = tooltip.tooltipHTML;
          traitData.tooltipID = tooltip.tooltipID;
        }
      }
    }

    // Note: Derived traits (health, willpower, acclimation, stability) don't have
    // definitions in attributes.json or skills.json, so we skip tooltip building for them
  }

  /**
   * Generates the Handlebars context object by merging defaults with processed JSON data
   */
  getData(): PCSheetData {
    const defaults: PCSheetData = this.getDefaults();
    const processed: Partial<PCSheetData> = this.processJSONData();
    const merged: PCSheetData = this.mergeData(defaults, processed);
    const variationInputsFromMerits: VariationInput[] = [];

    // Build tooltips now that we have complete data
    this.buildAllTooltips(merged);

    // Process merits and variations now that we have full PCSheetData context
    const rawMerits = (processed as any)._meritsRaw;
    if (rawMerits !== undefined && Array.isArray(rawMerits)) {
      const { merits: processedMerits, emittedVariations } = this.processMeritTree(rawMerits, merged);
      merged.merits = processedMerits;
      variationInputsFromMerits.push(...emittedVariations);
    }

    const rawScars = (processed as any)._scarsRaw;
    if (Array.isArray(rawScars)) {
      merged.scars = rawScars.map((scarJson: ScarJSON) => {
        return this.scarProcessor.processScar(scarJson, merged);
      });
    }

    const rawVariations = (processed as any)._variationsRaw;
    const variationInputs: VariationInput[] = [
      ...(Array.isArray(rawVariations)
        ? rawVariations.map((variationJson: VariationJSON) => ({ variation: variationJson }))
        : []),
      ...variationInputsFromMerits
    ];

    if (variationInputs.length > 0) {
      const processedVariations = this.processVariationForest(variationInputs, merged);

      const variationsByScar = processedVariations.reduce<Record<string, ProcessedVariation[]>>(
        (acc, variation) => {
          const scarKey = typeof variation.entangledScar === "string" ? variation.entangledScar : undefined;
          const bucketKey = scarKey ?? "__ungrouped__";
          if (!acc[bucketKey]) {
            acc[bucketKey] = [];
          }
          acc[bucketKey].push(variation);
          return acc;
        },
        {}
      );

      merged.variations = processedVariations;
      merged.variationsByScar = variationsByScar;

      if (Array.isArray(merged.scars)) {
        const scarIndex = merged.scars.reduce<Record<string, ProcessedScar>>((acc, scar) => {
          acc[scar.key] = scar;
          return acc;
        }, {});
        merged.scarsByKey = scarIndex;
      }
    }

    return merged;
  }

  /**
   * Helper method to process HTML strings from JSON
   * Handles SafeString wrapping for Handlebars
   */
  protected toSafeString(html: string | undefined): Handlebars.SafeString | undefined {
    if (html === undefined) {
      return undefined;
    }
    return new Handlebars.SafeString(html);
  }

  /**
   * Maps attribute abbreviations to full names for display
   */
  protected getAttributeDisplayName(key: Attribute): string {
    const mapping: Record<string, string> = {
      "int": "Intelligence",
      "wit": "Wits",
      "res": "Resolve",
      "str": "Strength",
      "dex": "Dexterity",
      "sta": "Stamina",
      "pre": "Presence",
      "man": "Manipulation",
      "com": "Composure"
    };
    return mapping[key] ?? key;
  }

  /**
   * Maps skill keys to display names (capitalizing first letter)
   */
  protected getSkillDisplayName(key: Skill): string {
    // Skills use camelCase, so we capitalize the first letter and handle camelCase
    const words = key.replace(/([A-Z])/g, " $1").split(" ");
    return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  }

  /**
   * Gets trait data by key from PCSheetData
   */
  protected getTraitData(key: string, data: PCSheetData): TraitDataAttribute | TraitDataSkill | TraitDataDerived | undefined {
    // Check attributes
    for (const category of [TraitCategory.mental, TraitCategory.physical, TraitCategory.social]) {
      const attrs = data.attributes[category];
      if (attrs && key in attrs) {
        return attrs[key as Attribute] as TraitDataAttribute;
      }
    }

    // Check skills
    for (const category of [TraitCategory.mental, TraitCategory.physical, TraitCategory.social]) {
      const skills = data.skills[category];
      if (skills && key in skills) {
        return skills[key as Skill] as TraitDataSkill;
      }
    }

    // Check derived traits
    if (key === "health") return data.health as TraitDataDerived;
    if (key === "willpower") return data.willpower as TraitDataDerived;
    if (key === "acclimation") return data.acclimation as TraitDataDerived;
    if (key === "stability") return data.stability as TraitDataDerived;

    return undefined;
  }

  private processMeritTree(
    meritJsons: MeritJSON[],
    pcData: PCSheetData
  ): { merits: ProcessedMerit[]; emittedVariations: VariationInput[] } {
    const merits: ProcessedMerit[] = [];
    const emittedVariations: VariationInput[] = [];
    const queue: Array<{ json: MeritJSON; parentKey?: string }> = meritJsons.map((meritJson) => ({
      json: this.cloneAdvantageJson(meritJson)
    }));

    while (queue.length > 0) {
      const { json, parentKey } = queue.shift()!;
      const processed = this.meritProcessor.processMerit(json, pcData);
      if (parentKey) {
        processed.parentMeritKey = parentKey;
      }

      const childMerits = this.extractSecondaryMeritDefs(processed);
      for (const childMerit of childMerits) {
        queue.push({ json: childMerit, parentKey: processed.key });
      }

      const childVariationInputs = this.extractSecondaryVariationDefsFromMerit(processed, processed.key);
      emittedVariations.push(...childVariationInputs);

      merits.push(processed);
    }

    return { merits, emittedVariations };
  }

  private extractSecondaryMeritDefs(merit: ProcessedMerit): MeritJSON[] {
    const defs = (merit as Record<string, unknown>).secondaryMerits;
    delete (merit as Record<string, unknown>).secondaryMerits;
    if (!Array.isArray(defs)) {
      return [];
    }
    return defs.map((def) => this.cloneAdvantageJson(def));
  }

  private extractSecondaryVariationDefsFromMerit(
    merit: ProcessedMerit,
    parentKey: string
  ): VariationInput[] {
    const defs = (merit as Record<string, unknown>).secondaryVariations;
    delete (merit as Record<string, unknown>).secondaryVariations;
    if (!Array.isArray(defs)) {
      return [];
    }
    return defs.map((def) => ({
      variation: this.cloneAdvantageJson(def),
      parentMeritKey: parentKey,
      requireContext: true
    }));
  }

  private processVariationForest(
    inputs: VariationInput[],
    pcData: PCSheetData
  ): ProcessedVariation[] {
    const results: ProcessedVariation[] = [];
    for (const input of inputs) {
      results.push(...this.processVariationNode(input, pcData));
    }
    return results;
  }

  private processVariationNode(
    input: VariationInput,
    pcData: PCSheetData
  ): ProcessedVariation[] {
    const clone = this.cloneAdvantageJson(input.variation);
    if (!clone.entangledScar && input.inheritedScar) {
      clone.entangledScar = input.inheritedScar;
    }
    if (!clone.type && input.inheritedType) {
      clone.type = input.inheritedType;
    }
    if (input.requireContext && !clone.entangledScar && !clone.type) {
      throw new Error(
        `Secondary variation "${clone.key ?? "unknown"}" must define either "entangledScar" or "type".`
      );
    }

    const processed = this.variationProcessor.processVariation(clone, pcData);

    if (input.parentVariationKey) {
      processed.parentVariationKey = input.parentVariationKey;
    }
    if (input.parentMeritKey) {
      processed.parentMeritKey = input.parentMeritKey;
    }

    const childInputs = this.extractSecondaryVariationInputs(
      processed,
      processed.parentMeritKey
    );

    const descendants = childInputs.flatMap((childInput) => this.processVariationNode(childInput, pcData));
    return [processed, ...descendants];
  }

  private extractSecondaryVariationInputs(
    variation: ProcessedVariation,
    parentMeritKey?: string
  ): VariationInput[] {
    const defs = this.extractSecondaryVariationDefs(variation);
    if (defs.length === 0) {
      return [];
    }
    const inheritedScar = typeof variation.entangledScar === "string"
      ? variation.entangledScar
      : undefined;
    const inheritedType = typeof (variation as Record<string, unknown>).type === "string"
      ? (variation as Record<string, string>).type as VariationCategory
      : undefined;

    return defs.map((def) => ({
      variation: def,
      parentVariationKey: variation.key,
      parentMeritKey,
      inheritedScar,
      inheritedType,
      requireContext: true
    }));
  }

  private extractSecondaryVariationDefs(variation: ProcessedVariation): VariationJSON[] {
    const defs = (variation as Record<string, unknown>).secondaryVariations;
    delete (variation as Record<string, unknown>).secondaryVariations;
    if (!Array.isArray(defs)) {
      return [];
    }
    return defs.map((def) => this.cloneAdvantageJson(def));
  }

  private cloneAdvantageJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  /**
   * Main method to process template notation in a string
   * Processes all template patterns and replaces them with appropriate values
   *
   * @param text - The template string containing notation patterns
   * @param data - The complete PCSheetData object
   * @param context - Optional processing context (can be TemplateContext for backward compatibility or ProcessingContext)
   * @returns Processed string with all patterns replaced
   */
  processTemplate(
    text: string,
    data: PCSheetData,
    context?: TemplateContext | ProcessingContext
  ): string {
    // Convert TemplateContext to ProcessingContext if needed
    let processingContext: ProcessingContext;

    if (context && "currentTraitName" in context) {
      // Old TemplateContext format - convert it
      const templateContext = context as TemplateContext;
      processingContext = {
        context: data,
        thisEntity: templateContext.currentTraitName
          ? {
              name: templateContext.currentTraitName,
              display: templateContext.currentTraitName,
              value: templateContext.currentValue ?? 0
            }
          : undefined,
        vars: templateContext.currentSubtype
          ? { subtype: templateContext.currentSubtype }
          : undefined,
        strict: true
      };
    } else if (context) {
      // Already ProcessingContext
      processingContext = context as ProcessingContext;
    } else {
      // No context provided
      processingContext = {
        context: data,
        strict: true
      };
    }

    // Use the new notation processor
    return this.notationProcessor.process(text, processingContext);
  }
}
