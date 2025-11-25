/**
 * Ensures anchor-based tooltips remain within the viewport by flipping them underneath their
 * anchors when there is not enough space above the trigger element.
 */

import { gsap } from "gsap";

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
 * Observes tooltip anchor interactions and toggles a CSS class when the tooltip needs to render
 * beneath the anchor instead of above it.
 */
type TooltipPosition = "top" | "right" | "bottom" | "left";

class TooltipFallbackController {
  private static readonly BELOW_CLASS = "tooltip--below";
  private static readonly RIGHT_CLASS = "tooltip--right";
  private static readonly LEFT_CLASS = "tooltip--left";
  private static readonly ANCHOR_GAP_PX = 16;
  private static readonly VIEWPORT_PADDING_PX = 8;
  private static readonly BOUNDARY_PADDING_PX = 48;
  private static readonly RIGHT_EDGE_OFFSET_PX = 20;
  private static readonly DEACTIVATE_DELAY_MS = 80;
  private static readonly POSITION_CHECK_INTERVAL_MS = 50;
  private static readonly MAX_POSITION_CHECKS = 30; // 30 * 50ms = 1.5s max
  private static readonly HOVER_DELAY_MS = 500; // 1 second delay before showing tooltip

  private readonly pairs: TooltipPair[];
  private readonly activePairs: Set<TooltipPair>;
  private readonly boundaryElement: HTMLElement | null;
  private readonly positionCheckIntervals: Map<TooltipPair, number>;
  private readonly hoverDelayTimeouts: Map<TooltipPair, number>;

  private readonly reevaluateActivePairs = (): void => {
    if (this.activePairs.size === 0) {
      return;
    }
    // Update placement for every tooltip that is currently visible or focused.
    this.activePairs.forEach((pair: TooltipPair): void => {
      this.updatePlacement(pair);
    });
  };

