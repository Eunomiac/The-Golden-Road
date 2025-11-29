import Handlebars = require("handlebars");
import type { PCSheetData } from "./types";
import type { ProcessingContext } from "./curly-notations/ProcessingContext";
import { meritPurchaseStrategy } from "./shared/advantage/helpers";
import type {
  MeritJSON,
  ProcessedMerit,
  MeritLevelDefinition
} from "./shared/advantage/types";
import { BaseAdvantageProcessor } from "./shared/advantage/BaseAdvantageProcessor";

export class MeritProcessor extends BaseAdvantageProcessor<MeritJSON> {
  constructor() {
    super("merits");
  }

  /**
   * Processes a single merit from JSON data
   */
  processMerit(
    meritJson: MeritJSON,
    pcData: PCSheetData
  ): ProcessedMerit {
    const prepared = this.prepareAdvantage(meritJson, {
      purchaseStrategy: (value) => meritPurchaseStrategy(value),
      applyDeviations: false
    });
    const mergedMerit = prepared.mergedAdvantage;
    const purchaseLevel = prepared.purchaseLevel;

    // Step 5: Process effect and narrative through curly notation processor
    const processingContext: ProcessingContext = {
      context: pcData,
      thisEntity: mergedMerit,
      vars: meritJson.vars,
      strict: true
    };

    const replacements = prepared.regexpReplacements;
    let effect = this.textRenderer.process(prepared.effectTemplate, processingContext, { prefix: "Effect:" }) ?? "";
    effect = this.applyRegexpReplacements(effect, replacements, processingContext) ?? effect;

    let narrative: string | undefined;
    if (typeof meritJson.narrative === "string") {
      narrative = this.textRenderer.process(meritJson.narrative, processingContext);
    } else if (typeof mergedMerit.narrative === "string") {
      narrative = this.textRenderer.process(mergedMerit.narrative, processingContext);
    }
    narrative = this.applyRegexpReplacements(narrative, replacements, processingContext);

    // Get narrativeClass from JSON if provided
    const narrativeClass = (meritJson as { narrativeClass?: string }).narrativeClass;

    // Step 5: Process levels for style-type merits
    let levels: Record<number, MeritLevelDefinition> | undefined;
    if (mergedMerit.levels && typeof mergedMerit.levels === "object" && !Array.isArray(mergedMerit.levels)) {
      const levelsObj = mergedMerit.levels as Record<string, unknown>;
      levels = {};

      for (const [levelKey, levelData] of Object.entries(levelsObj)) {
        const levelNum = parseInt(levelKey, 10);
        if (isNaN(levelNum)) continue;

        const level = levelData as Record<string, unknown>;
        const levelName = typeof level.name === "string" ? level.name : "";
        const levelLabel = this.formatLevelLabel(levelName, levelNum);
        const levelEffect = typeof level.effect === "string"
          ? this.textRenderer.process(level.effect, processingContext, { prefix: levelLabel }) ?? ""
          : "";
        const levelDrawback = typeof level.drawback === "string"
          ? this.textRenderer.process(level.drawback, processingContext, { prefix: "Drawback:" })
          : undefined;

        const processedLevel: MeritLevelDefinition = {
          name: levelName,
          effect: this.applyRegexpReplacements(levelEffect, replacements, processingContext) ?? levelEffect,
          drawback: this.applyRegexpReplacements(levelDrawback, replacements, processingContext)
        };

        levels[levelNum] = processedLevel;
      }
    }

    // Step 6: Process name and drawback through curly notation processor
    // Build display: check for narrativeName (new format) or display (legacy format)
    const narrativeName = (meritJson as { narrativeName?: string }).narrativeName;
    const systemName = typeof mergedMerit.name === "string" ? mergedMerit.name : undefined;

    let processedName: string;
    if (typeof narrativeName === "string" && narrativeName.trim().length > 0) {
      // New format: narrativeName + system name in spans
      const processedNarrativeName = this.textRenderer.process(
        narrativeName.trim(),
        processingContext,
        { wrap: false }
      ) ?? narrativeName.trim();

      if (systemName && systemName.trim().length > 0) {
        const escapedNarrativeName = Handlebars.escapeExpression(processedNarrativeName);
        const escapedSystemName = Handlebars.escapeExpression(systemName.trim());
        processedName = `<span class='narrative-name'>${escapedNarrativeName}</span><span class='system-name'>(${escapedSystemName})</span>`;
      } else {
        // Fallback if no system name available
        processedName = processedNarrativeName;
      }
    } else {
      // Legacy format: use display or fallback to system name
      const nameSource = meritJson.display ??
        (typeof mergedMerit.name === "string" ? mergedMerit.name : meritJson.key);
      processedName = typeof nameSource === "string"
        ? this.textRenderer.process(nameSource, processingContext, { wrap: false }) ?? meritJson.key
        : meritJson.key;
    }

    let processedDrawback: string | undefined;
    const meritDrawback = (meritJson as { drawback?: unknown }).drawback;
    const mergedDrawback = mergedMerit.drawback;
    const drawbackSource =
      typeof meritDrawback === "string"
        ? meritDrawback
        : (typeof mergedDrawback === "string" ? mergedDrawback : undefined);
    if (typeof drawbackSource === "string") {
      processedDrawback = this.textRenderer.process(drawbackSource, processingContext, { prefix: "Drawback:" });
    }
    processedDrawback = this.applyRegexpReplacements(processedDrawback, replacements, processingContext);

    // Step 7: Build processed merit
    const processed: ProcessedMerit = {
      key: meritJson.key,
      name: processedName,
      display: processedName,
      value: purchaseLevel > 0 ? purchaseLevel : undefined,
      narrative,
      ...(narrativeClass ? { narrativeClass } : {}),
      effect,
      levels,
      tags: Array.isArray(mergedMerit.tags) ? mergedMerit.tags as string[] : undefined,
      source: meritJson.source ??
        (mergedMerit.source && typeof mergedMerit.source === "object" && !Array.isArray(mergedMerit.source)
          ? mergedMerit.source as { book: string; page: number }
          : undefined),
      ...this.copyOtherProperties(mergedMerit, meritJson)
    };

    // Override drawback with processed version if it exists
    if (processedDrawback !== undefined) {
      processed.drawback = processedDrawback;
    }

    return processed;
  }

