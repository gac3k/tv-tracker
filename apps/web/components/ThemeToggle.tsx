"use client";

const KEY = "vod-theme";

export function ThemeToggle() {
  function toggle() {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // private mode — theme still applies for this page
    }
    document.cookie = `${KEY}=${next};path=/;max-age=31536000;samesite=lax`;
  }

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label="Toggle color theme">
      <span className="theme-toggle-when-dark">Light</span>
      <span className="theme-toggle-when-light">Dark</span>
    </button>
  );
}
