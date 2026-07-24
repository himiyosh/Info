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
  const heroVisual = document.querySelector(".hero-visual");
  const root = document.documentElement;
  root.classList.add("js-enabled");
  const mobileNavigation = window.matchMedia("(max-width: 47.999rem)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let projects = null;
  let projectState = "loading";
  let projectObserver = null;
  const localizedProjectFields = ["title", "description", "kind", "action", "imageAlt"];

  function requireNonEmptyString(value, fieldName) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`${fieldName} must be a non-empty string.`);
    }
    return value.trim();
  }

  if (!reducedMotion.matches) {
    root.classList.add("motion-ready");
  }

  let progressFrame = null;
  function updateScrollProgress() {
    const scrollable = root.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0;
    root.style.setProperty("--scroll-progress", progress.toFixed(4));
    progressFrame = null;
  }

  function requestScrollProgressUpdate() {
    if (progressFrame === null) {
      progressFrame = window.requestAnimationFrame(updateScrollProgress);
    }
  }

  window.addEventListener("scroll", requestScrollProgressUpdate, { passive: true });
  window.addEventListener("resize", requestScrollProgressUpdate, { passive: true });
  updateScrollProgress();

  function resetHeroTilt() {
    if (!heroVisual) {
      return;
    }
    heroVisual.classList.remove("is-tilting");
    heroVisual.style.setProperty("--tilt-x", "0deg");
    heroVisual.style.setProperty("--tilt-y", "0deg");
    heroVisual.style.setProperty("--back-x", "0px");
    heroVisual.style.setProperty("--back-y", "0px");
  }

  function updateHeroTilt(event) {
    if (!heroVisual || reducedMotion.matches || !finePointer.matches) {
      return;
    }
    const bounds = heroVisual.getBoundingClientRect();
    const horizontal = (event.clientX - bounds.left) / bounds.width - 0.5;
    const vertical = (event.clientY - bounds.top) / bounds.height - 0.5;
    heroVisual.classList.add("is-tilting");
    heroVisual.style.setProperty("--tilt-x", `${(horizontal * 5).toFixed(2)}deg`);
    heroVisual.style.setProperty("--tilt-y", `${(-vertical * 5).toFixed(2)}deg`);
    heroVisual.style.setProperty("--back-x", `${(-horizontal * 8).toFixed(2)}px`);
    heroVisual.style.setProperty("--back-y", `${(-vertical * 8).toFixed(2)}px`);
  }

  heroVisual?.addEventListener("pointermove", updateHeroTilt);
  heroVisual?.addEventListener("pointerleave", resetHeroTilt);
  reducedMotion.addEventListener("change", (event) => {
    root.classList.toggle("motion-ready", !event.matches);
    if (event.matches) {
      resetHeroTilt();
    }
  });

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

  function validateLocalizedField(project, index, fieldName) {
    const localized = project[fieldName];
    if (!localized || typeof localized !== "object" || Array.isArray(localized)) {
      throw new TypeError(`Project ${index + 1} field "${fieldName}" must be a localized object.`);
    }
    for (const language of ["ja", "en"]) {
      requireNonEmptyString(
        localized[language],
        `Project ${index + 1} field "${fieldName}.${language}"`
      );
    }
  }

  function validateProject(project, index, seenLinks, seenImages) {
    if (!project || typeof project !== "object") {
      throw new TypeError(`Project ${index + 1} must be an object.`);
    }

    for (const fieldName of localizedProjectFields) {
      validateLocalizedField(project, index, fieldName);
    }

    const projectLink = requireNonEmptyString(project.link, `Project ${index + 1} field "link"`);
    const projectImage = requireNonEmptyString(project.image, `Project ${index + 1} field "image"`);
    const url = new URL(projectLink, window.location.href);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new TypeError(`Project ${index + 1} has an unsupported link protocol.`);
    }
    const normalizedLink = url.toString();
    if (seenLinks.has(normalizedLink)) {
      throw new TypeError(`Duplicate project link detected: ${normalizedLink}`);
    }
    seenLinks.add(normalizedLink);

    const imageUrl = new URL(projectImage, window.location.href);
    if (imageUrl.origin !== window.location.origin) {
      throw new TypeError(`Project ${index + 1} preview must be a local asset.`);
    }
    const normalizedImage = `${imageUrl.pathname}${imageUrl.search}${imageUrl.hash}`;
    if (seenImages.has(normalizedImage)) {
      throw new TypeError(`Duplicate project image detected: ${projectImage}`);
    }
    seenImages.add(normalizedImage);

    if (Object.hasOwn(project, "stack")) {
      if (!Array.isArray(project.stack) || project.stack.length === 0) {
        throw new TypeError(`Project ${index + 1} stack must be a non-empty array when present.`);
      }
      const normalizedStack = new Set();
      project.stack.forEach((stackItem, stackIndex) => {
        const stackValue = requireNonEmptyString(
          stackItem,
          `Project ${index + 1} stack item ${stackIndex + 1}`
        );
        const normalizedValue = stackValue.toLocaleLowerCase("en-US");
        if (normalizedStack.has(normalizedValue)) {
          throw new TypeError(`Project ${index + 1} has duplicate stack entry: ${stackValue}`);
        }
        normalizedStack.add(normalizedValue);
      });
    }
  }

  function renderProjects() {
    if (!projects) {
      return;
    }

    const fragment = document.createDocumentFragment();
    projects.forEach((project, index) => {
      const article = document.createElement("article");
      const media = document.createElement("div");
      const image = document.createElement("img");
      const content = document.createElement("div");
      const headingGroup = document.createElement("div");
      const title = document.createElement("h3");
      const kind = document.createElement("p");
      const details = document.createElement("div");
      const description = document.createElement("p");
      const link = document.createElement("a");
      const linkText = document.createElement("span");
      const linkAnnouncement = document.createElement("span");
      const linkArrow = document.createElement("span");

      article.className = "project-row";
      article.style.setProperty("--project-index", String(index));
      media.className = "project-media";
      image.src = project.image;
      image.alt = localizedValue(project.imageAlt);
      image.width = 960;
      image.height = 540;
      image.loading = "lazy";
      image.decoding = "async";
      media.append(image);
      content.className = "project-content";
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
      linkAnnouncement.className = "sr-only";
      linkAnnouncement.textContent = window.siteI18n.t("accessibility.opensInNewTab");
      linkArrow.className = "project-link-arrow";
      linkArrow.setAttribute("aria-hidden", "true");
      linkArrow.textContent = "\u2197";
      link.append(linkText, linkAnnouncement, linkArrow);

      content.append(headingGroup, details, link);
      article.append(media, content);
      fragment.append(article);
    });

    projectsContainer.replaceChildren(fragment);
    projectsContainer.setAttribute("aria-busy", "false");
    projectState = "ready";
    setupProjectMotion();
  }

  function setupProjectMotion() {
    projectObserver?.disconnect();
    const rows = [...projectsContainer.querySelectorAll(".project-row")];
    if (
      reducedMotion.matches ||
      !root.classList.contains("motion-ready") ||
      !("IntersectionObserver" in window)
    ) {
      rows.forEach((row) => row.classList.add("is-visible"));
      return;
    }

    projectObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18 }
    );
    rows.forEach((row) => projectObserver.observe(row));
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
      const seenLinks = new Set();
      const seenImages = new Set();
      data.forEach((project, index) => validateProject(project, index, seenLinks, seenImages));
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
    const hasAdSlot = document.querySelector(
      'ins.adsbygoogle, [data-adsbygoogle-slot], [data-ad-client]'
    );
    if (
      window.location.hostname !== "himiyosh.github.io" ||
      !hasAdSlot ||
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
