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
        // Toggle gradient overlay on the paper stack based on active tab
        // Front page does not need the bottom fade; other pages do
        const paperStack = document.querySelector(".paper-stack");
        if (paperStack) {
            if (tabName === "front") {
                paperStack.classList.add("front-page-active");
            }
            else {
                paperStack.classList.remove("front-page-active");
            }
        }
        // Toggle visibility of the polaroid container based on active tab
        const polaroidContainer = document.querySelector(".pc-polaroid-container");
        if (polaroidContainer) {
            if (tabName === "front") {
                polaroidContainer.style.display = "";
                polaroidContainer.setAttribute("aria-hidden", "false");
            }
            else {
                polaroidContainer.style.display = "none";
                polaroidContainer.setAttribute("aria-hidden", "true");
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