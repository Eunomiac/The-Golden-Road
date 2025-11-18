import "./gsap.min.js";

const gsapGlobal = window.gsap;

if (!gsapGlobal) {
  throw new Error("GSAP failed to load from global scope.");
}

export const gsap = gsapGlobal;
export default gsapGlobal;

