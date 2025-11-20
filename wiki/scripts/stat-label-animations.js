/**
 * GSAP animation for stat-label::before elements
 * Creates a gentle pulsing opacity animation with staggered delays
 */
import { gsap } from "gsap";
/**
 * Shuffle array using Fisher-Yates algorithm
 * @param array - The array to shuffle
 * @returns A new shuffled array (does not modify the original)
 */
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}
/**
 * Initialize staggered pulsing animations for stat-label icons
 */
function initStatLabelAnimations() {
    const duration = 1.5;
    // Wait for DOM to be ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initStatLabelAnimations);
        return;
    }
    // Find all stat-label elements that have a ::before pseudo-element with content
    // Filter to only those that should have icons (asset-tag or hypercompetent-tag)
    const statLabels = document.querySelectorAll(".stat-label.asset-tag, .stat-label.hypercompetent-tag");
    if (statLabels.length === 0) {
        return;
    }
    // Convert NodeList to Array for easier manipulation
    // Shuffle the array to randomize stagger order
    const labelsWithIcons = shuffleArray(Array.from(statLabels));
    const staggerDelay = duration / labelsWithIcons.length;
    gsap.registerEffect({
        name: "pulse",
        effect: (targets, config) => {
            return gsap.timeline({ repeat: -1, yoyo: false, delay: config.index * staggerDelay })
                .to(targets, {
                "--icon-opacity": 1,
                "--icon-scale": 1.25,
                duration: 0.25 * duration,
                ease: "power3.in"
            })
                .to(targets, {
                "--icon-opacity": 0.6,
                "--icon-scale": 1,
                duration: 0.5 * duration,
                ease: "power3.out"
            })
                .set(targets, {
                "--icon-opacity": 0.6,
                "--icon-scale": 1
            }, 12 * duration);
        },
        extendTimeline: true
    });
    gsap.registerEffect({
        name: "shadowBurst",
        effect: (targets, config) => {
            return gsap.timeline({ repeat: -1, yoyo: false, delay: config.index * staggerDelay })
                .fromTo(targets, {
                "--shadow-blur": "0",
                "--shadow-alpha": 1
            }, {
                "--shadow-blur": "12px",
                "--shadow-alpha": 1,
                delay: 0.1 * duration,
                duration: 0.15 * duration,
                ease: "power3.in"
            })
                .to(targets, {
                "--shadow-alpha": 0,
                duration: 4.5 * duration,
                ease: "power3.out"
            })
                .to(targets, {
                "--shadow-blur": "0",
                "--shadow-alpha": 1,
                duration: 0,
                ease: "none"
            })
                .set(targets, {
                "--shadow-blur": "0",
                "--shadow-alpha": 1
            }, 12 * duration);
        },
        extendTimeline: true
    });
    const pulseTest = gsap.effects["pulse"](labelsWithIcons[0], { index: 0 }).duration();
    const shadowBurstTest = gsap.effects["shadowBurst"](labelsWithIcons[0], { index: 0 }).duration();
    labelsWithIcons.forEach((label, index) => {
        gsap.timeline({ delay: index * staggerDelay })["pulse"](label, { index }, 0)["shadowBurst"](label, { index }, 0);
    });
}
// Initialize when module loads
initStatLabelAnimations();
//# sourceMappingURL=stat-label-animations.js.map