import "./site-chrome.css";

const PRACTICE_LABEL = "Everything is practice";

export function setupSiteChrome() {
  if (document.querySelector(".nav-practice")) return;

  const navLeft = document.querySelector(".nav-left");
  if (!navLeft) return;

  const label = document.createElement("p");
  label.className = "nav-practice";
  label.textContent = PRACTICE_LABEL;
  navLeft.append(label);
}

setupSiteChrome();
