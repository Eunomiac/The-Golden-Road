"use strict";
/**
 * Ensures anchor-based tooltips remain within the viewport by flipping them underneath their
 * anchors when there is not enough space above the trigger element.
 */
/**
 * Observes tooltip anchor interactions and toggles a CSS class when the tooltip needs to render
 * beneath the anchor instead of above it.
 */
class TooltipFallbackController {
    constructor() {
        this.reevaluateActivePairs = () => {
            if (this.activePairs.size === 0) {
                return;
            }
            // Update placement for every tooltip that is currently visible or focused.
            this.activePairs.forEach((pair) => {
                this.updatePlacement(pair);
            });
        };
        this.pairs = this.discoverPairs();
        this.activePairs = new Set();
        this.boundaryElement = document.querySelector(".paper-stack");
        if (this.pairs.length === 0) {
            return;
        }
        // Attach interaction listeners so we know when to measure each tooltip.
        this.pairs.forEach((pair) => this.bindPair(pair));
        window.addEventListener("scroll", this.reevaluateActivePairs, { passive: true });
        window.addEventListener("resize", this.reevaluateActivePairs);
    }
    /**
     * Finds every tooltip/anchor pair rendered on the page.
     */
    discoverPairs() {
        const anchors = document.querySelectorAll(".has-tooltip");
        const discovered = [];
        anchors.forEach((anchor) => {
            const anchorId = anchor.style.getPropertyValue("anchor-name").trim();
            if (anchorId.length === 0) {
                console.warn("Tooltip fallback: anchor is missing an anchor-name style.", anchor);
                return;
            }
            const tooltip = this.findTooltipSibling(anchor) ?? this.findTooltipByAnchorId(anchorId);
            if (tooltip === null) {
                console.warn(`Tooltip fallback: unable to locate tooltip for anchor ${anchorId}.`, anchor);
                return;
            }
            discovered.push({ anchor, tooltip, anchorId });
        });
        return discovered;
    }
    /**
     * Attempts to locate the tooltip element via DOM siblings (primary path).
     */
    findTooltipSibling(anchor) {
        let sibling = anchor.nextElementSibling;
        while (sibling !== null) {
            if (sibling instanceof HTMLElement && sibling.classList.contains("tooltip")) {
                return sibling;
            }
            sibling = sibling.nextElementSibling;
        }
        return null;
    }
    /**
     * Fallback lookup that matches tooltip elements by their `position-anchor` value.
     */
    findTooltipByAnchorId(anchorId) {
        if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
            return null;
        }
        const selector = `.tooltip[style*="${CSS.escape(anchorId)}"]`;
        return document.querySelector(selector);
    }
    /**
     * Binds pointer/focus listeners so we can track when a tooltip becomes interactive.
     */
    bindPair(pair) {
        const activate = () => {
            this.activePairs.add(pair);
            this.updatePlacement(pair);
        };
        const deactivate = () => {
            window.setTimeout(() => {
                if (!this.isPairInteractive(pair)) {
                    this.activePairs.delete(pair);
                }
            }, TooltipFallbackController.DEACTIVATE_DELAY_MS);
        };
        pair.anchor.addEventListener("pointerenter", activate);
        pair.anchor.addEventListener("pointerdown", activate);
        pair.anchor.addEventListener("focus", activate);
        pair.anchor.addEventListener("pointerleave", deactivate);
        pair.anchor.addEventListener("blur", deactivate);
        pair.tooltip.addEventListener("pointerenter", activate);
        pair.tooltip.addEventListener("pointerleave", deactivate);
        pair.tooltip.addEventListener("focusin", activate);
        pair.tooltip.addEventListener("focusout", deactivate);
    }
    /**
     * Checks whether the anchor or tooltip is hovered/focused, which keeps the pair "active".
     */
    isPairInteractive(pair) {
        const activeElement = document.activeElement;
        const anchorHovered = pair.anchor.matches(":hover");
        const tooltipHovered = pair.tooltip.matches(":hover");
        const anchorFocused = activeElement instanceof HTMLElement &&
            (pair.anchor === activeElement || pair.anchor.contains(activeElement));
        const tooltipFocused = activeElement instanceof HTMLElement && pair.tooltip.contains(activeElement);
        return anchorHovered || tooltipHovered || anchorFocused || tooltipFocused;
    }
    /**
     * Measures the available space above and below the anchor and toggles the CSS "below" class.
     */
    updatePlacement(pair) {
        const { tooltip } = pair;
        const size = this.measureTooltipSize(tooltip);
        if (!Number.isFinite(size.height) || size.height <= 0) {
            console.warn(`Tooltip fallback: could not measure tooltip height for ${pair.anchorId}.`);
            this.activePairs.delete(pair);
            this.resetShiftProperties(tooltip);
            return;
        }
        this.applyVerticalFallback(pair, size.height);
        this.updateBoundaryOffsets(pair, size);
    }
    applyVerticalFallback(pair, tooltipHeight) {
        const { anchor, tooltip } = pair;
        const anchorRect = anchor.getBoundingClientRect();
        const clearance = TooltipFallbackController.ANCHOR_GAP_PX;
        const padding = TooltipFallbackController.VIEWPORT_PADDING_PX;
        // Space that keeps the tooltip from touching the viewport edges.
        const availableAbove = Math.max(anchorRect.top - clearance - padding, 0);
        const availableBelow = Math.max(window.innerHeight - anchorRect.bottom - clearance - padding, 0);
        const lacksRoomAbove = tooltipHeight > availableAbove;
        const hasUsableSpaceBelow = availableBelow > 0;
        const hasMoreRoomBelow = availableBelow >= availableAbove;
        const shouldPreferBelow = lacksRoomAbove && hasUsableSpaceBelow && hasMoreRoomBelow;
        tooltip.classList.toggle(TooltipFallbackController.BELOW_CLASS, shouldPreferBelow);
    }
    /**
     * Applies horizontal and vertical offset variables so the tooltip stays within the paper stack.
     */
    updateBoundaryOffsets(pair, size) {
        const boundary = this.boundaryElement;
        if (boundary === null) {
            this.resetShiftProperties(pair.tooltip);
            return;
        }
        const bounds = boundary.getBoundingClientRect();
        const padding = TooltipFallbackController.BOUNDARY_PADDING_PX;
        const safeLeft = bounds.left + padding;
        const safeRight = bounds.right - padding;
        const safeTop = bounds.top + padding;
        const safeBottom = bounds.bottom - padding;
        const usableWidth = safeRight - safeLeft;
        const usableHeight = safeBottom - safeTop;
        if (usableWidth <= 0 || usableHeight <= 0) {
            this.resetShiftProperties(pair.tooltip);
            return;
        }
        const anchorRect = pair.anchor.getBoundingClientRect();
        const anchorCenterX = anchorRect.left + anchorRect.width / 2;
        const defaultLeft = anchorCenterX - size.width / 2;
        let horizontalShift = 0;
        if (size.width > usableWidth) {
            horizontalShift = safeLeft - defaultLeft;
        }
        else if (defaultLeft < safeLeft) {
            horizontalShift = safeLeft - defaultLeft;
        }
        else {
            const overflowRight = defaultLeft + size.width - safeRight;
            if (overflowRight > 0) {
                horizontalShift = -overflowRight;
            }
        }
        const clearance = TooltipFallbackController.ANCHOR_GAP_PX;
        const prefersBelow = pair.tooltip.classList.contains(TooltipFallbackController.BELOW_CLASS);
        const defaultTop = prefersBelow
            ? anchorRect.bottom + clearance
            : anchorRect.top - clearance - size.height;
        const defaultBottom = defaultTop + size.height;
        let verticalShift = 0;
        if (size.height > usableHeight) {
            verticalShift = safeTop - defaultTop;
        }
        else if (defaultTop < safeTop) {
            verticalShift = safeTop - defaultTop;
        }
        else {
            const overflowBottom = defaultBottom - safeBottom;
            if (overflowBottom > 0) {
                verticalShift = -overflowBottom;
            }
        }
        this.applyShiftProperties(pair.tooltip, horizontalShift, verticalShift);
    }
    applyShiftProperties(tooltip, x, y) {
        const normalizedX = Math.abs(x) < 0.5 ? 0 : x;
        const normalizedY = Math.abs(y) < 0.5 ? 0 : y;
        if (normalizedX === 0) {
            tooltip.style.removeProperty("--tooltip-shift-x");
        }
        else {
            tooltip.style.setProperty("--tooltip-shift-x", `${normalizedX}px`);
        }
        if (normalizedY === 0) {
            tooltip.style.removeProperty("--tooltip-shift-y");
        }
        else {
            tooltip.style.setProperty("--tooltip-shift-y", `${normalizedY}px`);
        }
    }
    resetShiftProperties(tooltip) {
        tooltip.style.removeProperty("--tooltip-shift-x");
        tooltip.style.removeProperty("--tooltip-shift-y");
    }
    /**
     * Retrieves the tooltip's visual size even while it is hidden.
     */
    measureTooltipSize(tooltip) {
        const rect = tooltip.getBoundingClientRect();
        const width = rect.width > 0 ? rect.width : tooltip.scrollWidth;
        const height = rect.height > 0 ? rect.height : tooltip.scrollHeight;
        return { width, height };
    }
}
TooltipFallbackController.BELOW_CLASS = "tooltip--below";
TooltipFallbackController.ANCHOR_GAP_PX = 16;
TooltipFallbackController.VIEWPORT_PADDING_PX = 8;
TooltipFallbackController.BOUNDARY_PADDING_PX = 48;
TooltipFallbackController.DEACTIVATE_DELAY_MS = 80;
/**
 * Bootstraps the tooltip fallback logic once the DOM is ready.
 */
function initTooltipFallbacks() {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initTooltipFallbacks, { once: true });
        return;
    }
    new TooltipFallbackController();
}
initTooltipFallbacks();
//# sourceMappingURL=tooltip-positioning.js.map