  constructor() {
    this.pairs = [];
    this.activePairs = new Set<TooltipPair>();
    this.boundaryElement = document.querySelector<HTMLElement>(".paper-stack");
    this.positionCheckIntervals = new Map<TooltipPair, number>();
    this.hoverDelayTimeouts = new Map<TooltipPair, number>();

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

    window.addEventListener("scroll", this.reevaluateActivePairs, { passive: true });
    window.addEventListener("resize", this.reevaluateActivePairs);
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
      // Clear any existing timeout
      this.clearHoverDelay(pair);

      // Set a delay before showing the tooltip
      const timeoutId = window.setTimeout((): void => {
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

      // Stop aggressive positioning checks
      this.stopAggressivePositioning(pair);

      // Remove from active pairs immediately
      this.activePairs.delete(pair);

      // Get current shift values to maintain position during hide animation
      const shiftX = pair.tooltip.style.getPropertyValue("--tooltip-shift-x") || "0px";
      const shiftY = pair.tooltip.style.getPropertyValue("--tooltip-shift-y") || "0px";
      // Hide tooltip with GSAP animation
      gsap.to(pair.tooltip, {
        opacity: 0,
        scale: 0.98,
        x: shiftX,
        y: `calc(${shiftY} + 8px)`,
        duration: 0.15,
        ease: "power2.in",
        onComplete: () => {
          gsap.set(pair.tooltip, { visibility: "hidden" });
          pair.tooltip.classList.remove("tooltip--active");
        }
      });
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
   * Positions the tooltip while hidden, then shows it with GSAP animation.
   */
  private positionAndShowTooltip(pair: TooltipPair): void {
    // Ensure tooltip is hidden initially
    pair.tooltip.classList.remove("tooltip--active");

    // Position the tooltip while it's hidden (this sets --tooltip-shift-x and --tooltip-shift-y)
    this.updatePlacement(pair);

    // Get the computed shift values after positioning
    const shiftX = pair.tooltip.style.getPropertyValue("--tooltip-shift-x") || "0px";
    const shiftY = pair.tooltip.style.getPropertyValue("--tooltip-shift-y") || "0px";

    // Set initial hidden state for GSAP animation
    // Use transform with the shift values
    gsap.set(pair.tooltip, {
      visibility: "hidden",
      opacity: 0,
      scale: 0.98,
      x: shiftX,
      y: `calc(${shiftY} + 8px)`, // Start slightly below
      immediateRender: true
    });

    // Use requestAnimationFrame to ensure positioning is complete before showing
    requestAnimationFrame(() => {
      // Double-check positioning one more time (in case shift values changed)
      this.updatePlacement(pair);

      // Get updated shift values
      const updatedShiftX = pair.tooltip.style.getPropertyValue("--tooltip-shift-x") || "0px";
      const updatedShiftY = pair.tooltip.style.getPropertyValue("--tooltip-shift-y") || "0px";

      // Now animate the tooltip in with GSAP
      gsap.to(pair.tooltip, {
        visibility: "visible",
        opacity: 1,
        scale: 1,
        x: updatedShiftX,
        y: updatedShiftY,
        duration: 0.2,
        ease: "power2.out",
        onComplete: () => {
          // Set up interval to refine positioning once tooltip becomes visible
          this.startAggressivePositioning(pair);
        }
      });
    });
  }

  /**
   * Starts aggressive positioning checks that run repeatedly until the tooltip is properly positioned.
   * This refines positioning after the tooltip becomes visible.
   */
  private startAggressivePositioning(pair: TooltipPair): void {
    // Clear any existing interval for this pair
    this.stopAggressivePositioning(pair);

    // Set up interval to refine positioning once tooltip becomes visible
    // This handles edge cases where the tooltip size might change slightly when fully rendered
    let checkCount = 0;
    const intervalId = window.setInterval((): void => {
      checkCount++;

      // Check if tooltip is actually visible now
      const isVisible = this.isTooltipVisible(pair.tooltip);

      if (isVisible) {
        // Tooltip is visible, do a final refinement check
        this.updatePlacement(pair);
        // Stop checking after a few refinements once visible
        if (checkCount >= 2) {
          this.stopAggressivePositioning(pair);
        }
      } else if (checkCount >= TooltipFallbackController.MAX_POSITION_CHECKS) {
        // Stop checking after max attempts even if not visible
        this.stopAggressivePositioning(pair);
      }
    }, TooltipFallbackController.POSITION_CHECK_INTERVAL_MS);

    this.positionCheckIntervals.set(pair, intervalId);
  }

  /**
   * Stops aggressive positioning checks for a tooltip pair.
   */
  private stopAggressivePositioning(pair: TooltipPair): void {
    const intervalId = this.positionCheckIntervals.get(pair);
    if (intervalId !== undefined) {
      window.clearInterval(intervalId);
      this.positionCheckIntervals.delete(pair);
    }
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
   * Checks whether the anchor or tooltip is hovered/focused, which keeps the pair "active".
   */
  private isPairInteractive(pair: TooltipPair): boolean {
    const activeElement = document.activeElement;
    const anchorHovered = pair.anchor.matches(":hover");
    const tooltipHovered = pair.tooltip.matches(":hover");
    const anchorFocused =
      activeElement instanceof HTMLElement &&
      (pair.anchor === activeElement || pair.anchor.contains(activeElement));
    const tooltipFocused =
      activeElement instanceof HTMLElement && pair.tooltip.contains(activeElement);

    return anchorHovered || tooltipHovered || anchorFocused || tooltipFocused;
  }

  /**
   * Measures available space around the anchor and selects the best position for the tooltip.
   * This works even when the tooltip is hidden by temporarily making it visible for measurement.
   */
  private updatePlacement(pair: TooltipPair): void {
    const { tooltip } = pair;

    // Check if tooltip is already visible - if so, we can measure directly
    const isAlreadyVisible = this.isTooltipVisible(tooltip);

    // Temporarily force tooltip to be measurable even if hidden
    // Store original values
    const originalVisibility = tooltip.style.visibility;
    const originalOpacity = tooltip.style.opacity;
    const originalDisplay = tooltip.style.display;
    const originalTransform = tooltip.style.transform;
    const originalTransition = tooltip.style.transition;

    if (!isAlreadyVisible) {
      // Make tooltip temporarily visible for measurement
      // This allows us to measure and position it before the CSS transition delay
      tooltip.style.visibility = "visible";
      tooltip.style.opacity = "1";
      tooltip.style.display = "";
      tooltip.style.transform = "translate(0, 0) scale(1)"; // Reset transform for accurate measurement
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
        tooltip.style.transform = originalTransform;
        tooltip.style.transition = originalTransition;
      }
      return;
    }

    const bestPosition = this.selectBestPosition(pair, size);
    this.applyPosition(pair, bestPosition);

    // Force a reflow to ensure position classes are applied
    void tooltip.offsetHeight;

    // Apply boundary offsets immediately while tooltip is still visible for measurement
    // This ensures offsets are calculated and applied before the tooltip becomes visible
    this.updateBoundaryOffsets(pair, size, bestPosition);

    if (!isAlreadyVisible) {
      // Restore original styles (positioning classes and offsets are already applied)
      tooltip.style.visibility = originalVisibility;
      tooltip.style.opacity = originalOpacity;
      tooltip.style.display = originalDisplay;
      tooltip.style.transform = originalTransform;
      tooltip.style.transition = originalTransition;
    }
  }

  /**
   * Selects the best position for the tooltip by trying each position and picking the one with the most space.
   */
  private selectBestPosition(pair: TooltipPair, size: TooltipSize): TooltipPosition {
    const { anchor } = pair;
    const anchorRect = anchor.getBoundingClientRect();
    const clearance = TooltipFallbackController.ANCHOR_GAP_PX;
    const padding = TooltipFallbackController.VIEWPORT_PADDING_PX;
    const boundary = this.boundaryElement;

    // Calculate available space for each position
    const spaces: Record<TooltipPosition, number> = {
      top: Math.max(anchorRect.top - clearance - padding, 0),
      bottom: Math.max(window.innerHeight - anchorRect.bottom - clearance - padding, 0),
      right: Math.max(window.innerWidth - anchorRect.right - clearance - padding, 0),
      left: Math.max(anchorRect.left - clearance - padding, 0)
    };

    // If we have a boundary, also check against it
    if (boundary) {
      const bounds = boundary.getBoundingClientRect();
      const boundaryPadding = TooltipFallbackController.BOUNDARY_PADDING_PX;
      spaces.top = Math.min(spaces.top, Math.max(anchorRect.top - bounds.top - clearance - boundaryPadding, 0));
      spaces.bottom = Math.min(spaces.bottom, Math.max(bounds.bottom - anchorRect.bottom - clearance - boundaryPadding, 0));
      spaces.right = Math.min(spaces.right, Math.max(bounds.right - anchorRect.right - clearance - boundaryPadding, 0));
      spaces.left = Math.min(spaces.left, Math.max(anchorRect.left - bounds.left - clearance - boundaryPadding, 0));
    }

    // Determine which positions can fit the tooltip
    const canFitTop = size.height <= spaces.top;
    const canFitBottom = size.height <= spaces.bottom;
    const canFitRight = size.width <= spaces.right;
    const canFitLeft = size.width <= spaces.left;

    // Prefer top if it fits, otherwise try right, then bottom, then left
    if (canFitTop) {
      return "top";
    }
    if (canFitRight) {
      return "right";
    }
    if (canFitBottom) {
      return "bottom";
    }
    if (canFitLeft) {
      return "left";
    }

    // If none fit perfectly, pick the position with the most space
    const positions: TooltipPosition[] = ["top", "right", "bottom", "left"];
    return positions.reduce((best, pos) => {
      const space = pos === "top" || pos === "bottom" ? spaces[pos] : spaces[pos];
      const bestSpace = best === "top" || best === "bottom" ? spaces[best] : spaces[best];
      return space > bestSpace ? pos : best;
    }, "top" as TooltipPosition);
  }

  /**
   * Applies the selected position class to the tooltip.
   */
  private applyPosition(pair: TooltipPair, position: TooltipPosition): void {
    const { tooltip } = pair;
    this.resetPositionClasses(tooltip);

    switch (position) {
      case "bottom":
        tooltip.classList.add(TooltipFallbackController.BELOW_CLASS);
        break;
      case "right":
        tooltip.classList.add(TooltipFallbackController.RIGHT_CLASS);
        break;
      case "left":
        tooltip.classList.add(TooltipFallbackController.LEFT_CLASS);
        break;
      case "top":
      default:
        // Top is the default, no class needed
        break;
    }
  }

  /**
   * Removes all position classes from the tooltip.
   */
  private resetPositionClasses(tooltip: HTMLElement): void {
    tooltip.classList.remove(
      TooltipFallbackController.BELOW_CLASS,
      TooltipFallbackController.RIGHT_CLASS,
      TooltipFallbackController.LEFT_CLASS
    );
  }

  /**
   * Applies minimal offset adjustments to keep the tooltip within the boundary.
   * Since we're using CSS anchor positioning, we check the actual rendered position
   * and only apply shifts when the tooltip actually overflows the boundary.
   */
  private updateBoundaryOffsets(pair: TooltipPair, size: TooltipSize, position: TooltipPosition): void {
    const boundary = this.boundaryElement;

    if (boundary === null) {
      this.resetShiftProperties(pair.tooltip);
      return;
    }

    const bounds = boundary.getBoundingClientRect();
    const padding = TooltipFallbackController.BOUNDARY_PADDING_PX;
    const safeLeft = bounds.left + padding;
    const safeRight = bounds.right - padding - TooltipFallbackController.RIGHT_EDGE_OFFSET_PX;
    const safeTop = bounds.top + padding;
    const safeBottom = bounds.bottom - padding;

    if (safeRight <= safeLeft || safeBottom <= safeTop) {
      this.resetShiftProperties(pair.tooltip);
      return;
    }

    // Get the tooltip's actual rendered position (CSS anchor positioning has already positioned it)
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

    // Only apply shifts if there's actual overflow, otherwise reset
    if (Math.abs(horizontalShift) < tolerance && Math.abs(verticalShift) < tolerance) {
      this.resetShiftProperties(pair.tooltip);
    } else {
      this.applyShiftProperties(pair.tooltip, horizontalShift, verticalShift);
    }
  }

  private applyShiftProperties(tooltip: HTMLElement, x: number, y: number): void {
    const normalizedX = Math.abs(x) < 0.5 ? 0 : x;
    const normalizedY = Math.abs(y) < 0.5 ? 0 : y;

    if (normalizedX === 0) {
      tooltip.style.removeProperty("--tooltip-shift-x");
    } else {
      tooltip.style.setProperty("--tooltip-shift-x", `${normalizedX}px`);
    }

    if (normalizedY === 0) {
      tooltip.style.removeProperty("--tooltip-shift-y");
    } else {
      tooltip.style.setProperty("--tooltip-shift-y", `${normalizedY}px`);
    }
  }

  private resetShiftProperties(tooltip: HTMLElement): void {
    tooltip.style.removeProperty("--tooltip-shift-x");
    tooltip.style.removeProperty("--tooltip-shift-y");
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
