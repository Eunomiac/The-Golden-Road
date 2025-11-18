/**
 * Custom error class for notation processing errors
 */
export class NotationError extends Error {
  public readonly notation: string;
  public readonly filePath?: string;
  public readonly lineNumber?: number;
  public readonly context?: string;

  constructor(
    message: string,
    notation: string,
    filePath?: string,
    lineNumber?: number,
    context?: string
  ) {
    super(message);
    this.name = "NotationError";
    this.notation = notation;
    this.filePath = filePath;
    this.lineNumber = lineNumber;
    this.context = context;
  }

  /**
   * Converts error to inline HTML error message
   */
  toInlineError(): string {
    const details: string[] = [this.message];

    if (this.notation) {
      details.push(`Notation: ${this.notation}`);
    }

    if (this.context) {
      details.push(`Context: ${this.context}`);
    }

    if (this.filePath) {
      const location = this.lineNumber
        ? `${this.filePath}:${this.lineNumber}`
        : this.filePath;
      details.push(`Location: ${location}`);
    }

    return `<span class='inline-error'>${details.join(" | ")}</span>`;
  }
}
