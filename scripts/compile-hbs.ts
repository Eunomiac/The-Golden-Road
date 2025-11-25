import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import type { HelperOptions } from "handlebars";
import Handlebars = require("handlebars");
import * as JSON5 from "json5";
import { PCSheet } from "./pc-sheets";
import type { PCJSONData } from "./pc-sheets";
import type { PCSheetData } from "./pc-sheets/types";
import { CurlyNotationProcessor } from "./pc-sheets/curly-notations/CurlyNotationProcessor";
import { NotationError } from "./pc-sheets/curly-notations/NotationError";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);

/**
 * Navigation item structure
 */
interface NavigationItem {
  name: string;
  filename: string;
  type: string;
  path: string; // Path from wiki root, e.g., "pcs/micah-vale.html"
}

/**
 * Navigation data grouped by type
 */
interface NavigationData {
  [type: string]: NavigationItem[];
}

interface TraitTagTooltipSource {
  book: string;
  page: number;
}

interface TraitTagTooltipDefinition {
  format?: string;
  title?: string;
  subtitle?: string;
  blocks?: string[];
  source?: TraitTagTooltipSource;
}

interface TraitTagDefinition {
  key: string;
  icon: string;
  size: number;
  gap?: number;
  tooltipTitle?: string;
  tooltipSubtitle?: string;
  tooltipBody?: string;
  tooltipCitation?: string;
  tooltip?: TraitTagTooltipDefinition;
}

interface RenderedTraitTagIcon {
  html: string;
  gap: number;
  size: number;
}

interface TraitTagRenderContext {
  sheetContext?: PCSheetData;
  thisEntity?: Record<string, unknown>;
  vars?: Record<string, unknown>;
}

type TraitTagDefinitionMap = Record<string, TraitTagDefinition>;

let cachedTraitTagDefinitions: TraitTagDefinitionMap | null = null;
const traitTagNotationProcessor = new CurlyNotationProcessor(false);

/**
 * Compile all Handlebars templates from wiki-src (excluding _partials) into HTML in wiki
 */
export async function main(): Promise<void> {
  const srcDir: string = path.resolve("wiki-src");
  const outDir: string = path.resolve("wiki");

  const exists: boolean = fs.existsSync(srcDir);
  if (!exists) {
    // Create the skeleton if missing to prevent errors on fresh setups
    await ensureDir(path.join(srcDir, "_partials"));
  }

  await registerAllPartials(path.join(srcDir, "_partials"), srcDir);
  const navigationData: NavigationData = await buildNavigationData(srcDir);
  registerHelpers(navigationData);
  const hbsFiles: string[] = await findHbsFiles(srcDir, [path.join(srcDir, "_partials")]);

  // Handle PC template separately (generates multiple HTML files from JSON)
  const pcTemplatePath: string = path.join(srcDir, "pcs", "pc-template.hbs");
  const pcTemplateIndex: number = hbsFiles.indexOf(pcTemplatePath);
  if (pcTemplateIndex !== -1) {
    await compilePCTemplates(pcTemplatePath, srcDir, outDir);
    // Remove from list so it doesn't get compiled as a regular template
    hbsFiles.splice(pcTemplateIndex, 1);
  }

  // Compile remaining templates
  for (const filePath of hbsFiles) {
    await compileTemplateFile(filePath, srcDir, outDir);
  }
}

/** Ensure a directory exists (mkdir -p behavior) */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

