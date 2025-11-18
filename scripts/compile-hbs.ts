import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import Handlebars = require("handlebars");
import { PCSheet } from "./pc-sheets";
import type { PCJSONData } from "./pc-sheets";

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
      } else if (st.isFile() && fullPath.endsWith(".json")) {
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
      const jsonData: { name?: string; type?: string } = JSON.parse(jsonContent);

      // Skip if missing required properties
      if (!jsonData.name || !jsonData.type) {
        continue;
      }

      const filename: string = path.basename(jsonPath, ".json");
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
    console.log(`🔍 range helper: start=${start} (parsed: ${startNum}), end=${end} (parsed: ${endNum})`);
    const result: number[] = [];
    for (let i = startNum; i <= endNum; i++) {
      result.push(i);
    }
    console.log(`🔍 range helper: result=`, result);
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
    if (st.isFile() && fullPath.endsWith(".json")) {
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
      const jsonData: PCJSONData = JSON.parse(jsonContent);
      const sheet: PCSheet = new PCSheet(jsonData);
      const context = sheet.getData();

      const characterName: string = path.basename(jsonPath, ".json");
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
