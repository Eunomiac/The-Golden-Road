import * as path from "path";
import * as fs from "fs";
import * as http from "http";

/**
 * Watch TypeScript source files and trigger BrowserSync reload when compiled JS files change.
 * This script monitors the TypeScript source directory and the compiled output directory,
 * triggering a BrowserSync reload when changes are detected.
 */

// Resolve and normalize paths
const tsSourceDir: string = path.resolve("wiki-src/ts");
const jsOutputDir: string = path.resolve("wiki/scripts");
const additionalTsDirs: string[] = [
  path.resolve("scripts")
];

/**
 * Trigger BrowserSync reload via HTTP API or fallback to trigger file
 */
function triggerBrowserSyncReload(): void {
  const options: http.RequestOptions = {
    hostname: "localhost",
    port: 3001, // BrowserSync control port
    path: "/__browser_sync__?method=reload",
    method: "GET",
  };

  const req = http.request(options, () => {
    // Reload triggered successfully
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

/**
 * Recursively find all TypeScript files in a directory
 */
function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) {
    return results;
  }

  try {
    const entries: string[] = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath: string = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === "node_modules") {
          continue;
        }
        results.push(...findTsFiles(fullPath));
      } else if (fullPath.endsWith(".ts") && !fullPath.endsWith(".d.ts")) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore errors
  }
  return results;
}

/**
 * Get the corresponding JS file path for a TS file
 */
function getJsPath(tsPath: string): string {
  const relativePath: string = path.relative(tsSourceDir, tsPath);
  const jsRelativePath: string = relativePath.replace(/\.ts$/, ".js");
  return path.join(jsOutputDir, jsRelativePath);
}

// Find all TypeScript source files
let tsFiles: string[] = findTsFiles(tsSourceDir);
let additionalTsFiles: string[] = collectAdditionalTsFiles();
// eslint-disable-next-line no-console
console.log(`[TS] Found ${tsFiles.length} TypeScript files in ${path.relative(process.cwd(), tsSourceDir)} to watch`);
// eslint-disable-next-line no-console
console.log(`[TS] Found ${additionalTsFiles.length} additional TypeScript files to watch across ${additionalTsDirs.length} directories`);

// Store file modification times for TypeScript source files
const tsFileTimestamps: Map<string, number> = new Map();
// Store file modification times for compiled JavaScript files
const jsFileTimestamps: Map<string, number> = new Map();
const additionalTsFileTimestamps: Map<string, number> = new Map();

/**
 * Update timestamps for all watched files
 */
function updateTimestamps(): void {
  // Update TS source file timestamps
  for (const tsPath of tsFiles) {
    try {
      const stats = fs.statSync(tsPath);
      tsFileTimestamps.set(tsPath, stats.mtimeMs);
    } catch {
      // File might not exist yet
    }
  }

  // Update JS output file timestamps
  for (const tsPath of tsFiles) {
    const jsPath: string = getJsPath(tsPath);
    try {
      if (fs.existsSync(jsPath)) {
        const stats = fs.statSync(jsPath);
        jsFileTimestamps.set(jsPath, stats.mtimeMs);
      }
    } catch {
      // File might not exist yet
    }
  }

  // Update additional TS file timestamps
  for (const tsPath of additionalTsFiles) {
    try {
      const stats = fs.statSync(tsPath);
      additionalTsFileTimestamps.set(tsPath, stats.mtimeMs);
    } catch {
      // ignore
    }
  }
}

// Initial timestamp check
updateTimestamps();