/** Recursively list .hbs files, excluding any path under excludeDirs */
async function findHbsFiles(rootDir: string, excludeDirs: string[]): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries: string[] = await readdir(currentDir);
    for (const entry of entries) {
      const fullPath: string = path.join(currentDir, entry);
      const st = await stat(fullPath);

      const isExcluded: boolean = excludeDirs.some((ex) => isPathInside(fullPath, ex));
      if (isExcluded) {
        continue;
      }

      if (st.isDirectory()) {
        await walk(fullPath);
      } else if (st.isFile() && fullPath.endsWith(".hbs")) {
        results.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return results;
}

/** Determine if childPath is inside parentPath (or equal) */
function isPathInside(childPath: string, parentPath: string): boolean {
  const rel: string = path.relative(parentPath, childPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Register all partials found under partialsDir. Partial name is posix-style relative path from srcDir, without extension */
async function registerAllPartials(partialsDir: string, srcDir: string): Promise<void> {
  if (!fs.existsSync(partialsDir)) {
    return;
  }

  const partialFiles: string[] = await findHbsFiles(partialsDir, []);
  for (const partialPath of partialFiles) {
    const name: string = toPartialName(partialPath, srcDir);
    const content: string = await readFile(partialPath, { encoding: "utf8" });
    Handlebars.registerPartial(name, content);
  }
}

/** Convert absolute file path to a partial name e.g., wiki-src/_partials/ui/button.hbs -> _partials/ui/button */
function toPartialName(absPath: string, srcDir: string): string {
  const rel: string = path.relative(srcDir, absPath).split(path.sep).join("/");
  return rel.replace(/\.hbs$/, "");
}

/** Compile a single .hbs file into an .html file in the outDir preserving structure */
async function compileTemplateFile(filePath: string, srcDir: string, outDir: string): Promise<void> {
  const relPath: string = path.relative(srcDir, filePath);
  const outRel: string = relPath.replace(/\.hbs$/, ".html");
  const outPath: string = path.join(outDir, outRel);

  const rawTemplate: string = await readFile(filePath, { encoding: "utf8" });
  const template = Handlebars.compile(rawTemplate, { noEscape: false });

  // Calculate current page path relative to wiki root for navigation
  const currentPagePath: string = outRel.replace(/\\/g, "/");

  // Pass current page path in context for navigation
  const html: string = template({ currentPagePath: currentPagePath });

  await ensureDir(path.dirname(outPath));
  await writeFile(outPath, html, { encoding: "utf8" });

  // Touch the file to ensure BrowserSync detects the change
  // Update the file's modification time slightly to trigger watchers
  try {
    const now = Date.now() / 1000;
    await new Promise<void>((resolve, reject) => {
      fs.utimes(outPath, now, now, (error: NodeJS.ErrnoException | null) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  } catch {
    // Ignore utimes errors - file write should be enough for most watchers
  }

  process.stdout.write(`Compiled: ${relPath} -> ${path.relative(process.cwd(), outPath)}\n`);
}

/**
 * Recursively find all JSON files in wiki-src, excluding those starting with underscore
 */
async function findNavigationJsonFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries: string[] = await readdir(currentDir);
    for (const entry of entries) {
      const fullPath: string = path.join(currentDir, entry);
      const st = await stat(fullPath);

      if (st.isDirectory()) {
        await walk(fullPath);
      } else if (st.isFile() && fullPath.endsWith(".json5")) {
        // Exclude files that start with underscore
        const basename: string = path.basename(entry);
        if (!basename.startsWith("_")) {
          results.push(fullPath);
        }
      }
    }
  }

  await walk(rootDir);
  return results;
}

/**
 * Build navigation data by scanning all JSON files in wiki-src
 */
async function buildNavigationData(srcDir: string): Promise<NavigationData> {
  const jsonFiles: string[] = await findNavigationJsonFiles(srcDir);
  const navigationData: NavigationData = {};

  for (const jsonPath of jsonFiles) {
    try {
      const jsonContent: string = await readFile(jsonPath, { encoding: "utf8" });
      const jsonData: { name?: string; type?: string } = JSON5.parse(jsonContent);

      // Skip if missing required properties
      if (!jsonData.name || !jsonData.type) {
        continue;
      }

      const filename: string = path.basename(jsonPath, ".json5");
      const itemPath: string = getNavItemPath(jsonData.type, filename);
      const item: NavigationItem = {
        name: jsonData.name,
        filename: filename,
        type: jsonData.type,
        path: itemPath,
      };

      // Group by type
      if (!navigationData[jsonData.type]) {
        navigationData[jsonData.type] = [];
      }
      navigationData[jsonData.type].push(item);
    } catch (error) {
      const message: string = error instanceof Error ? error.message : "Unknown error";
      process.stderr.write(`Failed to read navigation data from ${jsonPath}: ${message}\n`);
    }
  }

  // Sort items within each type by name
  for (const type in navigationData) {
    navigationData[type].sort((a: NavigationItem, b: NavigationItem) => {
      return a.name.localeCompare(b.name);
    });
  }

  return navigationData;
}

/**
 * Type to header text mapping
 */
const TYPE_HEADER_MAP: Record<string, string> = {
  pc: "Main Cast",
  npc: "Supporting Cast",
  organization: "Groups & Organizations",
  location: "Locations",
};

/**
 * Get the output path for a navigation item based on its type and filename
 */
function getNavItemPath(type: string, filename: string): string {
  switch (type) {
    case "pc":
      return `pcs/${filename}.html`;
    case "npc":
      return `touchstones/npcs/${filename}.html`;
    case "organization":
      return `touchstones/organizations/${filename}.html`;
    case "location":
      return `locations/${filename}.html`;
    default:
      return `${type}/${filename}.html`;
  }
}

/**
 * Calculate relative path from current page to target path
 */
function getRelativePath(fromPath: string, toPath: string): string {
  // Normalize paths
  const fromParts: string[] = fromPath.split("/").filter((p: string) => p !== "");
  const toParts: string[] = toPath.split("/").filter((p: string) => p !== "");

  // Remove the filename from fromPath (we only care about the directory)
  if (fromParts.length > 0) {
    fromParts.pop();
  }

  // Find common path prefix
  let commonLength: number = 0;
  const minLength: number = Math.min(fromParts.length, toParts.length - 1);
  while (commonLength < minLength && fromParts[commonLength] === toParts[commonLength]) {
    commonLength++;
  }

  // Calculate how many "../" we need
  const upLevels: number = fromParts.length - commonLength;
  const upPath: string = "../".repeat(upLevels);

  // Get the remaining path to the target
  const remainingParts: string[] = toParts.slice(commonLength);
  const downPath: string = remainingParts.join("/");

  if (upPath === "" && downPath === "") {
    return "./";
  }

  return upPath + (downPath || "");
}

/** Register common helpers for templates */
function registerHelpers(navigationData: NavigationData): void {
  // repeat: repeat a string a given number of times, e.g., {{repeat "●" 3}}
  // Supports HTML strings, e.g., {{repeat "<span>Text</span>" 5}}
  Handlebars.registerHelper("repeat", (text: unknown, count: unknown) => {
    const str: string = typeof text === "string" ? text : String(text);
    const nRaw: number | null = typeof count === "number" ? count : Number(count);
    const n: number = Number.isFinite(nRaw) && nRaw !== null ? Math.max(0, Math.floor(nRaw)) : 0;
    return new Handlebars.SafeString(str.repeat(n));
  });

  // Arithmetic helpers: {{number "+" number}} or {{number "-" number}}
  // Missing numbers are treated as zero, e.g., {{"-" 5}} outputs -5
  Handlebars.registerHelper("+", (a: unknown, b: unknown) => {
    const numA: number = parseNumber(a);
    const numB: number = parseNumber(b);
    return numA + numB;
  });

  Handlebars.registerHelper("-", (a: unknown, b: unknown) => {
    const numA: number = parseNumber(a);
    const numB: number = parseNumber(b);
    return numA - numB;
  });

  // signed: formats a number with a sign prefix, e.g., {{signed 5}} outputs +5, {{signed -3}} outputs −3, {{signed 0}} outputs +0
  // Uses Unicode minus sign (U+2212) for negative numbers, not a hyphen
  Handlebars.registerHelper("signed", (value: unknown) => {
    const num: number = parseNumber(value);
    const absNum: number = Math.abs(num);
    if (num < 0) {
      // Use Unicode minus sign (U+2212) for negative numbers
      return `−${absNum}`;
    } else {
      // Use plus sign for zero and positive numbers
      return `+${absNum}`;
    }
  });

  // min: returns the minimum of all provided numbers, e.g., {{min 5 3 8 2}} outputs 2
  Handlebars.registerHelper("min", (...args: unknown[]) => {
    // Remove the last argument (Handlebars options object)
    const numbers: number[] = args.slice(0, -1).map(parseNumber);
    if (numbers.length === 0) {
      return 0;
    }
    return Math.min(...numbers);
  });

  // max: returns the maximum of all provided numbers, e.g., {{max 5 3 8 2}} outputs 8
  Handlebars.registerHelper("max", (...args: unknown[]) => {
    // Remove the last argument (Handlebars options object)
    const numbers: number[] = args.slice(0, -1).map(parseNumber);
    if (numbers.length === 0) {
      return 0;
    }
    return Math.max(...numbers);
  });

  // split: splits a string by a delimiter and returns an array with trailing whitespace trimmed, e.g., {{#each (split "a,b,c" ",")}}{{this}}{{/each}}
  Handlebars.registerHelper("split", (str: unknown, delimiter: unknown) => {
    const inputStr: string = str === null || str === undefined ? "" : String(str);
    const del: string = delimiter === null || delimiter === undefined ? "" : String(delimiter);

    if (inputStr === "" || del === "") {
      return inputStr === "" ? [] : [inputStr];
    }

    return inputStr.split(del).map((item: string) => item.trim());
  });

  // eq: returns true if both values are equal, e.g., {{#if (eq type "skill")}}...{{/if}}
  Handlebars.registerHelper("eq", (a: unknown, b: unknown) => {
    return a === b;
  });

  Handlebars.registerHelper("hasTag", (tags: unknown, tagToFind: unknown) => {
    if (!Array.isArray(tags) || typeof tagToFind !== "string") {
      return false;
    }
    return tags.includes(tagToFind);
  });

  // range: generates an array of numbers from start to end (inclusive), e.g., {{#each (range 1 5)}}{{this}}{{/each}}
  Handlebars.registerHelper("range", (...args: unknown[]) => {
    // Handlebars passes options as last argument, so we need to extract the actual arguments
    const actualArgs = args.slice(0, -1);
    const start = actualArgs[0];
    const end = actualArgs[1];
    const startNum: number = parseNumber(start);
    const endNum: number = parseNumber(end);
    const result: number[] = [];
    for (let i = startNum; i <= endNum; i++) {
      result.push(i);
    }
    return result;
  });

  // toString: converts a value to string, e.g., {{toString 5}} outputs "5"
  Handlebars.registerHelper("toString", (value: unknown) => {
    return String(value);
  });

  // getBookName: maps book abbreviation to full name
  const bookNameMap: Record<string, string> = {
    CoD: "Chronicles of Darkness",
    HL: "Hurt Locker",
    DtR: "Deviant: the Renegades",
    SG: "Shallow Graves",
    CC: "The Clade Companion"
  };

  Handlebars.registerHelper("getBookName", (abbreviation: unknown) => {
    const abbrev = String(abbreviation);
    return bookNameMap[abbrev] ?? abbrev;
  });

  // getNavigationData: returns navigation data grouped by type for the master navigation, in a specific order
  Handlebars.registerHelper("getNavigationData", () => {
    // Define the desired order of types
    const typeOrder: string[] = ["pc", "organization", "npc", "location"];

    // Create an ordered array of objects with type and items
    const orderedData: Array<{ type: string; items: NavigationItem[] }> = [];

    for (const type of typeOrder) {
      if (navigationData[type] && navigationData[type].length > 0) {
        orderedData.push({
          type: type,
          items: navigationData[type],
        });
      }
    }

    // Add any remaining types that weren't in the order list (for future extensibility)
    for (const type in navigationData) {
      if (!typeOrder.includes(type) && navigationData[type].length > 0) {
        orderedData.push({
          type: type,
          items: navigationData[type],
        });
      }
    }

    return orderedData;
  });

  // getTypeHeader: returns the header text for a given type
  Handlebars.registerHelper("getTypeHeader", (type: unknown) => {
    const typeStr: string = typeof type === "string" ? type : String(type);
    return TYPE_HEADER_MAP[typeStr] || typeStr;
  });

  // getNavPath: calculates relative path from current page to target navigation item
  // Usage: {{getNavPath item.path currentPagePath}}
  Handlebars.registerHelper("getNavPath", (targetPath: unknown, currentPath: unknown) => {
    const target: string = typeof targetPath === "string" ? targetPath : String(targetPath);
    const current: string = typeof currentPath === "string" ? currentPath : String(currentPath);

    if (!target || !current) {
      return target || "";
    }

    return getRelativePath(current, target);
  });

  Handlebars.registerHelper("inlineLabel", (html: unknown, label: unknown) => {
    const htmlContent = toTrimmedString(html);
    const labelText = toTrimmedString(label);
    if (!htmlContent || !labelText) {
      return htmlContent ?? "";
    }
    const injected = injectInlineLabel(htmlContent, labelText);
    return new Handlebars.SafeString(injected);
  });

  Handlebars.registerHelper("meritLevelLabel", (name: unknown, level: unknown) => {
    return buildMeritLevelLabel(name, level);
  });

  Handlebars.registerHelper("tagged", function taggedHelper(
    this: unknown,
    options: HelperOptions & { hash: { tags?: unknown; class?: unknown } }
  ) {
    const tags: string[] = normalizeTagKeys(options.hash?.tags);
    const content = options.fn ? options.fn(this) : "";
    if (tags.length === 0 || content.length === 0) {
      return new Handlebars.SafeString(content);
    }

    const definitions = loadTraitTagDefinitions();
    const sheetContext = options.data?.root as PCSheetData | undefined;

    // Extract thisEntity and vars from the current context (e.g., scar or variation)
    // The 'this' context in Handlebars helpers refers to the current scope
    const currentContext = this as Record<string, unknown> | undefined;
    const thisEntity = currentContext && typeof currentContext === "object" && !Array.isArray(currentContext)
      ? currentContext as Record<string, unknown>
      : undefined;
    const vars = thisEntity && typeof thisEntity.vars === "object" && thisEntity.vars !== null && !Array.isArray(thisEntity.vars)
      ? thisEntity.vars as Record<string, unknown>
      : undefined;

    const renderedIcons: RenderedTraitTagIcon[] = tags
      .map((tagKey) => definitions[tagKey])
      .filter((definition): definition is TraitTagDefinition => Boolean(definition))
      .map((definition) => renderTraitTagIcon(definition, sheetContext, thisEntity, vars));

    if (renderedIcons.length === 0) {
      return new Handlebars.SafeString(content);
    }

    const gap = renderedIcons.reduce<number>((currentGap, icon) => {
      return Math.max(currentGap, icon.gap);
    }, 0);
    const maxIconSize = renderedIcons.reduce<number>((currentMax, icon) => {
      return Math.max(currentMax, icon.size);
    }, 0);

    const classNames: string[] = ["tagged-trait"];
    if (typeof options.hash?.class === "string") {
      const trimmed = options.hash.class.trim();
      if (trimmed.length > 0) {
        classNames.push(trimmed);
      }
    }

    const iconMarkup = renderedIcons.map((icon) => icon.html).join("");
    const taggedContent = `<span class="${classNames.join(" ")}">${content}</span>`;

    const wrapper = [
      `<span class="trait-tagged-block" data-trait-tag-count="${renderedIcons.length}"`,
      ` style="--trait-tag-gap:${gap}px; --trait-tag-icon-max:${maxIconSize}px;">`,
      `<span class="trait-tag-icon-row">`,
      iconMarkup,
      "</span>",
      taggedContent,
      "</span>"
    ].join("");

    return new Handlebars.SafeString(wrapper);
  });
}

function injectInlineLabel(html: string, label: string): string {
  const labelPattern = buildLabelPattern(label);
  if (labelPattern.test(html)) {
    return html;
  }

  const labelMarkup = `<strong>${label}</strong> `;
  if (/^<p[\s>]/i.test(html)) {
    return html.replace(/<p([^>]*)>/i, `<p$1>${labelMarkup}`);
  }

  return `<p>${labelMarkup}${html}</p>`;
}

function buildLabelPattern(label: string): RegExp {
  const escapedLabel = escapeRegExp(label);
  return new RegExp(`<strong[^>]*>\\s*${escapedLabel}\\s*</strong>`, "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadTraitTagDefinitions(): TraitTagDefinitionMap {
  if (cachedTraitTagDefinitions) {
    return cachedTraitTagDefinitions;
  }

  const jsonPath: string = path.resolve("wiki-src", "system-data", "_trait-tags.json5");
  if (!fs.existsSync(jsonPath)) {
    cachedTraitTagDefinitions = {};
    return cachedTraitTagDefinitions;
  }

  try {
    const jsonContent: string = fs.readFileSync(jsonPath, { encoding: "utf8" });
    const parsed = JSON5.parse(jsonContent) as Record<string, TraitTagDefinition>;
    cachedTraitTagDefinitions = Object.keys(parsed).reduce<TraitTagDefinitionMap>((acc, key) => {
      const definition = parsed[key];
      if (
        definition
        && typeof definition.key === "string"
        && typeof definition.icon === "string"
        && typeof definition.size === "number"
        && definition.size > 0
      ) {
        acc[key] = {
          key: definition.key,
          icon: definition.icon,
          size: definition.size,
          gap: typeof definition.gap === "number" && definition.gap >= 0 ? definition.gap : 0,
          tooltipTitle: toTrimmedString(definition.tooltipTitle),
          tooltipSubtitle: toTrimmedString(definition.tooltipSubtitle),
          tooltipBody: toTrimmedString(definition.tooltipBody),
          tooltipCitation: toTrimmedString(definition.tooltipCitation),
          tooltip: sanitizeTraitTagTooltip(definition.tooltip)
        };
      }
      return acc;
    }, {});
    return cachedTraitTagDefinitions;
  } catch {
    cachedTraitTagDefinitions = {};
    return cachedTraitTagDefinitions;
  }
}

function normalizeTagKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  return [];
}

function renderTraitTagIcon(
  definition: TraitTagDefinition,
  sheetContext?: PCSheetData,
  thisEntity?: Record<string, unknown>,
  vars?: Record<string, unknown>
): RenderedTraitTagIcon {
  const anchorId = generateTooltipAnchor();
  const escapedIcon = Handlebars.escapeExpression(definition.icon);
  const fallbackLabel =
    definition.tooltip?.title
    ?? definition.tooltipTitle
    ?? definition.key;
  const labelText = stripHtmlTags(processTraitTagText(fallbackLabel, { sheetContext, thisEntity, vars }));
  const escapedLabel = Handlebars.escapeExpression(labelText.length > 0 ? labelText : fallbackLabel);

  const tooltipHtml = buildTraitTagTooltipContent(definition, { sheetContext, thisEntity, vars });
  const tooltipClasses = buildTraitTagTooltipClasses(definition);

  const iconHtml = [
    `<span class="trait-tag-icon has-tooltip" style="width:${definition.size}px;height:${definition.size}px; anchor-name: --${anchorId};" aria-label="${escapedLabel}">`,
    `<img src="${escapedIcon}" alt="" role="presentation" />`,
    "</span>",
    `<div class="${tooltipClasses}" style="position-anchor: --${anchorId};">`,
    tooltipHtml,
    "</div>"
  ].join("");

  return {
    html: iconHtml,
    gap: typeof definition.gap === "number" && definition.gap >= 0 ? definition.gap : 0,
    size: definition.size
  };
}

function generateTooltipAnchor(): string {
  return Math.random().toString(36).substring(2, 10);
}

function sanitizeTraitTagTooltip(raw: unknown): TraitTagTooltipDefinition | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const format = sanitizeClassList(record.format);
  const title = toTrimmedString(record.title);
  const subtitle = toTrimmedString(record.subtitle);
  const blocks = Array.isArray(record.blocks)
    ? record.blocks
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0)
    : undefined;
    const source = sanitizeTraitTagTooltipSource(record.source);

    if (!format && !title && !subtitle && (!blocks || blocks.length === 0) && !source) {
      return undefined;
    }

    return {
      format: format ?? undefined,
      title,
      subtitle,
      blocks,
      source
    };
  }

  function sanitizeTraitTagTooltipSource(raw: unknown): TraitTagTooltipSource | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    const record = raw as Record<string, unknown>;
    const book = toTrimmedString(record.book);
    const pageValue = record.page;
    const page = typeof pageValue === "number"
      ? pageValue
      : (typeof pageValue === "string" ? parseInt(pageValue.trim(), 10) : undefined);

    if (!book || !page || isNaN(page)) {
      return undefined;
    }

    return { book, page };
  }

function sanitizeClassList(value: unknown): string | undefined {
  if (typeof value === "string") {
    const tokens = value.split(/\s+/).filter((token) => token.length > 0);
    return tokens.length > 0 ? tokens.join(" ") : undefined;
  }
  if (Array.isArray(value)) {
    const tokens = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((token) => token.length > 0);
    return tokens.length > 0 ? tokens.join(" ") : undefined;
  }
  return undefined;
}

function buildTraitTagTooltipContent(
  definition: TraitTagDefinition,
  context: TraitTagRenderContext
): string {
  const tooltip = definition.tooltip;
  const segments: string[] = [];

  if (tooltip) {
    if (tooltip.title) {
      segments.push(
        `<span class='tooltip-title'>${processTraitTagText(tooltip.title, context)}</span>`
      );
    }
    if (tooltip.subtitle) {
      segments.push(
        `<span class='tooltip-subtitle'>${processTraitTagText(tooltip.subtitle, context)}</span>`
      );
    }
    if (Array.isArray(tooltip.blocks)) {
      tooltip.blocks.forEach((block) => {
        segments.push(
          `<span class='tooltip-block'>${processTraitTagText(block, context)}</span>`
        );
      });
    }
    if (tooltip.source) {
      // Use the same source-citation partial as scars/variations
      const sourceMarkup = renderTraitTagSource(tooltip.source, context);
      if (sourceMarkup) {
        segments.push(sourceMarkup);
      }
    }
    if (segments.length > 0) {
      return segments.join("");
    }
  }

  if (definition.tooltipTitle) {
    segments.push(
      `<span class='tooltip-title'>${processTraitTagText(definition.tooltipTitle, context)}</span>`
    );
  }
  if (definition.tooltipSubtitle) {
    segments.push(
      `<span class='tooltip-subtitle'>${processTraitTagText(definition.tooltipSubtitle, context)}</span>`
    );
  }
  if (definition.tooltipBody) {
    segments.push(
      `<span class='tooltip-block'>${processTraitTagText(definition.tooltipBody, context)}</span>`
    );
  }
  if (definition.tooltipCitation) {
    segments.push(
      `<span class='tooltip-block tooltip-citation'>${processTraitTagText(definition.tooltipCitation, context)}</span>`
    );
  }

  return segments.join("");
}

function buildTraitTagTooltipClasses(definition: TraitTagDefinition): string {
  const classes = ["tooltip", "trait-tag-tooltip"];
  if (definition.tooltip?.format) {
    const tokens = definition.tooltip.format.split(/\s+/).filter((token) => token.length > 0);
    classes.push(...tokens);
  }
  return classes.join(" ");
}

function renderTraitTagSource(
  source: TraitTagTooltipSource,
  context: TraitTagRenderContext
): string {
  // Get the book name using the same mapping as getBookName helper
  // This matches the bookNameMap in registerHelpers
  const bookNameMap: Record<string, string> = {
    CoD: "Chronicles of Darkness",
    HL: "Hurt Locker",
    DtR: "Deviant: the Renegades",
    SG: "Shallow Graves",
    CC: "The Clade Companion"
  };
  const bookName = bookNameMap[source.book] ?? source.book;

  // Format the source citation the same way as scars/variations use in source-citation.hbs
  return `<span class="tooltip-block tooltip-citation">
    <span class="source-citation">
      <span class="source-title">${bookName}</span>
      <span class="source-page">p.${source.page}</span>
    </span>
  </span>`;
}

function processTraitTagText(text: string, context: TraitTagRenderContext): string {
  if (!text) {
    return "";
  }

  const sheetContext = context.sheetContext;
  if (!sheetContext) {
    return text;
  }

  try {
    // Build processing context with thisEntity and vars if available
    const processingContext = {
      context: sheetContext,
      thisEntity: context.thisEntity,
      vars: context.vars,
      strict: false
    };

    // Process with finalizeTooltips=true to ensure all tooltip placeholders are resolved
    // The processor's internal loop should handle all nested notations
    let processed = traitTagNotationProcessor.process(text, processingContext, { finalizeTooltips: true });

    // Ensure any remaining tooltip placeholders are finalized
    const finalized = traitTagNotationProcessor.finalizeTooltipPlaceholders(processed, processingContext) ?? processed;

    // Check if there are still unresolved curly notations and process again if needed
    // This handles cases where tooltip placeholders contained notations
    if (finalized.includes("{{") && finalized.includes("}}")) {
      const reprocessed = traitTagNotationProcessor.process(finalized, processingContext, { finalizeTooltips: true });
      // Only use reprocessed if it actually changed something
      if (reprocessed !== finalized) {
        return reprocessed;
      }
    }

    return finalized;
  } catch (error) {
    // Log error but return the text to prevent breaking the build
    // In strict mode, this would throw, but we're in non-strict mode for tooltips
    console.warn("Error processing trait tag text:", error, text);
    return text;
  }
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildMeritLevelLabel(name: unknown, level: unknown): string {
  const safeName = toTrimmedString(name);
  const levelNumberRaw = typeof level === "number" ? level : Number(level);
  const levelNumber = Number.isFinite(levelNumberRaw) ? Math.max(0, Math.floor(levelNumberRaw)) : 0;
  const dots = levelNumber > 0 ? "●".repeat(levelNumber) : "";
  const baseLabel = safeName ?? (levelNumber > 0 ? `Level ${levelNumber}` : "Level");
  if (dots.length > 0) {
    return `${baseLabel} (${dots}):`;
  }
  return `${baseLabel}:`;
}

/** Parse a value as a number, defaulting to 0 if invalid or missing */
function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Find all JSON files in a directory */
async function findJsonFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries: string[] = await readdir(dir);
  for (const entry of entries) {
    const fullPath: string = path.join(dir, entry);
    const st = await stat(fullPath);
    if (st.isFile() && fullPath.endsWith(".json5")) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Compile PC templates from JSON files */
async function compilePCTemplates(
  templatePath: string,
  srcDir: string,
  outDir: string
): Promise<void> {
  const jsonDir: string = path.join(srcDir, "pcs", "json");
  const jsonFiles: string[] = await findJsonFiles(jsonDir);

  if (jsonFiles.length === 0) {
    process.stdout.write(`No JSON files found in ${path.relative(process.cwd(), jsonDir)}\n`);
    return;
  }

  const templateContent: string = await readFile(templatePath, { encoding: "utf8" });
  const template = Handlebars.compile(templateContent, { noEscape: false });

  for (const jsonPath of jsonFiles) {
    try {
      const jsonContent: string = await readFile(jsonPath, { encoding: "utf8" });
      const jsonData: PCJSONData = JSON5.parse(jsonContent);
      const sheet: PCSheet = new PCSheet(jsonData);
      const context = sheet.getData();

      const characterName: string = path.basename(jsonPath, ".json5");
      const outPath: string = path.join(outDir, "pcs", `${characterName}.html`);

      // Calculate current page path relative to wiki root for navigation
      const currentPagePath: string = `pcs/${characterName}.html`;

      await ensureDir(path.dirname(outPath));
      // Add current page path to context for navigation
      const html: string = template({ ...context, currentPagePath: currentPagePath });
      await writeFile(outPath, html, { encoding: "utf8" });

      // Touch the file to ensure BrowserSync detects the change
      try {
        const now = Date.now() / 1000;
        await new Promise<void>((resolve, reject) => {
          fs.utimes(outPath, now, now, (error: NodeJS.ErrnoException | null) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      } catch {
        // Ignore utimes errors
      }

      process.stdout.write(
        `Compiled PC: ${path.relative(process.cwd(), jsonPath)} -> ${path.relative(process.cwd(), outPath)}\n`
      );
    } catch (error) {
      const message: string = error instanceof Error ? error.message : "Unknown error";
      process.stderr.write(`Failed to compile ${jsonPath}: ${message}\n`);
    }
  }
}

// Allow running directly via `tsx scripts/compile-hbs.ts`
if (require.main === module) {
  main().catch((error: unknown) => {
    const message: string = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("HBS compile failed:", message);
    process.exitCode = 1;
  });
}
