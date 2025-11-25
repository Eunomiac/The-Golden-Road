"use strict";
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
function initTabNavigation() {
    // Wait for DOM to be ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initTabNavigation);
        return;
    }
    const tabButtons = document.querySelectorAll(".tab-navigation .tab-button");
    const pageSections = document.querySelectorAll(".pc-page");
    if (tabButtons.length === 0 || pageSections.length === 0) {
        return;
    }
    /**
     * Switch to a specific tab
     * @param tabName - The name of the tab to activate (e.g., "front", "bio", "merits", "deviation")
     */
    function switchTab(tabName) {
        // Update tab buttons
        tabButtons.forEach((button) => {
            const buttonTab = button.getAttribute("data-tab");
            const isActive = buttonTab === tabName;
            if (isActive) {
                button.classList.add("active");
                button.setAttribute("aria-selected", "true");
            }
            else {
                button.classList.remove("active");
                button.setAttribute("aria-selected", "false");
            }
        });
        // Update page sections
        pageSections.forEach((section) => {
            const sectionName = section.getAttribute("name");
            const isActive = sectionName === tabName;
            if (isActive) {
                section.classList.add("active");
                section.setAttribute("aria-hidden", "false");
            }
            else {
                section.classList.remove("active");
                section.setAttribute("aria-hidden", "true");
            }
        });
        // Adjust overflow for paper-stack-scroll based on active tab
        // Front page needs overflow unset for polaroid, other pages need overflow for scrolling
        const scrollContainer = document.querySelector(".paper-stack-scroll");
        if (scrollContainer) {
            if (tabName === "front") {
                // Remove overflow restrictions for front page (allows polaroid to overflow)
                scrollContainer.style.overflowX = "unset";
                scrollContainer.style.overflowY = "unset";
            }
            else {
                // Restore overflow for other pages (enables proper scrolling)
                scrollContainer.style.overflowX = "hidden";
                scrollContainer.style.overflowY = "auto";
            }
        }
    }
    // Set up click handlers for tab buttons
    tabButtons.forEach((button) => {
        button.addEventListener("click", (event) => {
            event.preventDefault();
            const tabName = button.getAttribute("data-tab");
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
//# sourceMappingURL=tab-navigation.js.map