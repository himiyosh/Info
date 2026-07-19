document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  function requireElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Required element #${id} was not found.`);
    }
    return element;
  }

  const hamburgerMenu = requireElement("hamburger-menu");
  const navMenu = requireElement("nav-menu");
  const langToggle = requireElement("lang-toggle");
  const projectsContainer = requireElement("projects-container");
  const mobileNavigation = window.matchMedia("(max-width: 47.999rem)");
  let projects = null;
  let projectState = "loading";

  function updateNavigationLabel() {
    const labelKey =
      hamburgerMenu.getAttribute("aria-expanded") === "true"
        ? "nav.closeMenu"
        : "nav.openMenu";
    hamburgerMenu.setAttribute("aria-label", window.siteI18n.t(labelKey));
  }

  window.updateNavigationLabel = updateNavigationLabel;

  function setMenuOpen(isOpen, { restoreFocus = false } = {}) {
    const shouldOpen = mobileNavigation.matches && isOpen;
    navMenu.classList.toggle("active", shouldOpen);
    hamburgerMenu.setAttribute("aria-expanded", String(shouldOpen));
    navMenu.setAttribute("aria-hidden", String(mobileNavigation.matches && !shouldOpen));
    document.body.classList.toggle("menu-open", shouldOpen);
    updateNavigationLabel();

    if (shouldOpen) {
      navMenu.querySelector("a")?.focus();
    } else if (restoreFocus) {
      hamburgerMenu.focus();
    }
  }

  function syncNavigationMode() {
    setMenuOpen(false);
    if (!mobileNavigation.matches) {
      navMenu.removeAttribute("aria-hidden");
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

  mobileNavigation.addEventListener("change", syncNavigationMode);
  langToggle.addEventListener("click", () => window.siteI18n.toggle());
  syncNavigationMode();

  function localizedValue(value) {
    if (typeof value === "string") {
      return value;
    }
    if (!value || typeof value !== "object") {
      throw new TypeError("Localized project values must be strings or objects.");
    }
    return value[window.siteI18n.language] ?? value.ja ?? value.en;
  }

  function validateProject(project, index) {
    if (!project || typeof project !== "object") {
      throw new TypeError(`Project ${index + 1} must be an object.`);
    }

    ["title", "description", "kind", "action", "link"].forEach((field) => {
      if (!project[field]) {
        throw new TypeError(`Project ${index + 1} is missing ${field}.`);
      }
    });

    const url = new URL(project.link, window.location.href);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new TypeError(`Project ${index + 1} has an unsupported link protocol.`);
    }

    if (project.stack && !Array.isArray(project.stack)) {
      throw new TypeError(`Project ${index + 1} stack must be an array.`);
    }
  }

  function renderProjects() {
    if (!projects) {
      return;
    }

    const fragment = document.createDocumentFragment();
    projects.forEach((project) => {
      const article = document.createElement("article");
      const headingGroup = document.createElement("div");
      const title = document.createElement("h3");
      const kind = document.createElement("p");
      const details = document.createElement("div");
      const description = document.createElement("p");
      const link = document.createElement("a");
      const linkText = document.createElement("span");
      const linkArrow = document.createElement("span");

      article.className = "project-row";
      headingGroup.className = "project-heading";
      title.textContent = localizedValue(project.title);
      kind.className = "project-kind";
      kind.textContent = localizedValue(project.kind);
      description.className = "project-description";
      description.textContent = localizedValue(project.description);

      headingGroup.append(title, kind);
      details.append(description);

      if (project.stack?.length) {
        const stack = document.createElement("p");
        stack.className = "project-stack";
        stack.textContent = project.stack.join(" · ");
        details.append(stack);
      }

      link.className = "project-link";
      link.href = project.link;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      linkText.textContent = localizedValue(project.action);
      linkArrow.className = "project-link-arrow";
      linkArrow.setAttribute("aria-hidden", "true");
      linkArrow.textContent = "\u2197";
      link.append(linkText, linkArrow);

      article.append(headingGroup, details, link);
      fragment.append(article);
    });

    projectsContainer.replaceChildren(fragment);
    projectsContainer.setAttribute("aria-busy", "false");
    projectState = "ready";
  }

  function renderProjectLoading() {
    const status = document.createElement("p");
    status.className = "projects-status";
    status.textContent = window.siteI18n.t("projects.loading");
    projectsContainer.replaceChildren(status);
    projectsContainer.setAttribute("aria-busy", "true");
  }

  function renderProjectError() {
    const wrapper = document.createElement("div");
    const status = document.createElement("p");
    const retry = document.createElement("button");

    status.className = "projects-status";
    status.setAttribute("role", "status");
    status.textContent = window.siteI18n.t("projects.error");
    retry.className = "retry-button";
    retry.type = "button";
    retry.textContent = window.siteI18n.t("projects.retry");
    retry.addEventListener("click", loadProjects);
    wrapper.append(status, retry);
    projectsContainer.replaceChildren(wrapper);
    projectsContainer.setAttribute("aria-busy", "false");
    projectState = "error";
  }

  async function loadProjects() {
    projectState = "loading";
    renderProjectLoading();

    try {
      const response = await fetch("projects.json", {
        headers: { Accept: "application/json" }
      });
      if (!response.ok) {
        throw new Error(`projects.json returned HTTP ${response.status}.`);
      }

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        throw new TypeError("projects.json must contain a non-empty array.");
      }
      data.forEach(validateProject);
      projects = data;
      renderProjects();
    } catch (error) {
      console.error("Unable to load projects:", error);
      renderProjectError();
    }
  }

  document.addEventListener("site-languagechange", () => {
    updateNavigationLabel();
    if (projectState === "ready") {
      renderProjects();
    } else if (projectState === "error") {
      renderProjectError();
    } else {
      renderProjectLoading();
    }
  });

  const observedSections = [...document.querySelectorAll("main section[id]")];
  const navigationLinks = [...navMenu.querySelectorAll('a[href^="#"]')];
  if ("IntersectionObserver" in window) {
    const visibleSections = new Map();
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visibleSections.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
        });
        const activeSection = [...visibleSections.entries()]
          .sort((left, right) => right[1] - left[1])
          .find(([, ratio]) => ratio > 0)?.[0];

        navigationLinks.forEach((link) => {
          if (link.hash === `#${activeSection}`) {
            link.setAttribute("aria-current", "location");
          } else {
            link.removeAttribute("aria-current");
          }
        });
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75] }
    );
    observedSections.forEach((section) => sectionObserver.observe(section));
  }

  requireElement("current-year").textContent = String(new Date().getFullYear());
  loadProjects();

  function loadAdSense() {
    if (
      window.location.hostname !== "himiyosh.github.io" ||
      document.querySelector('script[data-service="adsense"]')
    ) {
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.service = "adsense";
    script.src =
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3044810068333301";
    script.addEventListener("error", () => {
      console.warn("AdSense could not be loaded.");
    });
    document.head.append(script);
  }

  window.addEventListener(
    "load",
    () => {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(loadAdSense, { timeout: 4000 });
      } else {
        window.setTimeout(loadAdSense, 2500);
      }
    },
    { once: true }
  );
});
