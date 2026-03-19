(function initThemeToggle() {
  const storageKey = "learnix-theme";
  const styleId = "learnix-theme-fallback-styles";

  function ensureFallbackStyles() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .theme-toggle-btn{
        background:#ffffff;color:#1d4ed8;border:1px solid #dbeafe;border-radius:8px;
        padding:8px 12px;font-size:.9rem;font-weight:700;cursor:pointer;
      }
      .theme-toggle-btn:hover{background:#eff6ff;}
      .theme-toggle-floating{position:fixed;top:16px;right:16px;z-index:1000;}
      body.dark{background:#020617 !important;color:#e5e7eb !important;}
      body.dark .navbar{background:#020617 !important;border-color:#1e293b !important;}
      body.dark a{color:#93c5fd;}
      body.dark input,body.dark select,body.dark textarea{
        background:#020617 !important;color:#e5e7eb !important;border-color:#334155 !important;
      }
      body.dark .theme-toggle-btn{
        background:#0f172a;color:#e2e8f0;border-color:#334155;
      }
    `;
    document.head.appendChild(style);
  }

  function getInitialTheme() {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.body.classList.toggle("dark", theme === "dark");
    const button = document.getElementById("themeToggleBtn");
    if (button) {
      button.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
      button.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    }
  }

  function createToggleButton() {
    if (document.getElementById("themeToggleBtn")) return;

    const button = document.createElement("button");
    button.id = "themeToggleBtn";
    button.type = "button";
    button.className = "theme-toggle-btn";

    button.addEventListener("click", () => {
      const nextTheme = document.body.classList.contains("dark") ? "light" : "dark";
      localStorage.setItem(storageKey, nextTheme);
      applyTheme(nextTheme);
    });

    const navActions = document.querySelector(".nav-actions");
    if (navActions) {
      navActions.prepend(button);
      return;
    }

    button.classList.add("theme-toggle-floating");
    document.body.appendChild(button);
  }

  ensureFallbackStyles();
  createToggleButton();
  applyTheme(getInitialTheme());

  const observer = new MutationObserver(() => {
    if (!document.getElementById("themeToggleBtn")) {
      createToggleButton();
      applyTheme(document.body.classList.contains("dark") ? "dark" : "light");
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
