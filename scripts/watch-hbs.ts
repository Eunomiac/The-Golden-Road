import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import { main as compileAll } from "./compile-hbs";

let isCompiling: boolean = false;
let pending: NodeJS.Timeout | null = null;

async function runCompile(): Promise<void> {
  if (isCompiling) {
    return;
  }

  isCompiling = true;
  try {
    await compileAll();
    // eslint-disable-next-line no-console
    console.log("[HBS] Compilation complete.");

    // Trigger BrowserSync reload via HTTP API (port 3001 is BrowserSync's control port)
    triggerBrowserSyncReload();
  } catch (error) {
    const message: string = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("[HBS] Compile failed:", message);
  } finally {
    isCompiling = false;
  }
}

// Resolve and normalize the path to handle special characters
let srcDir: string = path.resolve("wiki-src");
try {
  // Use realpathSync to get the actual normalized path - helps with special chars
  srcDir = fs.realpathSync(srcDir);
} catch (error) {
  // If realpath fails, use the resolved path
  // eslint-disable-next-line no-console
  console.warn("[HBS] Could not get realpath, using resolved path");
}
// eslint-disable-next-line no-console
console.log(`[HBS] Watching ${srcDir} for .hbs and .json file changes...`);
// eslint-disable-next-line no-console
console.log(`[HBS] Watching directory: ${srcDir}`);

// Function to recursively find all .hbs files
function findHbsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries: string[] = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath: string = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...findHbsFiles(fullPath));
      } else if (fullPath.endsWith(".hbs")) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    // Ignore errors
  }
  return results;
}

// Function to find all .json files in wiki-src/pcs/json/
function findJsonFiles(dir: string): string[] {
  const results: string[] = [];
  const jsonDir: string = path.join(dir, "pcs", "json");
  if (!fs.existsSync(jsonDir)) {
    return results;
  }
  try {
    const entries: string[] = fs.readdirSync(jsonDir);
    for (const entry of entries) {
      const fullPath: string = path.join(jsonDir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && fullPath.endsWith(".json")) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    // Ignore errors
  }
  return results;
}

// Find all .hbs files - we'll poll these manually since chokidar isn't detecting changes
const hbsFiles: string[] = findHbsFiles(srcDir);
// Find all .json files for PC sheets
const jsonFiles: string[] = findJsonFiles(srcDir);
// eslint-disable-next-line no-console
console.log(`[HBS] Found ${hbsFiles.length} .hbs files and ${jsonFiles.length} .json files to watch`);

// Store file modification times for both HBS and JSON files
const fileTimestamps: Map<string, number> = new Map();
const allWatchedFiles: string[] = [...hbsFiles, ...jsonFiles];

function updateTimestamps(): void {
  for (const filePath of allWatchedFiles) {
    try {
      const stats = fs.statSync(filePath);
      fileTimestamps.set(filePath, stats.mtimeMs);
    } catch {
      // File might not exist yet
    }
  }
}

// Initial timestamp check
updateTimestamps();

// Manual polling loop - check file modification times every 500ms
setInterval(() => {
  let hasChanges: boolean = false;

  // Check for new HBS files
  const currentHbsFiles: string[] = findHbsFiles(srcDir);
  for (const filePath of currentHbsFiles) {
    if (!hbsFiles.includes(filePath)) {
      // eslint-disable-next-line no-console
      console.log(`[HBS] Detected new HBS file: ${path.relative(process.cwd(), filePath)}`);
      hbsFiles.push(filePath);
      allWatchedFiles.push(filePath);
      hasChanges = true;
    }
  }

  // Check for new JSON files
  const currentJsonFiles: string[] = findJsonFiles(srcDir);
  for (const filePath of currentJsonFiles) {
    if (!jsonFiles.includes(filePath)) {
      // eslint-disable-next-line no-console
      console.log(`[HBS] Detected new JSON file: ${path.relative(process.cwd(), filePath)}`);
      jsonFiles.push(filePath);
      allWatchedFiles.push(filePath);
      hasChanges = true;
    }
  }

  // Check for modified files (both HBS and JSON)
  for (const filePath of allWatchedFiles) {
    try {
      const stats = fs.statSync(filePath);
      const currentMtime: number = stats.mtimeMs;
      const lastMtime: number | undefined = fileTimestamps.get(filePath);

      if (lastMtime === undefined || currentMtime > lastMtime) {
        fileTimestamps.set(filePath, currentMtime);
        if (lastMtime !== undefined) {
          const fileType: string = filePath.endsWith(".json") ? "JSON" : "HBS";
          // eslint-disable-next-line no-console
          console.log(`[HBS] Detected ${fileType} change: ${path.relative(process.cwd(), filePath)}`);
          hasChanges = true;
        }
      }
    } catch {
      // File might have been deleted
      const index = allWatchedFiles.indexOf(filePath);
      if (index > -1) {
        allWatchedFiles.splice(index, 1);
        fileTimestamps.delete(filePath);
        if (filePath.endsWith(".json")) {
          const jsonIndex = jsonFiles.indexOf(filePath);
          if (jsonIndex > -1) {
            jsonFiles.splice(jsonIndex, 1);
          }
        } else {
          const hbsIndex = hbsFiles.indexOf(filePath);
          if (hbsIndex > -1) {
            hbsFiles.splice(hbsIndex, 1);
          }
        }
        // eslint-disable-next-line no-console
        console.log(`[HBS] Detected deleted file: ${path.relative(process.cwd(), filePath)}`);
        hasChanges = true;
      }
    }
  }

  // Trigger compilation if there were changes
  if (hasChanges && pending === null) {
    pending = setTimeout(() => {
      runCompile().catch((error: unknown) => {
        const message: string = error instanceof Error ? error.message : "Unknown error";
        // eslint-disable-next-line no-console
        console.error("[HBS] Compile error:", message);
      });
      pending = null;
    }, 300);
  }
}, 500); // Poll every 500ms

// eslint-disable-next-line no-console
console.log("[HBS] Using manual file polling (chokidar not detecting changes with special chars)");
runCompile().catch((error: unknown) => {
  const message: string = error instanceof Error ? error.message : "Unknown error";
  // eslint-disable-next-line no-console
  console.error("[HBS] Initial compile error:", message);
});

// Keep process alive - prevent exit
process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
  // eslint-disable-next-line no-console
  console.error("[HBS] Unhandled rejection:", reason);
  // eslint-disable-next-line no-console
  console.error("[HBS] Promise:", promise);
});