  // mergeMeritData and mergeArrays removed (shared helper handles merging)

  /**
   * Copies other properties from merged merit and context data
   * Note: drawback is handled separately and processed through curly notation processor
   */
  private copyOtherProperties(
    mergedMerit: Record<string, unknown>,
    contextData: MeritJSON
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Copy properties that should be included
    const propertiesToCopy = [
      "vars",
      "cssClasses",
      "secondaryMerits",
      "secondaryVariations"
      // Note: "drawback" is excluded here because it's processed separately
    ];

    for (const prop of propertiesToCopy) {
      if (prop in contextData && contextData[prop as keyof MeritJSON] !== undefined) {
        result[prop] = contextData[prop as keyof MeritJSON];
      } else if (prop in mergedMerit && mergedMerit[prop] !== undefined) {
        result[prop] = mergedMerit[prop];
      }
    }

    return result;
  }

  private formatLevelLabel(
    name: string,
    levelNumber: number
  ): string {
    const trimmedName = name.trim().length > 0 ? name.trim() : `Level ${levelNumber}`;
    const normalizedLevel = Number.isFinite(levelNumber) ? Math.max(0, Math.floor(levelNumber)) : 0;
    const dotString = normalizedLevel > 0 ? "●".repeat(normalizedLevel) : "";
    if (dotString.length > 0) {
      return `${trimmedName} (${dotString}):`;
    }
    return `${trimmedName}:`;
  }
}
