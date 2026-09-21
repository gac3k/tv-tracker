"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

const KEY = "vod-theme";

function currentTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function persist(next: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // private mode — theme still applies for this page
  }
  document.cookie = `${KEY}=${next};path=/;max-age=31536000;samesite=lax`;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function set(next: "light" | "dark") {
    persist(next);
    setTheme(next);
  }

  return (
    <div className="theme-switch" role="radiogroup" aria-label="Color theme">
      <button
        type="button"
        role="radio"
        className="theme-opt"
        data-theme-value="light"
        aria-checked={theme === "light"}
        aria-label="Light"
        onClick={() => set("light")}
      >
        <Icon name="sun" />
      </button>
      <button
        type="button"
        role="radio"
        className="theme-opt"
        data-theme-value="dark"
        aria-checked={theme === "dark"}
        aria-label="Dark"
        onClick={() => set("dark")}
      >
        <Icon name="moon" />
      </button>
    </div>
  );
}
