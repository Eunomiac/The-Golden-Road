/**
 * Ensures anchor-based tooltips remain within the viewport by flipping them underneath their
 * anchors when there is not enough space above the trigger element.
 */

import { gsap } from "gsap";

/**
 * Logging utility for tooltip positioning debugging.
 * Accumulates logs and provides download functionality.
 */
interface TooltipLogEntry {
  timestamp: number;
  anchorId: string;
  stage: string;
  data: Record<string, unknown>;
}

class TooltipLogger {
  private static logs: TooltipLogEntry[] = [];
  private static readonly MAX_LOGS = 1000;

  /**
   * Logs tooltip debugging information.
   */
  static log(anchorId: string, stage: string, data: Record<string, unknown>): void {
    const entry: TooltipLogEntry = {
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
  private static serializeData(data: Record<string, unknown>): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      try {
        if (value === null || value === undefined) {
          serialized[key] = value;
        } else if (typeof value === "object") {
          if (value instanceof DOMRect) {
            serialized[key] = {
              top: value.top,
              left: value.left,
              bottom: value.bottom,
              right: value.right,
              width: value.width,
              height: value.height
            };
          } else if (Array.isArray(value)) {
            serialized[key] = value.map(item => this.serializeValue(item));
          } else {
            serialized[key] = this.serializeValue(value);
          }
        } else {
          serialized[key] = value;
        }
      } catch (error) {
        serialized[key] = `[Error serializing: ${String(error)}]`;
      }
    }

    return serialized;
  }

  /**
   * Serializes a single value.
   */
  private static serializeValue(value: unknown): unknown {
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
      } catch {
        return String(value);
      }
    }
    return value;
  }

  /**
   * Downloads logs as a JSON file.
   */
  static downloadLogs(): void {
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
  static clearLogs(): void {
    this.logs = [];
  }

  /**
   * Gets the current log count.
   */
  static getLogCount(): number {
    return this.logs.length;
  }
}

// Expose download function globally for easy access
if (typeof window !== "undefined") {
  (window as unknown as { downloadTooltipLogs: () => void }).downloadTooltipLogs = () => {
    TooltipLogger.downloadLogs();
  };
}

interface TooltipPair {
  anchor: HTMLElement;
  tooltip: HTMLElement;
  anchorId: string;
}

interface TooltipSize {
  width: number;
  height: number;
}

/**
 * Observes tooltip anchor interactions and toggles CSS classes to position tooltips
 * relative to their anchors using CSS anchor positioning.
 */
type TooltipPosition = "top" | "top-right" | "right" | "bottom-right" | "bottom" | "bottom-left" | "left" | "top-left";

class TooltipFallbackController {
  private static readonly ANCHOR_GAP_PX = 16;
  private static readonly BOUNDARY_PADDING_PX = 48;
  private static readonly RIGHT_EDGE_OFFSET_PX = 20;
  private static readonly HOVER_DELAY_MS = 500;

  private readonly pairs: TooltipPair[];
  private readonly activePairs: Set<TooltipPair>;
  private readonly boundaryElement: HTMLElement | null;
  private readonly hoverDelayTimeouts: Map<TooltipPair, number>;
  private readonly tooltipContainer: HTMLElement;
  private readonly tooltipOriginalParents: Map<HTMLElement, { parent: Node; nextSibling: Node | null }>;
  private readonly queueAnimateOut: Map<TooltipPair, boolean>;

  constructor() {
    this.pairs = [];
    this.activePairs = new Set<TooltipPair>();
    // Use the scrollable container as boundary, not the outer paper-stack
    // This ensures boundaries account for scrolling correctly
    this.boundaryElement = document.querySelector<HTMLElement>(".paper-stack-scroll") ??
                          document.querySelector<HTMLElement>(".paper-stack");
    this.hoverDelayTimeouts = new Map<TooltipPair, number>();
    this.tooltipOriginalParents = new Map<HTMLElement, { parent: Node; nextSibling: Node | null }>();
    this.queueAnimateOut = new Map<TooltipPair, boolean>();

    // Create a dedicated container for tooltips at body level to escape stacking contexts
    this.tooltipContainer = document.createElement("div");
    this.tooltipContainer.id = "tooltip-container";
    this.tooltipContainer.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 99999;";
    document.body.appendChild(this.tooltipContainer);

    // Initial discovery
    this.refreshPairs();

    // Watch for dynamically added tooltips
    const observer = new MutationObserver(() => {
      this.refreshPairs();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"]
    });
  }

