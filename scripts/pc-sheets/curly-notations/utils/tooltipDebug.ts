import { appendFileSync, existsSync, mkdirSync } from "fs";
import { EOL } from "os";
import { join, resolve } from "path";
import type { HtmlValidationResult } from "./htmlValidation";
import { validateHtmlStructure } from "./htmlValidation";

/**
 * Shared helpers for opt-in TOOLTIP debugging across the curly-notation pipeline.
 */
export type TooltipLogPayload = Record<string, unknown>;

interface TooltipDebugMessage {
  stage: string;
  tooltipContent: string;
  containerContent: string;
  metadata?: TooltipLogPayload;
}

const LOG_DIRECTORY = resolve(process.cwd(), "logs");
const LOG_FILE_PATH = join(LOG_DIRECTORY, "tooltip-debug.log");
const TRACKED_SUBSTRING = "Slick Tilt";

const ensureLogDirectoryExists = (): void => {
  if (!existsSync(LOG_DIRECTORY)) {
    mkdirSync(LOG_DIRECTORY, { recursive: true });
  }
};

const shouldLogTooltip = (tooltipContent: string, containerContent: string): boolean => {
  return tooltipContent.includes(TRACKED_SUBSTRING) || containerContent.includes(TRACKED_SUBSTRING);
};

const formatValidationSummary = (label: string, result: HtmlValidationResult): string => {
  if (result.isValid) {
    return `${label} HTML valid: true`;
  }

  const snippet = result.contextSnippet
    ? ` | Context: ${result.contextSnippet}`
    : "";
  return `${label} HTML valid: false (${result.message ?? "Unbalanced tags detected."})${snippet}`;
};

const buildLogEntry = (message: TooltipDebugMessage): string => {
  const tooltipValidation = validateHtmlStructure(message.tooltipContent);
  const containerValidation = validateHtmlStructure(message.containerContent);

  const lines: string[] = [
    `Timestamp: ${new Date().toISOString()}`,
    `Stage: ${message.stage}`,
    formatValidationSummary("Tooltip", tooltipValidation),
    formatValidationSummary("Container", containerValidation),
    "Tooltip Content:",
    message.tooltipContent,
    "Container Content:",
    message.containerContent
  ];

  if (message.metadata && Object.keys(message.metadata).length > 0) {
    lines.push("Metadata:");
    lines.push(JSON.stringify(message.metadata, null, 2));
  }

  return lines.join(EOL);
};

/**
 * Emits a consistently formatted TOOLTIP debug message to a log file when enabled.
 */
export const logTooltipDebug = (message: TooltipDebugMessage): void => {
  if (!shouldLogTooltip(message.tooltipContent, message.containerContent)) {
    return;
  }

  ensureLogDirectoryExists();
  const entry = buildLogEntry(message);
  appendFileSync(LOG_FILE_PATH, `${entry}${EOL}${EOL}`, { encoding: "utf8" });
};