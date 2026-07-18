document.addEventListener("DOMContentLoaded", () => {
  const hamburgerMenu = document.getElementById("hamburger-menu");
  const hamburgerIcon = hamburgerMenu.querySelector(".hamburger-icon");
  const navMenu = document.getElementById("nav-menu");
  const mobileNavigation = window.matchMedia("(max-width: 48rem)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  function setMenuOpen(isOpen, { restoreFocus = false } = {}) {
    navMenu.classList.toggle("active", isOpen);
    hamburgerMenu.setAttribute("aria-expanded", String(isOpen));
    hamburgerIcon.textContent = isOpen ? "\u00d7" : "\u2630";
    if (typeof window.updateNavigationLabel === "function") {
      window.updateNavigationLabel();
    } else {
      hamburgerMenu.setAttribute(
        "aria-label",
        isOpen ? "ナビゲーションを閉じる" : "ナビゲーションを開く"
      );
    }
    if (restoreFocus) {
      hamburgerMenu.focus();
    }
  }
  hamburgerMenu.addEventListener("click", () => {
    setMenuOpen(!navMenu.classList.contains("active"));
  });
  navMenu.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      setMenuOpen(false);
    }
  });
  document.addEventListener("click", (event) => {
    if (
      navMenu.classList.contains("active") &&
      !navMenu.contains(event.target) &&
      !hamburgerMenu.contains(event.target)
    ) {
      setMenuOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && navMenu.classList.contains("active")) {
      setMenuOpen(false, { restoreFocus: true });
    }
  });
  mobileNavigation.addEventListener("change", () => setMenuOpen(false));
  const header = document.getElementById("header");
  window.addEventListener(
    "scroll",
    () => header.classList.toggle("shrink", window.scrollY > 50),
    { passive: true }
  );
  async function loadProjects() {
    const container = document.getElementById("projects-container");
    try {
      const response = await fetch("projects.json");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const projects = await response.json();
      if (!Array.isArray(projects)) {
        throw new TypeError("projects.json must contain an array");
      }
      projects.forEach((project) => {
        const card = document.createElement("article");
        const title = document.createElement("h3");
        const description = document.createElement("p");
        const link = document.createElement("a");
        card.className = "project-card";
        title.textContent = project.title;
        description.textContent = project.description;
        link.href = project.link;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "View Project";
        card.append(title, description, link);
        container.appendChild(card);
      });
    } catch (error) {
      console.error("Unable to load projects:", error);
      container.setAttribute("role", "status");
      container.textContent = "Projects could not be loaded.";
    }
  }
  loadProjects();
  if (!reducedMotion.matches && window.particlesJS?.load) {
    particlesJS.load("particles-js", "particles.json?v=1", () => {
      console.log("particles.js loaded with geometric polygons");
    });
  } else if (!reducedMotion.matches) {
    console.warn("particles.js is unavailable; using the static background.");
  }
  const langToggle = document.getElementById("lang-toggle");
  langToggle.addEventListener("click", () => {
    if (!window.i18next?.changeLanguage) {
      console.error("Language switching is unavailable because i18next did not load.");
      return;
    }
    const nextLanguage = i18next.resolvedLanguage === "ja" ? "en" : "ja";
    i18next.changeLanguage(nextLanguage);
  });
});