  /**
   * Refreshes the tooltip pairs list and rebinds listeners for newly discovered tooltips.
   */
  private refreshPairs(): void {
    const newPairs = this.discoverPairs();

    // Find pairs that are new (not already in this.pairs)
    const existingAnchorIds = new Set(this.pairs.map(p => p.anchorId));
    const pairsToAdd = newPairs.filter(p => !existingAnchorIds.has(p.anchorId));

    // Add new pairs and bind them
    pairsToAdd.forEach((pair: TooltipPair): void => {
      this.pairs.push(pair);
      this.bindPair(pair);
    });
  }

  /**
   * Finds every tooltip/anchor pair rendered on the page.
   * Discovers tooltips by:
   * 1. Finding all elements with .has-tooltip class (anchors)
   * 2. Finding all elements with .tooltip class that use position-anchor
   */
  private discoverPairs(): TooltipPair[] {
    const discovered: TooltipPair[] = [];

    // Method 1: Find anchors with .has-tooltip class
    const anchors = document.querySelectorAll<HTMLElement>(".has-tooltip");
    anchors.forEach((anchor: HTMLElement): void => {
      const anchorId = anchor.style.getPropertyValue("anchor-name").trim();

      if (anchorId.length === 0) {
        return; // Skip anchors without anchor-name
      }

      const tooltip = this.findTooltipSibling(anchor) ?? this.findTooltipByAnchorId(anchorId);

      if (tooltip !== null) {
        discovered.push({ anchor, tooltip, anchorId });
      }
    });

    // Method 2: Find all tooltips that use position-anchor and match them to anchors
    // This catches tooltips that might not have a .has-tooltip sibling
    // Look for elements with .tooltip class OR elements with position-anchor that contain tooltip content
    const allTooltips = document.querySelectorAll<HTMLElement>(".tooltip, [class*='tooltip']");
    allTooltips.forEach((tooltip: HTMLElement): void => {
      const positionAnchor = tooltip.style.getPropertyValue("position-anchor").trim();

      if (positionAnchor.length === 0) {
        return; // Skip tooltips without position-anchor
      }

      // Extract anchor ID from position-anchor (format: --anchorId)
      const anchorId = positionAnchor.replace(/^--/, "").trim();

      if (anchorId.length === 0) {
        return;
      }

      // Check if we already have this pair
      const alreadyDiscovered = discovered.some(pair => pair.anchorId === anchorId);
      if (alreadyDiscovered) {
        return;
      }

      // Find the anchor element by anchor-name
      const anchor = this.findAnchorById(anchorId);
      if (anchor !== null) {
        discovered.push({ anchor, tooltip, anchorId });
      }
    });

    return discovered;
  }

  /**
   * Finds an anchor element by its anchor ID.
   */
  private findAnchorById(anchorId: string): HTMLElement | null {
    // Try to find by anchor-name style property
    const allElements = document.querySelectorAll<HTMLElement>("*");
    for (const element of Array.from(allElements)) {
      const elementAnchorId = element.style.getPropertyValue("anchor-name").trim();
      if (elementAnchorId === `--${anchorId}` || elementAnchorId === anchorId) {
        return element;
      }
    }
    return null;
  }

  /**
   * Attempts to locate the tooltip element via DOM siblings (primary path).
   */
  private findTooltipSibling(anchor: HTMLElement): HTMLElement | null {
    let sibling: Element | null = anchor.nextElementSibling;

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
   * Also checks for tooltips with classes that contain "tooltip".
   */
  private findTooltipByAnchorId(anchorId: string): HTMLElement | null {
    if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
      return null;
    }

    // Try exact match first
    const escapedId = CSS.escape(anchorId);
    let selector = `.tooltip[style*="${escapedId}"]`;
    let tooltip = document.querySelector<HTMLElement>(selector);

    if (tooltip) {
      return tooltip;
    }

    // Try finding any element with position-anchor matching this anchor ID
    const allElements = document.querySelectorAll<HTMLElement>("*");
    for (const element of Array.from(allElements)) {
      const positionAnchor = element.style.getPropertyValue("position-anchor").trim();
      if (positionAnchor === `--${anchorId}` || positionAnchor === anchorId) {
        // Check if it looks like a tooltip (has tooltip class or contains tooltip content)
        if (element.classList.contains("tooltip") ||
            Array.from(element.classList).some((cls: string) => cls.includes("tooltip"))) {
          return element;
        }
      }
    }

    return null;
  }

