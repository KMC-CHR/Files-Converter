import React from "react";
import { Sun, Moon } from "lucide-react";

interface HeaderProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

const scrollToId = (e: React.MouseEvent<HTMLAnchorElement>, id?: string) => {
  e.preventDefault();

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";

  if (!id) {
    window.scrollTo({ top: 0, behavior });
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return;
  }

  const target = document.getElementById(id);
  if (!target) return;

  target.scrollIntoView({ behavior, block: "start" });
  target.focus({ preventScroll: true });
  history.replaceState(null, "", `#${id}`);
};

export const Header: React.FC<HeaderProps> = ({ theme, onToggleTheme }) => {
  const isDark = theme === "dark";

  return (
    <header className="app-header">
      <a href="/" onClick={(e) => scrollToId(e)} className="brand-link" aria-label="FileCraft Home">
        <div className="brand-icon">
          <img
            src={isDark ? "/logo-white.png" : "/logo-black.png"}
            alt="FileCraft"
            className="brand-logo-img"
          />
        </div>
        <div className="brand-text-group">
          <span className="brand-name">FileCraft</span>
          <span className="brand-tagline">In-Memory Media Studio</span>
        </div>
      </a>

      <nav className="nav-menu" aria-label="Primary utility navigation">
        <a href="#faq" onClick={(e) => scrollToId(e, "faq")} className="nav-link-clean">
          FAQ
        </a>

        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={onToggleTheme}
          className={`theme-slider ${isDark ? "is-dark" : ""}`}
        >
          <span className="theme-slider-icons" aria-hidden="true">
            <Sun size={13} strokeWidth={1.75} />
            <Moon size={13} strokeWidth={1.75} />
          </span>
          <span className="theme-slider-thumb" aria-hidden="true">
            <Sun
              size={13}
              strokeWidth={2}
              style={{
                position: "absolute",
                opacity: isDark ? 0 : 1,
                transform: isDark ? "rotate(-40deg) scale(0.75)" : "rotate(0deg) scale(1)",
                transition: "opacity 180ms ease, transform 240ms cubic-bezier(0.34, 1.4, 0.64, 1)",
              }}
            />
            <Moon
              size={13}
              strokeWidth={2}
              style={{
                position: "absolute",
                opacity: isDark ? 1 : 0,
                transform: isDark ? "rotate(0deg) scale(1)" : "rotate(40deg) scale(0.75)",
                transition: "opacity 180ms ease, transform 240ms cubic-bezier(0.34, 1.4, 0.64, 1)",
              }}
            />
          </span>
        </button>
      </nav>
    </header>
  );
};

export default Header;