// Manual polling loop - check file modification times every 500ms
setInterval(() => {
  let hasChanges: boolean = false;
  let shouldReload: boolean = false;

  // Check for new TypeScript files
  const currentTsFiles: string[] = findTsFiles(tsSourceDir);
  for (const tsPath of currentTsFiles) {
    if (!tsFiles.includes(tsPath)) {
      // eslint-disable-next-line no-console
      console.log(`[TS] Detected new TypeScript file: ${path.relative(process.cwd(), tsPath)}`);
      tsFiles.push(tsPath);
      hasChanges = true;
    }
  }

  // Check for modified TypeScript source files
  for (const tsPath of tsFiles) {
    try {
      const stats = fs.statSync(tsPath);
      const currentMtime: number = stats.mtimeMs;
      const lastMtime: number | undefined = tsFileTimestamps.get(tsPath);

      if (lastMtime === undefined || currentMtime > lastMtime) {
        tsFileTimestamps.set(tsPath, currentMtime);
        if (lastMtime !== undefined) {
          // eslint-disable-next-line no-console
          console.log(`[TS] Detected TypeScript source change: ${path.relative(process.cwd(), tsPath)}`);
          hasChanges = true;
          shouldReload = true;
        }
      }
    } catch {
      // File might have been deleted
      const index = tsFiles.indexOf(tsPath);
      if (index > -1) {
        tsFiles.splice(index, 1);
        tsFileTimestamps.delete(tsPath);
        const jsPath: string = getJsPath(tsPath);
        jsFileTimestamps.delete(jsPath);
        // eslint-disable-next-line no-console
        console.log(`[TS] Detected deleted TypeScript file: ${path.relative(process.cwd(), tsPath)}`);
        hasChanges = true;
        shouldReload = true;
      }
    }
  }

  // Check for modified compiled JavaScript files (indicating TypeScript compilation completed)
  for (const tsPath of tsFiles) {
    const jsPath: string = getJsPath(tsPath);
    try {
      if (fs.existsSync(jsPath)) {
        const stats = fs.statSync(jsPath);
        const currentMtime: number = stats.mtimeMs;
        const lastMtime: number | undefined = jsFileTimestamps.get(jsPath);

        if (lastMtime === undefined || currentMtime > lastMtime) {
          jsFileTimestamps.set(jsPath, currentMtime);
          if (lastMtime !== undefined) {
            // eslint-disable-next-line no-console
            console.log(`[TS] Detected compiled JavaScript change: ${path.relative(process.cwd(), jsPath)}`);
            shouldReload = true;
          }
        }
      }
    } catch {
      // File might not exist yet (not compiled)
    }
  }

  // Check additional TypeScript directories
  const currentAdditionalFiles: string[] = collectAdditionalTsFiles();
  for (const tsPath of currentAdditionalFiles) {
    if (!additionalTsFiles.includes(tsPath)) {
      // eslint-disable-next-line no-console
      console.log(`[TS] Detected new TypeScript file: ${path.relative(process.cwd(), tsPath)}`);
      additionalTsFiles.push(tsPath);
      hasChanges = true;
    }
  }

  for (const tsPath of additionalTsFiles.slice()) {
    try {
      const stats = fs.statSync(tsPath);
      const currentMtime: number = stats.mtimeMs;
      const lastMtime: number | undefined = additionalTsFileTimestamps.get(tsPath);

      if (lastMtime === undefined || currentMtime > lastMtime) {
        additionalTsFileTimestamps.set(tsPath, currentMtime);
        if (lastMtime !== undefined) {
          // eslint-disable-next-line no-console
          console.log(`[TS] Detected TypeScript change: ${path.relative(process.cwd(), tsPath)}`);
          hasChanges = true;
          shouldReload = true;
        }
      }
    } catch {
      const index = additionalTsFiles.indexOf(tsPath);
      if (index > -1) {
        additionalTsFiles.splice(index, 1);
        additionalTsFileTimestamps.delete(tsPath);
        // eslint-disable-next-line no-console
        console.log(`[TS] Detected deleted TypeScript file: ${path.relative(process.cwd(), tsPath)}`);
        hasChanges = true;
        shouldReload = true;
      }
    }
  }

  // Update timestamps if there were changes
  if (hasChanges) {
    updateTimestamps();
  }

  if (shouldReload) {
    // eslint-disable-next-line no-console
    console.log("[TS] Triggering BrowserSync reload...");
    triggerBrowserSyncReload();
  }
}, 500); // Poll every 500ms

// eslint-disable-next-line no-console
console.log(`[TS] Watching TypeScript files in ${path.relative(process.cwd(), tsSourceDir)}`);
// eslint-disable-next-line no-console
console.log(`[TS] Monitoring compiled output in ${path.relative(process.cwd(), jsOutputDir)}`);
// eslint-disable-next-line no-console
console.log(`[TS] Additional watch directories: ${additionalTsDirs.map((dir) => path.relative(process.cwd(), dir)).join(", ")}`);

// Keep process alive - prevent exit
process.on("unhandledRejection", (reason: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[TS] Unhandled rejection:", reason);
});

process.on("uncaughtException", (error: Error) => {
  // eslint-disable-next-line no-console
  console.error("[TS] Uncaught exception:", error.message);
  // Don't exit - keep watching
});

// Process stays alive via setInterval polling loop

function collectAdditionalTsFiles(): string[] {
  const files = new Set<string>();
  for (const dir of additionalTsDirs) {
    findTsFiles(dir).forEach((file) => files.add(file));
  }
  return Array.from(files);
}
