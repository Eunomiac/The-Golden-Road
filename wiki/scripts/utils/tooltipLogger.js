/**
 * Logging utility for tooltip positioning debugging.
 * Accumulates logs and provides download functionality.
 */
class TooltipLogger {
    /**
     * Logs tooltip debugging information.
     */
    static log(anchorId, stage, data) {
        const entry = {
            timestamp: Date.now(),
            anchorId,
            stage,
            data: this.serializeData(data)
        };
        this.logs.push(entry);
        // Keep only the most recent logs
        if (this.logs.length > TooltipLogger.MAX_LOGS) {
            this.logs.shift();
        }
        // Also log to console for immediate feedback
        console.log(`[Tooltip Debug] ${stage} (${anchorId}):`, data);
    }
    /**
     * Serializes data for logging, handling circular references and complex objects.
     */
    static serializeData(data) {
        const serialized = {};
        for (const [key, value] of Object.entries(data)) {
            try {
                if (value === null || value === undefined) {
                    serialized[key] = value;
                }
                else if (typeof value === "object") {
                    if (value instanceof DOMRect) {
                        serialized[key] = {
                            top: value.top,
                            left: value.left,
                            bottom: value.bottom,
                            right: value.right,
                            width: value.width,
                            height: value.height
                        };
                    }
                    else if (Array.isArray(value)) {
                        serialized[key] = value.map(item => this.serializeValue(item));
                    }
                    else {
                        serialized[key] = this.serializeValue(value);
                    }
                }
                else {
                    serialized[key] = value;
                }
            }
            catch (error) {
                serialized[key] = `[Error serializing: ${String(error)}]`;
            }
        }
        return serialized;
    }
    /**
     * Serializes a single value.
     */
    static serializeValue(value) {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value === "object") {
            if (value instanceof DOMRect) {
                return {
                    top: value.top,
                    left: value.left,
                    bottom: value.bottom,
                    right: value.right,
                    width: value.width,
                    height: value.height
                };
            }
            try {
                return JSON.parse(JSON.stringify(value));
            }
            catch {
                return String(value);
            }
        }
        return value;
    }
    /**
     * Downloads logs as a JSON file.
     */
    static downloadLogs() {
        const logData = {
            timestamp: new Date().toISOString(),
            totalLogs: this.logs.length,
            logs: this.logs
        };
        const jsonString = JSON.stringify(logData, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `tooltip-debug-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    /**
     * Clears all logs.
     */
    static clearLogs() {
        this.logs = [];
    }
    /**
     * Gets the current log count.
     */
    static getLogCount() {
        return this.logs.length;
    }
}
TooltipLogger.logs = [];
TooltipLogger.MAX_LOGS = 1000;
// Expose download function globally for easy access
if (typeof window !== "undefined") {
    window.downloadTooltipLogs = () => {
        TooltipLogger.downloadLogs();
    };
}
export { TooltipLogger };
//# sourceMappingURL=tooltipLogger.js.map