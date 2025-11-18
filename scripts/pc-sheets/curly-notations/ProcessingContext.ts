import type { PCSheetData } from "../types";

/**
 * Context object passed through the processing chain
 */
export interface ProcessingContext {
  // Main context data
  context: PCSheetData;  // The full sheet data

  // Current entity context (for 'this')
  thisEntity?: Record<string, unknown>;  // The entity being processed (merit, variation, etc.)

  // Instance variables (for 'vars')
  vars?: Record<string, unknown>;  // Instance-specific variables

  // Metadata
  filePath?: string;  // For error reporting
  lineNumber?: number;  // For error reporting
  strict?: boolean;  // Strictness toggle (default: true)
}
