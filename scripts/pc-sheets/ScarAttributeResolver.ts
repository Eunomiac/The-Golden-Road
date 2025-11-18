import type { AttributeMental, AttributePhysical, AttributeSocial } from "./types";

/**
 * Scar data structure from JSON
 */
export interface ScarJSON {
  key: string;
  type: "physical" | "mental" | "social";
  value?: number | {
    base?: number;
    free?: number;
    deviation?: number;
    total?: number;
  };
  [key: string]: unknown;
}

/**
 * Resolves scar-derived attribute values
 */
export class ScarAttributeResolver {
  /**
   * Gets the attribute key for scarPower based on scar type
   */
  static getScarPowerAttribute(type: "physical" | "mental" | "social"): AttributePhysical | AttributeMental | AttributeSocial {
    switch (type) {
      case "physical":
        return "str" as AttributePhysical;
      case "mental":
        return "int" as AttributeMental;
      case "social":
        return "pre" as AttributeSocial;
    }
  }

  /**
   * Gets the attribute key for scarFinesse based on scar type
   */
  static getScarFinesseAttribute(type: "physical" | "mental" | "social"): AttributePhysical | AttributeMental | AttributeSocial {
    switch (type) {
      case "physical":
        return "dex" as AttributePhysical;
      case "mental":
        return "wit" as AttributeMental;
      case "social":
        return "man" as AttributeSocial;
    }
  }

  /**
   * Gets the attribute key for scarResistance based on scar type
   */
  static getScarResistanceAttribute(type: "physical" | "mental" | "social"): AttributePhysical | AttributeMental | AttributeSocial {
    switch (type) {
      case "physical":
        return "sta" as AttributePhysical;
      case "mental":
        return "res" as AttributeMental;
      case "social":
        return "com" as AttributeSocial;
    }
  }

  /**
   * Derives scar attribute values from a scar and PC data
   * Returns an object with scarPower, scarFinesse, and scarResistance
   */
  static deriveScarAttributes(
    scar: ScarJSON | null | undefined,
    pcData: {
      attributes: {
        mental: Record<AttributeMental, { value: { total: number } }>;
        physical: Record<AttributePhysical, { value: { total: number } }>;
        social: Record<AttributeSocial, { value: { total: number } }>;
      };
    }
  ): {
    scarPower: number;
    scarFinesse: number;
    scarResistance: number;
  } | null {
    if (!scar || !scar.type) {
      return null;
    }

    const powerAttr = this.getScarPowerAttribute(scar.type);
    const finesseAttr = this.getScarFinesseAttribute(scar.type);
    const resistanceAttr = this.getScarResistanceAttribute(scar.type);

    // Get values from appropriate category
    let powerValue: number;
    let finesseValue: number;
    let resistanceValue: number;

    if (scar.type === "physical") {
      powerValue = pcData.attributes.physical[powerAttr as AttributePhysical]?.value?.total ?? 0;
      finesseValue = pcData.attributes.physical[finesseAttr as AttributePhysical]?.value?.total ?? 0;
      resistanceValue = pcData.attributes.physical[resistanceAttr as AttributePhysical]?.value?.total ?? 0;
    } else if (scar.type === "mental") {
      powerValue = pcData.attributes.mental[powerAttr as AttributeMental]?.value?.total ?? 0;
      finesseValue = pcData.attributes.mental[finesseAttr as AttributeMental]?.value?.total ?? 0;
      resistanceValue = pcData.attributes.mental[resistanceAttr as AttributeMental]?.value?.total ?? 0;
    } else {
      // social
      powerValue = pcData.attributes.social[powerAttr as AttributeSocial]?.value?.total ?? 0;
      finesseValue = pcData.attributes.social[finesseAttr as AttributeSocial]?.value?.total ?? 0;
      resistanceValue = pcData.attributes.social[resistanceAttr as AttributeSocial]?.value?.total ?? 0;
    }

    return {
      scarPower: powerValue,
      scarFinesse: finesseValue,
      scarResistance: resistanceValue
    };
  }

  /**
   * Finds a scar by key in an array of scars
   */
  static findScar(scars: ScarJSON[] | undefined, scarKey: string): ScarJSON | null {
    if (!scars) {
      return null;
    }
    return scars.find(s => s.key === scarKey) ?? null;
  }
}
