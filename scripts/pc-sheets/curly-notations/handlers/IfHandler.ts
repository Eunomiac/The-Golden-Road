import type { NotationHandler } from "../NotationHandler";
import type { ProcessingContext } from "../ProcessingContext";
import type { CurlyNotationProcessor } from "../CurlyNotationProcessor";
import { NotationError } from "../NotationError";
import { extractFirstTopLevelArg } from "../utils/splitTopLevel";

type ConditionResult = string | number;

/**
 * Handles {{IFTRUE:<condition>,<content>}} notation
 * Returns the processed content when the condition is truthy; otherwise returns an empty string.
 */
export class IfTrueHandler implements NotationHandler {
  name = "IFTRUE";

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): ConditionResult {
    const {
      conditionExpression,
      branchContent
    } = parseConditionalArguments("IFTRUE", content, context);

    try {
      const passes = evaluateCondition("IFTRUE", conditionExpression, context, processor);
      if (!passes || branchContent.length === 0) {
        return "";
      }
      return processor.process(branchContent, context);
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
}

/**
 * Handles {{IFFALSE:<condition>,<content>}} notation
 * Returns the processed content when the condition is falsy; otherwise returns an empty string.
 */
export class IfFalseHandler implements NotationHandler {
  name = "IFFALSE";

  process(
    content: string,
    context: ProcessingContext,
    processor: CurlyNotationProcessor
  ): ConditionResult {
    const {
      conditionExpression,
      branchContent
    } = parseConditionalArguments("IFFALSE", content, context);

    try {
      const passes = evaluateCondition("IFFALSE", conditionExpression, context, processor);
      if (passes || branchContent.length === 0) {
        return "";
      }
      return processor.process(branchContent, context);
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
}

/**
 * Shared helper that parses the condition expression and branch text.
 */
function parseConditionalArguments(
  notationName: "IFTRUE" | "IFFALSE",
  content: string,
  context: ProcessingContext
): { conditionExpression: string; branchContent: string } {
  const { argument: conditionExpression, remainder } = extractFirstTopLevelArg(content);

  if (!conditionExpression) {
    throw new NotationError(
      `${notationName} requires a condition argument.`,
      `${notationName}:${content}`,
      context.filePath,
      context.lineNumber
    );
  }

  if (remainder === null) {
    throw new NotationError(
      `${notationName} requires content to render when the condition evaluates ${notationName === "IFTRUE" ? "true" : "false"}.`,
      `${notationName}:${content}`,
      context.filePath,
      context.lineNumber
    );
  }

  return {
    conditionExpression,
    branchContent: remainder
  };
}

/**
 * Evaluates a conditional expression within the current processing context.
 */
function evaluateCondition(
  notationName: "IFTRUE" | "IFFALSE",
  expression: string,
  context: ProcessingContext,
  processor: CurlyNotationProcessor
): boolean {
  const processedExpression = processor.process(expression, context);
  const expressionText = typeof processedExpression === "string"
    ? processedExpression
    : String(processedExpression);

  if (expressionText.trim().length === 0) {
    return false;
  }

  try {
    const varsContext = context.vars ?? {};
    const entityContext = context.thisEntity ?? {};

    // eslint-disable-next-line no-new-func
    const evaluator = new Function(
      "context",
      "vars",
      "entity",
      `"use strict"; return (function() { return (${expressionText}); }).call(entity);`
    );

    const evaluationResult = evaluator(context.context, varsContext, entityContext);
    return isTruthy(evaluationResult);
  } catch (error) {
    throw new NotationError(
      `Unable to evaluate ${notationName} condition '${expressionText}'.`,
      `${notationName}:${expression}`,
      context.filePath,
      context.lineNumber,
      error instanceof Error ? error.message : undefined
    );
  }
}

/**
 * Determines if a value is truthy
 */
function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value.length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  // Objects are truthy
  return true;
}
