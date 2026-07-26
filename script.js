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
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let prefersReducedMotion = motionQuery.matches;
  const supportsScrollDrivenAnimations =
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("animation-timeline", "scroll()") &&
    CSS.supports("animation-timeline", "view()");
  const supportsIntersectionObserver = "IntersectionObserver" in window;
  const menuFocusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type='hidden'])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(", ");
  let projects = null;
  let projectState = "loading";
  const localizedProjectFields = ["title", "description", "kind", "action", "imageAlt"];

  function requireNonEmptyString(value, fieldName) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`${fieldName} must be a non-empty string.`);
    }
    return value.trim();
  }

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

  function isMobileMenuActive() {
    return (
      mobileNavigation.matches &&
      navMenu.classList.contains("active") &&
      hamburgerMenu.getAttribute("aria-expanded") === "true"
    );
  }

  function containMobileMenuFocus(event) {
    if (event.key !== "Tab" || !isMobileMenuActive()) {
      return;
    }

    const menuControls = [...navMenu.querySelectorAll(menuFocusableSelector)].filter(
      (element) =>
        !element.matches(":disabled") &&
        !element.hasAttribute("hidden") &&
        element.getAttribute("aria-hidden") !== "true" &&
        element.getAttribute("aria-disabled") !== "true"
    );
    const lastMenuControl = menuControls.at(-1);

    if (event.shiftKey && document.activeElement === hamburgerMenu && lastMenuControl) {
      event.preventDefault();
      lastMenuControl.focus();
    } else if (!event.shiftKey && document.activeElement === lastMenuControl) {
      event.preventDefault();
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
    containMobileMenuFocus(event);
    if (event.key === "Escape" && navMenu.classList.contains("active")) {
      setMenuOpen(false, { restoreFocus: true });
    }
  });

  mobileNavigation.addEventListener("change", syncNavigationMode);
  langToggle.addEventListener("click", () => window.siteI18n.toggle());
  syncNavigationMode();

  // --- Motion: root scroll progress + micro-parallax -----------------
  // A single passive/rAF-batched scroll handler is the universal path;
  // CSS layers a compositor-driven animation-timeline enhancement on top
  // where supported, which always overrides these inline custom
  // properties, so this handler is skipped entirely when that native
  // support is present (never per-element scroll listeners either way).
  // Armed/disarmed reactively so a runtime prefers-reduced-motion change
  // (not just the value captured at load) immediately stops or restarts
  // this work — see handleMotionPreferenceChange below.
  const progressFill = document.querySelector(".scroll-progress-fill");
  const parallaxDistance = 5;
  let scrollMotionTicking = false;
  let scrollMotionArmed = false;

  function updateScrollMotion() {
    scrollMotionTicking = false;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollRange > 0 ? Math.min(1, Math.max(0, scrollTop / scrollRange)) : 0;
    progressFill?.style.setProperty("--scroll-progress", progress.toFixed(4));

    const viewportCenter = window.innerHeight / 2;
    document.querySelectorAll(".project-media").forEach((mediaFrame) => {
      const rect = mediaFrame.getBoundingClientRect();
      const elementCenter = rect.top + rect.height / 2;
      const offsetRatio = Math.min(
        1,
        Math.max(-1, (elementCenter - viewportCenter) / viewportCenter)
      );
      mediaFrame.style.setProperty(
        "--parallax-y",
        `${(offsetRatio * parallaxDistance * -1).toFixed(2)}px`
      );
    });
  }

  function requestScrollMotionUpdate() {
    if (!scrollMotionTicking) {
      scrollMotionTicking = true;
      window.requestAnimationFrame(updateScrollMotion);
    }
  }

  function armScrollMotion() {
    if (scrollMotionArmed || supportsScrollDrivenAnimations) {
      return;
    }
    scrollMotionArmed = true;
    window.addEventListener("scroll", requestScrollMotionUpdate, { passive: true });
    window.addEventListener("resize", requestScrollMotionUpdate, { passive: true });
    requestScrollMotionUpdate();
  }

  function disarmScrollMotion() {
    if (!scrollMotionArmed) {
      return;
    }
    scrollMotionArmed = false;
    scrollMotionTicking = false;
    window.removeEventListener("scroll", requestScrollMotionUpdate);
    window.removeEventListener("resize", requestScrollMotionUpdate);
    // Clear stale values: CSS already ignores these under reduced motion,
    // but nothing should linger if the property is ever read again.
    progressFill?.style.removeProperty("--scroll-progress");
    document
      .querySelectorAll(".project-media")
      .forEach((mediaFrame) => mediaFrame.style.removeProperty("--parallax-y"));
  }

  // --- Motion: nav compact morph after leaving the hero ---------------
  // Paint-only (background-color / box-shadow / decorative transform):
  // header min-height and padding never change, so this never shifts
  // layout. Runs regardless of reduced motion since it is a state
  // signal, not spatial motion; the reduced-motion stylesheet keeps the
  // wordmark-mark's rotate(12deg) static and transition-free in both
  // states, so toggling is-compact never produces a visible rotation.
  const heroSection = document.getElementById("top");
  const siteHeader = document.getElementById("header");
  if (supportsIntersectionObserver && heroSection && siteHeader) {
    const heroObserver = new IntersectionObserver(
      ([entry]) => {
        siteHeader.classList.toggle("is-compact", !entry.isIntersecting);
      },
      { threshold: 0 }
    );
    heroObserver.observe(heroSection);
  }

  // --- Motion: footer marquee runs only while the footer is in view ---
  // Armed/disarmed reactively, same as scroll motion above.
  const footerMarquee = document.querySelector(".footer-marquee");
  let footerMarqueeObserver = null;
  let footerIntersecting = false;

  function syncFooterMarqueeActive() {
    footerMarquee?.classList.toggle(
      "is-active",
      footerIntersecting && document.visibilityState === "visible"
    );
  }

  function armFooterMarquee() {
    if (!footerMarquee || !supportsIntersectionObserver || footerMarqueeObserver) {
      return;
    }
    footerMarqueeObserver = new IntersectionObserver(
      ([entry]) => {
        footerIntersecting = entry.isIntersecting;
        syncFooterMarqueeActive();
      },
      { threshold: 0 }
    );
    footerMarqueeObserver.observe(footerMarquee);
    document.addEventListener("visibilitychange", syncFooterMarqueeActive);
  }

  function disarmFooterMarquee() {
    footerMarqueeObserver?.disconnect();
    footerMarqueeObserver = null;
    footerIntersecting = false;
    footerMarquee?.classList.remove("is-active");
    document.removeEventListener("visibilitychange", syncFooterMarqueeActive);
  }

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

  // --- Motion: bounded, one-time project-row reveal -------------------
  // Rows are fully visible in the base stylesheet with zero JS
  // dependency; is-priming (added below, only under these guards) is the
  // only thing that ever hides a row, and it always carries a hard
  // timeout fallback so nothing can stay hidden indefinitely. The gate is
  // re-evaluated on every render (not captured once), so a runtime
  // prefers-reduced-motion change takes effect for the next render (e.g.
  // a language toggle) without retroactively hiding already-visible rows.
  function shouldAnimateProjectReveal() {
    return !prefersReducedMotion && supportsIntersectionObserver;
  }

  const projectRevealObserver = supportsIntersectionObserver
    ? new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.remove("is-priming");
              observer.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
      )
    : null;

  function disarmProjectReveal() {
    projectRevealObserver?.disconnect();
    document
      .querySelectorAll(".project-row.is-priming")
      .forEach((row) => row.classList.remove("is-priming"));
  }

  function renderProjects() {
    if (!projects) {
      return;
    }

    projectRevealObserver?.disconnect();
    const animateReveal = shouldAnimateProjectReveal();

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
      article.style.setProperty("--row-index", String(index));
      if (animateReveal) {
        article.classList.add("is-priming");
      }
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

    if (animateReveal) {
      const rows = [...projectsContainer.querySelectorAll(".project-row")];
      rows.forEach((row) => projectRevealObserver.observe(row));
      // Safety net: if the observer never fires for any reason, no row
      // stays hidden longer than this.
      window.setTimeout(() => {
        rows.forEach((row) => {
          if (row.classList.contains("is-priming")) {
            row.classList.remove("is-priming");
            projectRevealObserver.unobserve(row);
          }
        });
      }, 2500);
    }
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

  // --- Motion: live prefers-reduced-motion lifecycle -------------------
  // The preference is re-checked on every render/arm call above (not
  // just captured once at load), so a runtime OS/browser-level toggle
  // arms or disarms scroll motion and the footer marquee immediately,
  // without creating duplicate observers/listeners on repeated toggles
  // (each arm/disarm function guards itself and is idempotent).
  function handleMotionPreferenceChange(event) {
    prefersReducedMotion = event.matches;
    if (prefersReducedMotion) {
      disarmScrollMotion();
      disarmFooterMarquee();
      disarmProjectReveal();
    } else {
      armScrollMotion();
      armFooterMarquee();
    }
  }

  if (typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", handleMotionPreferenceChange);
  } else if (typeof motionQuery.addListener === "function") {
    // Safari < 14 fallback.
    motionQuery.addListener(handleMotionPreferenceChange);
  }

  if (!prefersReducedMotion) {
    armScrollMotion();
    armFooterMarquee();
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
