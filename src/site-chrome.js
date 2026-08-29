import "./site-chrome.css";

const PRACTICE_LABEL = "Everything is practice";

export function setupSiteChrome() {
  if (document.querySelector(".nav-practice")) return;

  const nav = document.querySelector(".top-nav");
  if (!nav) return;

  const label = document.createElement("p");
  label.className = "nav-practice";
  label.textContent = PRACTICE_LABEL;
  nav.prepend(label);
}

setupSiteChrome();