  /**
   * Binds pointer/focus listeners so we can track when a tooltip becomes interactive.
   */
  private bindPair(pair: TooltipPair): void {
    const activate = (): void => {
      // If tooltip is already active/visible, don't reposition
      if (this.activePairs.has(pair) || pair.tooltip.classList.contains("tooltip--active")) {
        return;
      }

      // Clear any existing timeout
      this.clearHoverDelay(pair);

      // Set a delay before showing the tooltip
      const timeoutId = window.setTimeout((): void => {
        // Double-check tooltip isn't already active (might have been activated by another event)
        if (this.activePairs.has(pair) || pair.tooltip.classList.contains("tooltip--active")) {
          return;
        }
        this.activePairs.add(pair);
        // Position tooltip first (while hidden), then show it
        this.positionAndShowTooltip(pair);
        this.hoverDelayTimeouts.delete(pair);
      }, TooltipFallbackController.HOVER_DELAY_MS);

      this.hoverDelayTimeouts.set(pair, timeoutId);
    };

    const deactivate = (): void => {
      // Clear any pending hover delay
      this.clearHoverDelay(pair);

      // Remove from active pairs immediately
      this.activePairs.delete(pair);

      // Check if tooltip is currently animating in (has active class but might still be animating)
      const isAnimatingIn = pair.tooltip.classList.contains("tooltip--active") &&
                           parseFloat(window.getComputedStyle(pair.tooltip).opacity) < 1;

      if (isAnimatingIn) {
        // Tooltip is still animating in, queue the hide animation for when it completes
        this.queueAnimateOut.set(pair, true);
        return;
      }

      // Tooltip is fully visible or not active, hide it immediately
      this.animateOutTooltip(pair);
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
   * Clears the hover delay timeout for a tooltip pair.
   */
  private clearHoverDelay(pair: TooltipPair): void {
    const timeoutId = this.hoverDelayTimeouts.get(pair);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      this.hoverDelayTimeouts.delete(pair);
    }
  }

  /**
   * Animates the tooltip out (hides it).
   * This is a separate method so it can be called from animation callbacks.
   */
  private animateOutTooltip(pair: TooltipPair): void {
    // Clear the queue flag if it was set
    this.queueAnimateOut.delete(pair);

    // If tooltip is in the container, ensure it stays there during hide animation
    const isInContainer = pair.tooltip.parentElement === this.tooltipContainer;

    // Hide tooltip with GSAP animation (opacity and scale only, no position transforms)
    gsap.to(pair.tooltip, {
      opacity: 0,
      scale: 0.98,
      duration: 0.15,
      ease: "power2.in",
      onComplete: () => {
        gsap.set(pair.tooltip, { visibility: "hidden" });
        pair.tooltip.classList.remove("tooltip--active");
        // Only restore tooltip to original position if it's not in the container
        // If it's in the container, it should stay there until next activation
        if (!isInContainer) {
          this.restoreTooltipPosition(pair.tooltip);
        }
      }
    });
  }

  /**
   * Moves a tooltip to the dedicated container to escape parent stacking contexts.
   */
  private moveTooltipToContainer(tooltip: HTMLElement): void {
    // Only move if not already in the container
    if (tooltip.parentElement === this.tooltipContainer) {
      return;
    }

    // Store original parent and next sibling for restoration
    if (!this.tooltipOriginalParents.has(tooltip)) {
      this.tooltipOriginalParents.set(tooltip, {
        parent: tooltip.parentNode as Node,
        nextSibling: tooltip.nextSibling
      });
    }

    // Move to container
    this.tooltipContainer.appendChild(tooltip);
  }

  /**
   * Restores a tooltip to its original position in the DOM.
   */
  private restoreTooltipPosition(tooltip: HTMLElement): void {
    const original = this.tooltipOriginalParents.get(tooltip);
    if (original && original.parent) {
      if (original.nextSibling) {
        original.parent.insertBefore(tooltip, original.nextSibling);
      } else {
        original.parent.appendChild(tooltip);
      }
      // Restore transform for anchor positioning (removed when using fixed positioning)
      tooltip.style.removeProperty("position");
      tooltip.style.removeProperty("transform");
      this.tooltipOriginalParents.delete(tooltip);
    }
  }

  /**
   * Positions the tooltip while hidden, then shows it with GSAP animation.
   * Positioning is calculated once before showing - no repositioning while visible.
   */
  private positionAndShowTooltip(pair: TooltipPair): void {
    // If tooltip is already active, don't reposition (prevents repositioning during animation)
    if (pair.tooltip.classList.contains("tooltip--active")) {
      return;
    }

    // Ensure tooltip is hidden initially
    pair.tooltip.classList.remove("tooltip--active");

    // Move tooltip to dedicated container IMMEDIATELY to escape parent stacking contexts
    // This must happen before any async operations to prevent restoration during animation
    this.moveTooltipToContainer(pair.tooltip);

    // Verify tooltip is actually in the container - if not, something went wrong
    if (pair.tooltip.parentElement !== this.tooltipContainer) {
      console.warn("Tooltip was not moved to container properly, retrying...");
      // Force move again
      this.moveTooltipToContainer(pair.tooltip);
      if (pair.tooltip.parentElement !== this.tooltipContainer) {
        console.error("Failed to move tooltip to container");
        return;
      }
    }

    // Mark as active IMMEDIATELY after moving to container to prevent deactivate from restoring position
    // This must happen before any async operations (requestAnimationFrame) to prevent race conditions
    pair.tooltip.classList.add("tooltip--active");

    // Force a reflow to ensure tooltip is in the container before positioning
    void pair.tooltip.offsetHeight;
    void pair.anchor.offsetHeight;

    // Position the tooltip while it's hidden (sets position classes and boundary offsets)
    // This returns the selected position and size for later use
    const placementResult = this.updatePlacement(pair);

    // Set initial hidden state for GSAP animation (opacity and scale only, no position)
    // We've already set top/left for fixed positioning, so GSAP should only animate scale
    gsap.set(pair.tooltip, {
      visibility: "hidden",
      opacity: 0,
      scale: 0.98,
      // Set x/y to 0 so GSAP doesn't interfere with our top/left positioning
      x: 0,
      y: 0,
      immediateRender: true
    });

    // Use double requestAnimationFrame to ensure layout is complete before positioning
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Recalculate position right before showing
        // This ensures we have the most current anchor position (accounts for any scrolling)
        if (placementResult) {
          // DEBUG: Log before recalculation
          TooltipLogger.log(pair.anchorId, "beforeRecalculation", {
            anchorCurrentRect: pair.anchor.getBoundingClientRect(),
            tooltipCurrentStyle: {
              top: pair.tooltip.style.top,
              left: pair.tooltip.style.left,
              position: pair.tooltip.style.position
            }
          });

          // Make tooltip temporarily visible to get accurate measurements
          const originalVisibility = pair.tooltip.style.visibility;
          const originalOpacity = pair.tooltip.style.opacity;
          pair.tooltip.style.visibility = "visible";
          pair.tooltip.style.opacity = "1";

          // Force a reflow to ensure tooltip is measured and anchor position is current
          void pair.tooltip.offsetHeight;
          void pair.anchor.offsetHeight;

          // Get fresh measurements with current layout
          const tooltipRect = pair.tooltip.getBoundingClientRect();
          const freshSize: TooltipSize = {
            width: tooltipRect.width > 0 ? tooltipRect.width : pair.tooltip.scrollWidth,
            height: tooltipRect.height > 0 ? tooltipRect.height : pair.tooltip.scrollHeight
          };

          // DEBUG: Log fresh measurements
          TooltipLogger.log(pair.anchorId, "freshMeasurements", {
            freshSize,
            tooltipRect,
            anchorRect: pair.anchor.getBoundingClientRect()
          });

          // Recalculate position with current anchor position (getBoundingClientRect is viewport-relative)
          // This ensures we account for any scrolling that happened
          this.calculateFixedPosition(pair, placementResult.position, freshSize);

          // Recalculate boundary offsets with updated position
          this.updateBoundaryOffsets(pair, freshSize, placementResult.position);

          // Get final tooltip position after all calculations
          const finalTooltipRect = pair.tooltip.getBoundingClientRect();
          const anchorRect = pair.anchor.getBoundingClientRect();

          // Calculate the offset from anchor center to tooltip center for slide animation
          const anchorCenterX = anchorRect.left + (anchorRect.width / 2);
          const anchorCenterY = anchorRect.top + (anchorRect.height / 2);
          const tooltipCenterX = finalTooltipRect.left + (finalTooltipRect.width / 2);
          const tooltipCenterY = finalTooltipRect.top + (finalTooltipRect.height / 2);

          const slideOffsetX = anchorCenterX - tooltipCenterX;
          const slideOffsetY = anchorCenterY - tooltipCenterY;

          // DEBUG: Log final position
          TooltipLogger.log(pair.anchorId, "finalPosition", {
            finalTop: pair.tooltip.style.top,
            finalLeft: pair.tooltip.style.left,
            tooltipRect: finalTooltipRect,
            anchorRect: anchorRect,
            slideOffset: { x: slideOffsetX, y: slideOffsetY }
          });

          // Restore hidden state before animation
          pair.tooltip.style.visibility = originalVisibility;
          pair.tooltip.style.opacity = originalOpacity;

          // Mark tooltip as active before animation starts to prevent repositioning
          pair.tooltip.classList.add("tooltip--active");

          // Animate the tooltip sliding and expanding from anchor to final position
          // Start from anchor position (using transform offset) and animate to final position
          gsap.fromTo(pair.tooltip, {
            visibility: "visible",
            opacity: 0,
            scale: 0.3,
            x: slideOffsetX,
            y: slideOffsetY
          }, {
            visibility: "visible",
            opacity: 1,
            scale: 1,
            x: 0,
            y: 0,
            duration: 0.3,
            ease: "back.out(1.2)", // Slight bounce for a more dynamic feel
            onStart: () => {
              // Ensure tooltip is in container when animation starts
              if (pair.tooltip.parentElement !== this.tooltipContainer) {
                this.moveTooltipToContainer(pair.tooltip);
              }
            },
            onComplete: () => {
              // Check if we need to animate out (mouse moved off during animation)
              if (this.queueAnimateOut.get(pair)) {
                this.animateOutTooltip(pair);
              }
            }
          });
        } else {
          // Ensure tooltip is still in container before starting animation
          if (pair.tooltip.parentElement !== this.tooltipContainer) {
            this.moveTooltipToContainer(pair.tooltip);
          }

          // Fallback if no placement result - simple fade in
          gsap.to(pair.tooltip, {
            visibility: "visible",
            opacity: 1,
            scale: 1,
            x: 0,
            y: 0,
            duration: 0.2,
            ease: "power2.out",
            onComplete: () => {
              // Check if we need to animate out (mouse moved off during animation)
              if (this.queueAnimateOut.get(pair)) {
                this.animateOutTooltip(pair);
              }
            }
          });
        }
      });
    });
  }

  /**
   * Checks if a tooltip is actually visible (not just in the DOM).
   */
  private isTooltipVisible(tooltip: HTMLElement): boolean {
    const style = window.getComputedStyle(tooltip);
    const rect = tooltip.getBoundingClientRect();

    // Check if tooltip has visibility and opacity indicating it's shown
    const isVisible = style.visibility === "visible" &&
                      parseFloat(style.opacity) > 0.5 &&
                      rect.width > 0 &&
                      rect.height > 0;

    return isVisible;
  }

  /**
   * Measures available space around the anchor and selects the best position for the tooltip.
   * This works even when the tooltip is hidden by temporarily making it visible for measurement.
   * Returns the selected position and size for later use.
   */
  private updatePlacement(pair: TooltipPair): { position: TooltipPosition; size: TooltipSize } | null {
    const { tooltip } = pair;

    // Check if tooltip is already visible - if so, we can measure directly
    const isAlreadyVisible = this.isTooltipVisible(tooltip);

    // Temporarily force tooltip to be measurable even if hidden
    // Store original values
    const originalVisibility = tooltip.style.visibility;
    const originalOpacity = tooltip.style.opacity;
    const originalDisplay = tooltip.style.display;
    const originalTransition = tooltip.style.transition;

    if (!isAlreadyVisible) {
      // Make tooltip temporarily visible for measurement
      // This allows us to measure and position it before showing
      tooltip.style.visibility = "visible";
      tooltip.style.opacity = "1";
      tooltip.style.display = "";
      tooltip.style.transition = "none"; // Disable transitions during measurement

      // Force a reflow to ensure the browser applies the styles
      void tooltip.offsetHeight;
    }

    const size = this.measureTooltipSize(tooltip);

    if (!Number.isFinite(size.height) || size.height <= 0 || !Number.isFinite(size.width) || size.width <= 0) {
      // Restore original styles before returning
      if (!isAlreadyVisible) {
        tooltip.style.visibility = originalVisibility;
        tooltip.style.opacity = originalOpacity;
        tooltip.style.display = originalDisplay;
        tooltip.style.transition = originalTransition;
      }
      return null;
    }

    const bestPosition = this.selectBestPosition(pair, size);

    this.applyPosition(pair, bestPosition);

    // Force a reflow to ensure position is set
    void tooltip.offsetHeight;

    // Boundary offsets will be calculated in requestAnimationFrame with fresh anchor position

    if (!isAlreadyVisible) {
      // Restore original styles (positioning classes and offsets are already applied)
      tooltip.style.visibility = originalVisibility;
      tooltip.style.opacity = originalOpacity;
      tooltip.style.display = originalDisplay;
      tooltip.style.transition = originalTransition;
    }

    return { position: bestPosition, size };
  }

  /**
   * Selects the best position for the tooltip by checking all 8 positions (4 cardinal + 4 diagonal).
   * Returns the first position that fits perfectly, or the position with the most available space if none fit.
   */
  private selectBestPosition(pair: TooltipPair, size: TooltipSize): TooltipPosition {
    const { anchor } = pair;
    const anchorRect = anchor.getBoundingClientRect();
    const clearance = TooltipFallbackController.ANCHOR_GAP_PX;
    const boundary = this.boundaryElement;

    // Calculate available space for each position relative to the boundary
    const calculateSpace = (direction: "top" | "bottom" | "left" | "right"): number => {
      if (boundary === null) {
        // No boundary, use viewport
        switch (direction) {
          case "top":
            return Math.max(anchorRect.top - clearance, 0);
          case "bottom":
            return Math.max(window.innerHeight - anchorRect.bottom - clearance, 0);
          case "right":
            return Math.max(window.innerWidth - anchorRect.right - clearance, 0);
          case "left":
            return Math.max(anchorRect.left - clearance, 0);
        }
      } else {
        // Check against boundary
        const bounds = boundary.getBoundingClientRect();
        const boundaryPadding = TooltipFallbackController.BOUNDARY_PADDING_PX;
        switch (direction) {
          case "top":
            return Math.max(anchorRect.top - bounds.top - clearance - boundaryPadding, 0);
          case "bottom":
            return Math.max(bounds.bottom - anchorRect.bottom - clearance - boundaryPadding, 0);
          case "right":
            return Math.max(bounds.right - anchorRect.right - clearance - boundaryPadding, 0);
          case "left":
            return Math.max(anchorRect.left - bounds.left - clearance - boundaryPadding, 0);
        }
      }
    };

    // Calculate space for each cardinal direction
    const topSpace = calculateSpace("top");
    const bottomSpace = calculateSpace("bottom");
    const rightSpace = calculateSpace("right");
    const leftSpace = calculateSpace("left");

    // For diagonal positions, use the minimum of the two cardinal directions
    const topRightSpace = Math.min(topSpace, rightSpace);
    const bottomRightSpace = Math.min(bottomSpace, rightSpace);
    const bottomLeftSpace = Math.min(bottomSpace, leftSpace);
    const topLeftSpace = Math.min(topSpace, leftSpace);

    // Check which positions can fit the tooltip
    // For vertical positions (top/bottom), check height; for horizontal (left/right), check width
    // For diagonals, need to check both dimensions fit
    const canFitTop = size.height <= topSpace;
    const canFitTopRight = size.height <= topSpace && size.width <= rightSpace;
    const canFitRight = size.width <= rightSpace;
    const canFitBottomRight = size.height <= bottomSpace && size.width <= rightSpace;
    const canFitBottom = size.height <= bottomSpace;
    const canFitBottomLeft = size.height <= bottomSpace && size.width <= leftSpace;
    const canFitLeft = size.width <= leftSpace;
    const canFitTopLeft = size.height <= topSpace && size.width <= leftSpace;

    // Prefer positions in order: top, top-right, right, bottom-right, bottom, bottom-left, left, top-left
    if (canFitTop) {
      return "top";
    }
    if (canFitTopRight) {
      return "top-right";
    }
    if (canFitRight) {
      return "right";
    }
    if (canFitBottomRight) {
      return "bottom-right";
    }
    if (canFitBottom) {
      return "bottom";
    }
    if (canFitBottomLeft) {
      return "bottom-left";
    }
    if (canFitLeft) {
      return "left";
    }
    if (canFitTopLeft) {
      return "top-left";
    }

    // If none fit perfectly, pick the position with the most available space
    // For vertical positions, use height space; for horizontal, use width space
    // For diagonals, use the minimum of the two dimensions
    const positions: TooltipPosition[] = [
      "top", "top-right", "right", "bottom-right",
      "bottom", "bottom-left", "left", "top-left"
    ];

    const spaceForPosition = (pos: TooltipPosition): number => {
      switch (pos) {
        case "top":
          return topSpace;
        case "top-right":
          return topRightSpace;
        case "right":
          return rightSpace;
        case "bottom-right":
          return bottomRightSpace;
        case "bottom":
          return bottomSpace;
        case "bottom-left":
          return bottomLeftSpace;
        case "left":
          return leftSpace;
        case "top-left":
          return topLeftSpace;
      }
    };

    return positions.reduce((best, pos) => {
      return spaceForPosition(pos) > spaceForPosition(best) ? pos : best;
    }, "top" as TooltipPosition);
  }

  /**
   * Prepares the tooltip for fixed positioning by clearing any conflicting CSS properties.
   * All tooltips use position: fixed with manual calculations.
   */
  private applyPosition(pair: TooltipPair, position: TooltipPosition): void {
    const { tooltip } = pair;

    // Always use position: fixed with manual positioning calculations
    tooltip.style.position = "fixed";
    tooltip.style.removeProperty("position-area");
    // Clear CSS custom properties - we don't use them anymore
    tooltip.style.removeProperty("--tooltip-shift-x");
    tooltip.style.removeProperty("--tooltip-shift-y");
    // Remove the CSS transform - GSAP will handle scale via its own transform
    tooltip.style.transform = "none";
  }

  /**
   * Calculates and applies fixed positioning for tooltips in the dedicated container.
   * Uses getBoundingClientRect() which returns viewport-relative coordinates, perfect for position: fixed.
   */
  private calculateFixedPosition(pair: TooltipPair, position: TooltipPosition, size?: TooltipSize): void {
    const { tooltip, anchor } = pair;
    // getBoundingClientRect() returns position relative to viewport, which is what we need for position: fixed
    // This automatically accounts for any scrolling
    const anchorRect = anchor.getBoundingClientRect();
    const clearance = TooltipFallbackController.ANCHOR_GAP_PX;

    // DEBUG: Log anchor and viewport information
    TooltipLogger.log(pair.anchorId, "calculateFixedPosition", {
      position,
      anchorRect: anchorRect,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      },
      boundary: this.boundaryElement ? {
        rect: this.boundaryElement.getBoundingClientRect(),
        scrollTop: (this.boundaryElement as HTMLElement).scrollTop,
        scrollLeft: (this.boundaryElement as HTMLElement).scrollLeft
      } : null
    });

    // Get tooltip size - use provided size if available, otherwise measure
    let tooltipWidth: number;
    let tooltipHeight: number;
    if (size) {
      tooltipWidth = size.width;
      tooltipHeight = size.height;
    } else {
      const tooltipRect = tooltip.getBoundingClientRect();
      tooltipWidth = tooltipRect.width > 0 ? tooltipRect.width : tooltip.scrollWidth;
      tooltipHeight = tooltipRect.height > 0 ? tooltipRect.height : tooltip.scrollHeight;
    }

    // Reset positioning
    tooltip.style.top = "";
    tooltip.style.bottom = "";
    tooltip.style.left = "";
    tooltip.style.right = "";
    // Don't clear transform here - GSAP needs it for scale animation
    // We'll ensure x/y are 0 so GSAP doesn't interfere with positioning

    let top = 0;
    let left = 0;

    switch (position) {
      case "top":
        top = anchorRect.top - tooltipHeight - clearance;
        left = anchorRect.left + (anchorRect.width / 2) - (tooltipWidth / 2);
        break;
      case "top-right":
        top = anchorRect.top - tooltipHeight - clearance;
        left = anchorRect.right - tooltipWidth;
        break;
      case "right":
        top = anchorRect.top + (anchorRect.height / 2) - (tooltipHeight / 2);
        left = anchorRect.right + clearance;
        break;
      case "bottom-right":
        top = anchorRect.bottom + clearance;
        left = anchorRect.right - tooltipWidth;
        break;
      case "bottom":
        top = anchorRect.bottom + clearance;
        left = anchorRect.left + (anchorRect.width / 2) - (tooltipWidth / 2);
        break;
      case "bottom-left":
        top = anchorRect.bottom + clearance;
        left = anchorRect.left;
        break;
      case "left":
        top = anchorRect.top + (anchorRect.height / 2) - (tooltipHeight / 2);
        left = anchorRect.left - tooltipWidth - clearance;
        break;
      case "top-left":
        top = anchorRect.top - tooltipHeight - clearance;
        left = anchorRect.left;
        break;
    }

    // When using fixed positioning, boundary offsets are applied directly to top/left
    // (not via CSS transform). The offsets will be applied by updateBoundaryOffsets.
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    // Ensure transform is set to none so CSS transform doesn't interfere
    // GSAP will handle scale animation via its own transform property
    tooltip.style.transform = "none";

    // Force a reflow to ensure the position is applied before we measure
    void tooltip.offsetHeight;

    // DEBUG: Log calculated position
    TooltipLogger.log(pair.anchorId, "positionCalculated", {
      position,
      calculatedTop: top,
      calculatedLeft: left,
      tooltipSize: {
        width: tooltipWidth,
        height: tooltipHeight
      },
      clearance,
      actualTooltipRect: tooltip.getBoundingClientRect() // Verify position was applied
    });
  }


  /**
   * Applies offset adjustments to keep the tooltip within the boundary.
   * Checks the actual rendered position and applies offsets directly to top/left.
   */
  private updateBoundaryOffsets(pair: TooltipPair, size: TooltipSize, position: TooltipPosition): void {
    const boundary = this.boundaryElement;

    if (boundary === null) {
      return;
    }

    // Force a reflow to ensure the browser has laid out the tooltip with its new position
    void pair.tooltip.offsetHeight;

    const bounds = boundary.getBoundingClientRect();
    const padding = TooltipFallbackController.BOUNDARY_PADDING_PX;
    const safeLeft = bounds.left + padding;
    const safeRight = bounds.right - padding - TooltipFallbackController.RIGHT_EDGE_OFFSET_PX;
    const safeTop = bounds.top + padding;
    const safeBottom = bounds.bottom - padding;

    if (safeRight <= safeLeft || safeBottom <= safeTop) {
      return;
    }

    // Get the tooltip's actual rendered position (after reflow for fixed positioning)
    const tooltipRect = pair.tooltip.getBoundingClientRect();

    // Use a small tolerance to avoid micro-adjustments that cause jitter
    const tolerance = 2;

    // Check if tooltip actually overflows the safe boundary area (with tolerance)
    const overflowsLeft = tooltipRect.left < (safeLeft - tolerance);
    const overflowsRight = tooltipRect.right > (safeRight + tolerance);
    const overflowsTop = tooltipRect.top < (safeTop - tolerance);
    const overflowsBottom = tooltipRect.bottom > (safeBottom + tolerance);

    // Only apply shifts if there's significant overflow (beyond tolerance)
    let horizontalShift = 0;
    let verticalShift = 0;

    if (overflowsLeft) {
      // Tooltip extends past left edge, shift it right
      horizontalShift = safeLeft - tooltipRect.left;
    } else if (overflowsRight) {
      // Tooltip extends past right edge, shift it left
      horizontalShift = safeRight - tooltipRect.right;
    }

    if (overflowsTop) {
      // Tooltip extends past top edge, shift it down
      verticalShift = safeTop - tooltipRect.top;
    } else if (overflowsBottom) {
      // Tooltip extends past bottom edge, shift it up
      verticalShift = safeBottom - tooltipRect.bottom;
    }

    // Only apply shifts if there's actual overflow
    if (Math.abs(horizontalShift) >= tolerance || Math.abs(verticalShift) >= tolerance) {
      // Apply offsets directly to top/left for fixed positioning
      const currentTop = parseFloat(pair.tooltip.style.top) || 0;
      const currentLeft = parseFloat(pair.tooltip.style.left) || 0;
      const newTop = currentTop + verticalShift;
      const newLeft = currentLeft + horizontalShift;

      pair.tooltip.style.top = `${newTop}px`;
      pair.tooltip.style.left = `${newLeft}px`;

      // Force another reflow to ensure the new position is applied
      void pair.tooltip.offsetHeight;

      // Get the updated tooltip rect after applying offsets
      const updatedTooltipRect = pair.tooltip.getBoundingClientRect();

      // DEBUG: Log boundary offset application
      TooltipLogger.log(pair.anchorId, "applyingBoundaryOffsets", {
        currentTop,
        currentLeft,
        horizontalShift,
        verticalShift,
        newTop,
        newLeft,
        tooltipRect: updatedTooltipRect,
        boundaryRect: bounds,
        overflows: {
          left: overflowsLeft,
          right: overflowsRight,
          top: overflowsTop,
          bottom: overflowsBottom
        }
      });
    }
  }

  /**
   * Retrieves the tooltip's visual size even while it is hidden.
   */
  private measureTooltipSize(tooltip: HTMLElement): TooltipSize {
    const rect = tooltip.getBoundingClientRect();

    const width = rect.width > 0 ? rect.width : tooltip.scrollWidth;
    const height = rect.height > 0 ? rect.height : tooltip.scrollHeight;

    return { width, height };
  }
}

/**
 * Bootstraps the tooltip fallback logic once the DOM is ready.
 */
function initTooltipFallbacks(): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTooltipFallbacks, { once: true });
    return;
  }

  new TooltipFallbackController();
}

initTooltipFallbacks();
