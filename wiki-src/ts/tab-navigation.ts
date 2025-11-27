/**
 * Tab Navigation Handler for PC Sheets
 *
 * Manages visibility of PC sheet sections and active tab styling.
 * The default tab is "front", with other tabs (bio, merits, deviation) hidden initially.
 */

/**
 * Initialize tab navigation functionality
 * Sets up event listeners and initializes the default "front" tab
 */
function initTabNavigation(): void {
  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTabNavigation);
    return;
  }

  const tabButtons: NodeListOf<HTMLButtonElement> = document.querySelectorAll(
    ".tab-navigation .tab-button"
  );
  const pageSections: NodeListOf<HTMLElement> = document.querySelectorAll(
    ".pc-page"
  );

  if (tabButtons.length === 0 || pageSections.length === 0) {
    return;
  }

  /**
   * Switch to a specific tab
   * @param tabName - The name of the tab to activate (e.g., "front", "bio", "merits", "deviation")
   */
  function switchTab(tabName: string): void {
    // Update tab buttons
    tabButtons.forEach((button: HTMLButtonElement): void => {
      const buttonTab: string | null = button.getAttribute("data-tab");
      const isActive: boolean = buttonTab === tabName;

      if (isActive) {
        button.classList.add("active");
        button.setAttribute("aria-selected", "true");
      } else {
        button.classList.remove("active");
        button.setAttribute("aria-selected", "false");
      }
    });

    // Update page sections
    pageSections.forEach((section: HTMLElement): void => {
      const sectionName: string | null = section.getAttribute("name");
      const isActive: boolean = sectionName === tabName;

      if (isActive) {
        section.classList.add("active");
        section.setAttribute("aria-hidden", "false");
      } else {
        section.classList.remove("active");
        section.setAttribute("aria-hidden", "true");
      }
    });

    // Toggle gradient overlay on the paper stack based on active tab
    // Front page does not need the bottom fade; other pages do
    const paperStack: HTMLElement | null = document.querySelector(".paper-stack");
    if (paperStack) {
      if (tabName === "front") {
        paperStack.classList.add("front-page-active");
      } else {
        paperStack.classList.remove("front-page-active");
      }
    }

    // Toggle visibility of the polaroid container based on active tab
    const polaroidContainer: HTMLElement | null = document.querySelector(".pc-polaroid-container");
    if (polaroidContainer) {
      if (tabName === "front") {
        polaroidContainer.style.display = "";
        polaroidContainer.setAttribute("aria-hidden", "false");
      } else {
        polaroidContainer.style.display = "none";
        polaroidContainer.setAttribute("aria-hidden", "true");
      }
    }

    // Scroll to top of the scrollable container when switching tabs
    const scrollContainer: HTMLElement | null = document.querySelector(".paper-stack-scroll");
    if (scrollContainer) {
      scrollContainer.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    }
  }

  // Set up click handlers for tab buttons
  tabButtons.forEach((button: HTMLButtonElement): void => {
    button.addEventListener("click", (event: MouseEvent): void => {
      event.preventDefault();
      const tabName: string | null = button.getAttribute("data-tab");

      if (tabName && !button.classList.contains("active")) {
        switchTab(tabName);
      }
    });
  });

  // Initialize with "front" tab as default
  switchTab("front");
}

// Initialize when module loads
initTabNavigation();
