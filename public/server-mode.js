/**
 * server-mode.js — Hides local-only navigation on server deployments.
 *
 * On server mode (Railway), the gateway is a resource hub + API backend.
 * Only Library, Agents, and Admin are shown. Everything else (Home, Chat,
 * Lab, Monitor) is hidden. Users are redirected to / (Library) if they
 * try to access hidden pages directly.
 *
 * Load this script early in every page (after auth.js, before main script).
 * On local installs it's a no-op.
 */

(function () {
  // Pages allowed on server mode
  const SERVER_PAGES = new Set(["/", "/library", "/org", "/admin", "/api-docs", "/mcp-docs", "/user-guide", "/mini", "/ui"]);

  // Nav links to hide on server mode (matched by href)
  const HIDDEN_HREFS = new Set(["/", "/ui", "/lab"]);
  // "Home" tab href is "/" — on server mode, Library is at "/" so we hide the Home tab.
  // Utility links to hide (matched by href)
  const HIDDEN_UTILS = new Set(["/monitor"]);

  async function initServerMode() {
    let mode;
    try {
      const r = await fetch("/api/config/service");
      if (!r.ok) return;
      const data = await r.json();
      mode = data.deploymentMode;
    } catch {
      return; // can't determine mode — do nothing
    }

    if (mode !== "server") return;

    // Expose for other scripts to check
    window._ma1ServerMode = true;

    // Redirect away from hidden pages
    const path = window.location.pathname;
    if (!SERVER_PAGES.has(path) && !path.startsWith("/api/")) {
      window.location.href = "/";
      return;
    }

    // Hide nav tabs
    document.querySelectorAll("a.tab-btn").forEach(function (el) {
      const href = el.getAttribute("href");
      if (HIDDEN_HREFS.has(href)) {
        el.style.display = "none";
      }
      // Rename Home link on Library page to "Library" if it points to /
      if (href === "/" && !HIDDEN_HREFS.has(href)) {
        el.textContent = "Library";
      }
    });

    // Hide utility links (Monitor, etc.)
    document.querySelectorAll("a.gear-btn").forEach(function (el) {
      const href = el.getAttribute("href");
      if (HIDDEN_UTILS.has(href)) {
        el.style.display = "none";
      }
    });

    // Hide sub-nav links that point to non-server pages (Tasks, Projects, Automations)
    document.querySelectorAll("a.sub-nav-link").forEach(function (el) {
      const href = el.getAttribute("href");
      if (href && !SERVER_PAGES.has(href)) {
        el.style.display = "none";
      }
    });

    // On Library page: hide Add buttons (library is read-only on server mode)
    document.querySelectorAll(".add-split").forEach(function (el) {
      el.style.display = "none";
    });

    // On Library page: update the "/" tab to show as "Library" and be active
    if (path === "/" || path === "/library") {
      document.querySelectorAll("a.tab-btn").forEach(function (el) {
        if (el.getAttribute("href") === "/library") {
          el.classList.add("active");
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initServerMode);
  } else {
    initServerMode();
  }
})();
