import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { ReferenceResolver } from "../ReferenceResolver";
import { NotationError } from "../NotationError";

/**
 * Handles {{NAMEVALUE:<curlyreference>}} notation
 */
export class NameValueHandler implements NotationHandler {
  name = "NAMEVALUE";
  private referenceResolver: ReferenceResolver;
  private static readonly DISPLAY_NAME_OVERRIDES: Record<string, string> = {
    acclimation: "Acclimation",
    stability: "Stability",
    health: "Health",
    willpower: "Willpower",
    size: "Size",
    defense: "Defense",
    initiative: "Initiative Mod",
    speed: "Speed"
  };
  private static readonly NUMERIC_REFERENCE_OVERRIDES: Record<string, { display: string; signed: boolean }> = {
    size: { display: "Size", signed: false },
    defense: { display: "Defense", signed: false },
    initiative: { display: "Initiative Mod", signed: true },
    speed: { display: "Speed", signed: false }
  };

  constructor(referenceResolver: ReferenceResolver) {
    this.referenceResolver = referenceResolver;
  }

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): string {
    const [referencePart, ...optionParts] = content.split(",");
    const reference = (referencePart ?? "").trim();
    const options = this.parseOptions(optionParts);

    try {
      const resolvedValue = this.referenceResolver.resolve(reference, context);

      const armorOutput = this.tryProcessArmor(reference, resolvedValue);
      if (armorOutput !== null) {
        return armorOutput;
      }

      const wrappedPrimitive = this.wrapPrimitiveReference(reference, resolvedValue);
      const resolved = wrappedPrimitive ?? resolvedValue;

      if (typeof resolved !== "object" || resolved === null) {
        const snippet = typeof resolved === "string" ? ` Context: ${resolved.slice(0, 80)}` : "";
        throw new NotationError(
          `NAMEVALUE requires an object, got: ${typeof resolved}.${snippet}`,
          `NAMEVALUE:${reference}`,
          context.filePath,
          context.lineNumber
        );
      }

      const entity = resolved as Record<string, unknown>;
      const displayName = this.getDisplayName(entity, context, processor, reference);
      const value = this.getValue(entity, context, options);

      return `<strong class='trait-def'>${displayName} (${value})</strong>`;
    } catch (error) {
      if (error instanceof NotationError) {
        if (context.strict !== false) {
          throw error;
        }
        return error.toInlineError();
      }
      throw error;
    }
  }

  /**
   * Derives display name from entity
   */
  private getDisplayName(
    entity: Record<string, unknown>,
    context: ProcessingContext,
    processor: CurlyNotationProcessor,
    reference: string
  ): string {
    let displayName: string | undefined;

    if ("display" in entity && typeof entity.display === "string") {
      displayName = entity.display;
    } else if ("name" in entity && typeof entity.name === "string") {
      displayName = entity.name;
    } else if ("key" in entity && typeof entity.key === "string") {
      const override = NameValueHandler.DISPLAY_NAME_OVERRIDES[entity.key];
      if (override) {
        displayName = override;
      }
    }

    if (!displayName) {
      const entityLabel = this.describeEntity(entity);
      const availableKeys = Object.keys(entity);
      const snippet = entityLabel ? `Entity: ${entityLabel}; ` : "";
      throw new NotationError(
        "Cannot derive display name: entity has no 'display' or 'name' property",
        `NAMEVALUE:${reference}`,
        context.filePath,
        context.lineNumber
        ,
        `${snippet}Keys: ${availableKeys.join(", ") || "(none)"}`
      );
    }

    // Recursively process displayName if it contains notations
    return processor.process(displayName, context);
  }

  /**
   * Provides a human-friendly identifier for error reporting.
   */
  private describeEntity(entity: Record<string, unknown>): string | null {
    if (typeof entity.display === "string" && entity.display.trim().length > 0) {
      return entity.display;
    }
    if (typeof entity.name === "string" && entity.name.trim().length > 0) {
      return entity.name;
    }
    if (typeof entity.key === "string" && entity.key.trim().length > 0) {
      return entity.key;
    }
    return null;
  }

  /**
   * Handles NAMEVALUE calls that point at derived armor values.
   */
  private tryProcessArmor(reference: string, resolved: unknown): string | null {
    const normalized = reference.trim().toLowerCase();

    if (normalized === "armor") {
      if (!resolved || typeof resolved !== "object") {
        const snippet = typeof resolved === "string" ? ` Context: ${resolved.slice(0, 80)}` : "";
        throw new NotationError(
          `Armor reference must resolve to an object with 'general' and 'ballistic'.${snippet}`,
          "NAMEVALUE:armor"
        );
      }

      const armor = resolved as Record<string, unknown>;
      const general = this.coerceArmorValue(armor.general, "general");
      const ballistic = this.coerceArmorValue(armor.ballistic, "ballistic");

      return `<strong class='trait-def'>Armor (${general}/${ballistic})</strong>`;
    }

    if (normalized === "armor.general") {
      const value = this.coerceArmorValue(resolved, "general");
      return `<strong class='trait-def'>General Armor (${value})</strong>`;
    }

    if (normalized === "armor.ballistic") {
      const value = this.coerceArmorValue(resolved, "ballistic");
      return `<strong class='trait-def'>Ballistic Armor (${value})</strong>`;
    }

    return null;
  }

  private wrapPrimitiveReference(reference: string, resolved: unknown): Record<string, unknown> | null {
    if (typeof resolved !== "number") {
      return null;
    }

    const normalized = this.normalizeReferenceKey(reference);
    const override = NameValueHandler.NUMERIC_REFERENCE_OVERRIDES[normalized];
    if (!override) {
      return null;
    }

    return {
      key: normalized,
      name: override.display,
      display: override.display,
      signedOutput: override.signed,
      value: {
        base: resolved,
        total: resolved
      }
    };
  }

  private normalizeReferenceKey(reference: string): string {
    let key = reference.trim().toLowerCase();
    if (key.startsWith("context.")) {
      key = key.substring("context.".length);
    }
    if (key.startsWith("this.")) {
      key = key.substring("this.".length);
    }
    return key;
  }

  private coerceArmorValue(source: unknown, label: string): number {
    if (typeof source === "number") {
      return source;
    }

    if (typeof source === "string" && source.trim().length > 0) {
      const parsed = Number(source);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    const snippet = typeof source === "string" ? ` Context: ${source.slice(0, 80)}` : "";
    throw new NotationError(
      `Armor ${label} value must be a number.${snippet}`,
      `NAMEVALUE:armor.${label}`
    );
  }

  /**
   * Derives value from entity and formats with sign
   */
  private getValue(
    entity: Record<string, unknown>,
    context: ProcessingContext,
    options: { unsigned?: boolean }
  ): string {
    let value: number | undefined;

    // Check nested value properties
    if ("value" in entity && typeof entity.value === "object" && entity.value !== null) {
      const valueObj = entity.value as Record<string, unknown>;

      if ("total" in valueObj && typeof valueObj.total === "number") {
        value = valueObj.total;
      } else if ("value" in valueObj && typeof valueObj.value === "number") {
        value = valueObj.value;
      } else if (typeof valueObj === "number") {
        value = valueObj;
      } else if ("base" in valueObj && typeof valueObj.base === "number") {
        value = valueObj.base;
      } else if ("min" in valueObj && typeof valueObj.min === "number") {
        value = valueObj.min;
      }
    } else if ("value" in entity && typeof entity.value === "number") {
      value = entity.value;
    } else if ("total" in entity && typeof entity.total === "number") {
      value = entity.total;
    } else if ("base" in entity && typeof entity.base === "number") {
      value = entity.base;
    } else if ("min" in entity && typeof entity.min === "number") {
      value = entity.min;
    }

    if (value === undefined) {
      throw new NotationError(
        "Cannot derive value: entity has no numeric value property",
        "NAMEVALUE",
        context.filePath,
        context.lineNumber,
        `Keys: ${Object.keys(entity).join(", ") || "(none)"}`
      );
    }

    const signedOutput = entity.signedOutput !== undefined ? Boolean(entity.signedOutput) : !options.unsigned;
    if (!signedOutput) {
      return String(value);
    }
    if (options.unsigned && value >= 0) {
      return String(value);
    }

    return this.formatSignedNumber(value);
  }

  /**
   * Formats a number with sign (Unicode minus for negatives)
   */
  private formatSignedNumber(num: number): string {
    if (num < 0) {
      return `−${Math.abs(num)}`; // Unicode minus sign
    } else {
      return `+${num}`;
    }
  }

  private parseOptions(optionParts: string[]): { unsigned?: boolean } {
    if (!optionParts || optionParts.length === 0) {
      return {};
    }

    const normalizedTokens = optionParts
      .map((part) => part.trim().toLowerCase())
      .filter((token) => token.length > 0);

    return {
      unsigned: normalizedTokens.includes("unsigned")
    };
  }
}