process.on("uncaughtException", (error: Error) => {
  // eslint-disable-next-line no-console
  console.error("[HBS] Uncaught exception:", error.message);
  // Don't exit - keep watching
});

// Function to trigger BrowserSync reload via HTTP API
function triggerBrowserSyncReload(): void {
  const options: http.RequestOptions = {
    hostname: "localhost",
    port: 3001, // BrowserSync control port
    path: "/__browser_sync__?method=reload",
    method: "GET",
  };

  const req = http.request(options, (res: http.IncomingMessage) => {
    // Reload triggered
  });

  req.on("error", () => {
    // BrowserSync might not be running yet or control port might be different
    // Fallback: try touching trigger file
    const triggerFile: string = path.join("wiki", ".bs-trigger");
    try {
      fs.writeFileSync(triggerFile, `${Date.now()}\n`, { encoding: "utf8" });
    } catch {
      // Ignore errors
    }
  });

  req.end();
}

// Watch CSS file for changes (triggered by Sass compilation)
const cssFile: string = path.join("wiki", "styles", "styles.css");
let cssLastModified: number = 0;

try {
  const stats = fs.statSync(cssFile);
  cssLastModified = stats.mtimeMs;
} catch {
  // CSS file might not exist yet
}

// Poll CSS file for changes (Sass compiles it)
setInterval(() => {
  try {
    const stats = fs.statSync(cssFile);
    if (stats.mtimeMs > cssLastModified) {
      cssLastModified = stats.mtimeMs;
      // eslint-disable-next-line no-console
      console.log("[HBS] CSS file changed, triggering reload");
      triggerBrowserSyncReload();
    }
  } catch {
    // CSS file might not exist
  }
}, 300); // Check CSS every 300ms

// Process stays alive via setInterval polling loops
