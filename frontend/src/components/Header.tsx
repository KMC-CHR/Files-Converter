import React from "react";
import { Sun, Moon } from "lucide-react";

interface HeaderProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

const scrollToId = (e: React.MouseEvent<HTMLAnchorElement>, id?: string) => {
  e.preventDefault();

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // On touch / coarse-pointer devices (Samsung, Xiaomi, iOS, etc.) the browser
  // URL bar collapses mid-smooth-scroll, shrinking the viewport.
  // scrollIntoView() is viewport-relative so it recalculates its target against
  // the new, smaller viewport and snaps the scroll position → visible jitter.
  // Use instant jump on those devices to avoid the snap entirely.
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const behavior: ScrollBehavior = reduceMotion || isCoarsePointer ? "auto" : "smooth";

  if (!id) {
    window.scrollTo({ top: 0, behavior });
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return;
  }

  const target = document.getElementById(id);
  if (!target) return;

  // Use window.scrollTo with an ABSOLUTE document-Y position instead of
  // scrollIntoView(). scrollIntoView() recalculates relative to the viewport
  // every animation frame — if the viewport resizes (URL bar hide/show) the
  // target jumps. An absolute scrollY is computed once before the scroll
  // starts and is never affected by later viewport changes.
  const SCROLL_MARGIN = 16; // mirrors the CSS scroll-margin-top: 1rem on #faq
  const top = target.getBoundingClientRect().top + window.scrollY - SCROLL_MARGIN;
  window.scrollTo({ top: Math.max(0, top), behavior });

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
