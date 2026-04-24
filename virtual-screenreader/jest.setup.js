/* eslint-disable no-undef */

(function ensureCssEscapePolyfill() {
  // jsdom sometimes doesn't define global CSS / CSS.escape
  if (typeof globalThis.CSS === "undefined") {
    globalThis.CSS = {};
  }

  if (typeof globalThis.CSS.escape !== "function") {
    // Minimal, practical escape for ids/selectors used by querySelector.
    // Not a perfect spec polyfill, but enough for most ARIA/id cases.
    globalThis.CSS.escape = (value) => {
      const s = String(value);
      return s.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
    };
  }
})();
