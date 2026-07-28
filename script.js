"use strict";

const CONTACT_EMAIL_ADDRESS = "himiyosh@gmail.com";
const CONTACT_COPY_STATUS_KEYS = Object.freeze({
  success: "contact.copySuccess",
  manualSelected: "contact.copyManualSelected",
  failure: "contact.copyFailure"
});
const PROJECT_SHARE_STATUS_KEYS = Object.freeze({
  shared: "projects.shareSuccess",
  copied: "projects.copySuccess",
  failure: "projects.shareFailure"
});
const PROJECT_RUNTIME_READY_CLASS = "projects-runtime-ready";

async function writeTextToClipboard(value) {
  if (
    window.isSecureContext !== true ||
    typeof window.navigator?.clipboard?.writeText !== "function"
  ) {
    return false;
  }

  await window.navigator.clipboard.writeText(value);
  return true;
}

async function writeContactEmailToClipboard(address) {
  return writeTextToClipboard(address);
}

function createStableProjectShareUrl(hash, stableRouteUrl) {
  if (
    typeof hash !== "string" ||
    !/^#project-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hash)
  ) {
    throw new TypeError("Project share URLs require a stable project fragment.");
  }

  const target = new URL(stableRouteUrl);
  target.search = "";
  target.hash = hash;
  return target.href;
}

function isShareCancellation(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      error.name === "AbortError"
  );
}

async function shareProjectLink({ title, url, share, copyText }) {
  if (typeof share === "function") {
    try {
      await share({ title, url });
      return "shared";
    } catch (error) {
      return isShareCancellation(error) ? "cancelled" : "failed";
    }
  }

  try {
    return (await copyText(url)) ? "copied" : "failed";
  } catch {
    return "failed";
  }
}

function createProjectShareController({
  title,
  button,
  permalink,
  status,
  getUrl,
  share,
  copyText,
  translate,
  schedule
}) {
  let operation = 0;

  function reset() {
    operation += 1;
    button.dataset.shareState = "idle";
    button.removeAttribute("aria-busy");
    status.dataset.state = "idle";
    status.textContent = "";
  }

  function announce(key, state, activeOperation) {
    button.dataset.shareState = state;
    button.removeAttribute("aria-busy");
    status.dataset.state = state;
    status.textContent = "";
    schedule(() => {
      if (activeOperation === operation) {
        status.textContent = translate(key);
      }
    });
  }

  async function activate() {
    const activeOperation = ++operation;
    button.dataset.shareState = "loading";
    button.setAttribute("aria-busy", "true");
    status.dataset.state = "loading";
    status.textContent = "";

    const result = await shareProjectLink({
      title,
      url: getUrl(),
      share,
      copyText
    });
    if (activeOperation !== operation) {
      return;
    }

    if (result === "cancelled") {
      button.dataset.shareState = "idle";
      button.removeAttribute("aria-busy");
      status.dataset.state = "idle";
      return;
    }

    if (result === "shared" || result === "copied") {
      announce(
        result === "shared"
          ? PROJECT_SHARE_STATUS_KEYS.shared
          : PROJECT_SHARE_STATUS_KEYS.copied,
        "success",
        activeOperation
      );
      return;
    }

    permalink.focus({ preventScroll: true });
    announce(PROJECT_SHARE_STATUS_KEYS.failure, "error", activeOperation);
  }

  button.addEventListener("click", activate);
  button.hidden = false;
  status.hidden = false;
  reset();

  return { activate, reset };
}

function selectContactEmailForManualCopy(element, address) {
  if (
    typeof document.createRange !== "function" ||
    typeof window.getSelection !== "function"
  ) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection) {
    return false;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection.toString().trim() === address;
}

function createContactEmailCopyController({
  address,
  button,
  status,
  copyText,
  selectAddress,
  translate,
  schedule
}) {
  let operation = 0;

  function reset() {
    operation += 1;
    button.dataset.copyState = "idle";
    button.removeAttribute("aria-busy");
    status.dataset.state = "idle";
    status.textContent = "";
  }

  function announce(key, state, activeOperation) {
    button.dataset.copyState = state;
    button.removeAttribute("aria-busy");
    status.dataset.state = state;
    status.textContent = "";
    schedule(() => {
      if (activeOperation === operation) {
        status.textContent = translate(key);
      }
    });
  }

  async function copyEmail() {
    const activeOperation = ++operation;
    button.dataset.copyState = "loading";
    button.setAttribute("aria-busy", "true");
    status.dataset.state = "loading";
    status.textContent = "";

    let copied = false;
    try {
      copied = await copyText(address);
    } catch {
      copied = false;
    }

    if (activeOperation !== operation) {
      return;
    }

    if (copied) {
      announce(CONTACT_COPY_STATUS_KEYS.success, "success", activeOperation);
      return;
    }

    let selected = false;
    try {
      selected = selectAddress();
    } catch {
      selected = false;
    }
    announce(
      selected
        ? CONTACT_COPY_STATUS_KEYS.manualSelected
        : CONTACT_COPY_STATUS_KEYS.failure,
      "error",
      activeOperation
    );
  }

  button.addEventListener("click", copyEmail);
  button.hidden = false;
  status.hidden = false;
  reset();

  return { copyEmail, reset };
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.siteI18n.redirecting) {
    return;
  }

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
  const projectsStatus = requireElement("projects-status");
  const projectsDirectory = requireElement("projects-directory");
  const projectsContainer = requireElement("projects-container");
  const projectsFallback = requireElement("projects-fallback");
  const contactEmailLink = requireElement("contact-email-link");
  const contactEmailText = requireElement("contact-email-address");
  const contactCopyButton = requireElement("copy-email-address");
  const contactCopyStatus = requireElement("copy-email-status");
  const mobileNavigation = window.matchMedia("(max-width: 47.999rem)");
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const projectPreviewDesktopMedia = "(min-width: 48rem)";
  const projectPreviewMobileMedia = "(max-width: 47.999rem)";
  const projectSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const reservedProjectSlugs = new Set([
    "top",
    "about",
    "projects",
    "contact",
    "main-content"
  ]);
  let prefersReducedMotion = motionQuery.matches;
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
  let projectShareControllers = [];
  const projectStatusKeys = {
    loading: "projects.loading",
    ready: "projects.ready",
    error: "projects.error"
  };
  const localizedProjectFields = ["title", "description", "kind", "action", "imageAlt"];

  if (
    contactEmailLink.getAttribute("href") !== `mailto:${CONTACT_EMAIL_ADDRESS}` ||
    contactEmailText.textContent.trim() !== CONTACT_EMAIL_ADDRESS
  ) {
    throw new Error("The Contact email link and visible address must match.");
  }

  const contactEmailCopyController = createContactEmailCopyController({
    address: CONTACT_EMAIL_ADDRESS,
    button: contactCopyButton,
    status: contactCopyStatus,
    copyText: writeContactEmailToClipboard,
    selectAddress: () =>
      selectContactEmailForManualCopy(contactEmailText, CONTACT_EMAIL_ADDRESS),
    translate: (key) => window.siteI18n.t(key),
    schedule: (callback) => window.setTimeout(callback, 0)
  });

  function requireNonEmptyString(value, fieldName) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`${fieldName} must be a non-empty string.`);
    }
    return value.trim();
  }

  function projectTargetId(slug) {
    return `project-${slug}`;
  }

  function validateStableSlug(project, index, seenSlugs) {
    const slug = requireNonEmptyString(project.slug, `Project ${index + 1} field "slug"`);
    if (project.slug !== slug || !projectSlugPattern.test(slug)) {
      throw new TypeError(
        `Project ${index + 1} field "slug" must use lowercase kebab-case.`
      );
    }
    if (reservedProjectSlugs.has(slug)) {
      throw new TypeError(`Project ${index + 1} field "slug" is reserved: ${slug}`);
    }
    if (seenSlugs.has(slug)) {
      throw new TypeError(`Duplicate project slug detected: ${slug}`);
    }
    seenSlugs.add(slug);
    return slug;
  }

  function githubRepositoryKey(url) {
    if (
      !url ||
      url.protocol !== "https:" ||
      url.hostname.toLocaleLowerCase("en-US") !== "github.com" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    const pathSegments = url.pathname.split("/").filter(Boolean);
    if (pathSegments.length !== 2) {
      return null;
    }
    const repositoryName = pathSegments[1].replace(/\.git$/i, "");
    if (!pathSegments[0] || !repositoryName) {
      return null;
    }
    return `${pathSegments[0]}/${repositoryName}`.toLocaleLowerCase("en-US");
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
  langToggle.addEventListener("click", (event) => {
    const destination = window.siteI18n.prepareAlternateNavigation();
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    window.location.assign(destination);
  });
  syncNavigationMode();

  // --- Motion: one shared viewport-scene lifecycle -------------------
  // A single passive/rAF-batched listener owns progress, active-scene
  // state, hero depth, project-copy focus, and media depth. CSS scroll
  // timelines can still enhance the progress indicator, but this shared
  // lifecycle remains required for section-wide scene coordination.
  const progressFill = document.querySelector(".scroll-progress-fill");
  const heroSection = document.getElementById("top");
  const heroSticky = document.querySelector(".hero-sticky");
  const rootStyles = window.getComputedStyle(document.documentElement);
  const readPixelToken = (tokenName, fallback) => {
    const value = Number.parseFloat(rootStyles.getPropertyValue(tokenName));
    return Number.isFinite(value) ? value : fallback;
  };
  const parallaxDistance = readPixelToken("--parallax-distance", 5);
  const heroDepthDistance = readPixelToken("--depth-hero-max", 5);
  const projectDepthDistance = readPixelToken("--depth-project-max", 14);
  let scrollMotionFrame = null;
  let scrollMotionArmed = false;
  let projectRows = [];
  let scrollSceneElements = [];
  let activeSceneElement = null;

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function refreshScrollScenes() {
    scrollSceneElements = [
      ...document.querySelectorAll(
        "main > section[data-scene], .project-row[data-scene], .site-footer[data-scene]"
      )
    ];
  }

  function setActiveScene(nextSceneElement) {
    if (!nextSceneElement || nextSceneElement === activeSceneElement) {
      return;
    }

    activeSceneElement?.classList.remove("is-active-scene");
    activeSceneElement = nextSceneElement;
    activeSceneElement.classList.add("is-active-scene");
    document.body.dataset.scene = activeSceneElement.dataset.scene;
  }

  function updateActiveScene(viewportHeight) {
    const documentBottom =
      document.documentElement.scrollHeight - (window.scrollY + viewportHeight);
    if (documentBottom <= 2) {
      setActiveScene(scrollSceneElements.at(-1));
      return;
    }

    const viewportAnchor = viewportHeight * 0.5;
    let nextSceneElement = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    scrollSceneElements.forEach((sceneElement) => {
      const rect = sceneElement.getBoundingClientRect();
      const containsAnchor = rect.top <= viewportAnchor && rect.bottom >= viewportAnchor;
      const distance = containsAnchor
        ? 0
        : Math.min(Math.abs(rect.top - viewportAnchor), Math.abs(rect.bottom - viewportAnchor));

      // Nested project chapters intentionally win ties with their parent
      // projects section because they appear later in DOM order.
      if (distance <= nearestDistance) {
        nearestDistance = distance;
        nextSceneElement = sceneElement;
      }
    });

    setActiveScene(nextSceneElement);
  }

  function updateScrollMotion() {
    scrollMotionFrame = null;
    if (!scrollMotionArmed || prefersReducedMotion) {
      return;
    }

    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollRange > 0 ? Math.min(1, Math.max(0, scrollTop / scrollRange)) : 0;
    progressFill?.style.setProperty("--scroll-progress", progress.toFixed(4));

    const viewportHeight = window.innerHeight;
    const viewportCenter = viewportHeight / 2;
    const sceneMotionEnabled = !mobileNavigation.matches;
    updateActiveScene(viewportHeight);

    if (heroSection && heroSticky) {
      const heroRect = heroSection.getBoundingClientRect();
      const heroTravel = Math.max(1, heroRect.height - viewportHeight);
      const heroProgress = sceneMotionEnabled ? clamp(-heroRect.top / heroTravel) : 0;
      heroSticky.style.setProperty("--hero-opacity", (1 - heroProgress * 0.38).toFixed(4));
      heroSticky.style.setProperty(
        "--hero-depth",
        `${(heroProgress * heroDepthDistance * -1).toFixed(2)}px`
      );
      heroSticky.style.setProperty("--hero-scale", (1 - heroProgress * 0.025).toFixed(4));
    }

    projectRows.forEach((projectRow) => {
      const rect = projectRow.getBoundingClientRect();
      const elementCenter = rect.top + rect.height / 2;
      const offsetRatio = clamp(
        (elementCenter - viewportCenter) / Math.max(1, viewportHeight * 0.75),
        -1,
        1
      );
      const focus = sceneMotionEnabled ? 1 - Math.abs(offsetRatio) : 1;
      const mediaTranslation = clamp(
        offsetRatio * parallaxDistance * -1,
        -parallaxDistance,
        parallaxDistance
      );
      projectRow.style.setProperty("--project-opacity", (0.92 + focus * 0.08).toFixed(4));
      projectRow.style.setProperty(
        "--project-depth",
        `${((1 - focus) * projectDepthDistance).toFixed(2)}px`
      );
      projectRow.style.setProperty("--media-depth", (0.98 + focus * 0.02).toFixed(4));
      projectRow.style.setProperty(
        "--media-translate-y",
        `${(sceneMotionEnabled ? mediaTranslation : 0).toFixed(2)}px`
      );
    });
  }

  function requestScrollMotionUpdate() {
    if (scrollMotionArmed && scrollMotionFrame === null) {
      scrollMotionFrame = window.requestAnimationFrame(updateScrollMotion);
    }
  }

  function armScrollMotion() {
    if (scrollMotionArmed) {
      return;
    }
    scrollMotionArmed = true;
    refreshScrollScenes();
    window.addEventListener("scroll", requestScrollMotionUpdate, { passive: true });
    window.addEventListener("resize", requestScrollMotionUpdate, { passive: true });
    requestScrollMotionUpdate();
  }

  function clearScrollMotionStyles() {
    progressFill?.style.removeProperty("--scroll-progress");
    heroSticky?.style.removeProperty("--hero-opacity");
    heroSticky?.style.removeProperty("--hero-depth");
    heroSticky?.style.removeProperty("--hero-scale");
    projectRows.forEach((projectRow) => {
      projectRow.style.removeProperty("--project-opacity");
      projectRow.style.removeProperty("--project-depth");
      projectRow.style.removeProperty("--media-depth");
      projectRow.style.removeProperty("--media-translate-y");
      projectRow.classList.remove("is-active-scene");
    });
    activeSceneElement?.classList.remove("is-active-scene");
    activeSceneElement = null;
    document.body.removeAttribute("data-scene");
  }

  function disarmScrollMotion() {
    if (scrollMotionArmed) {
      window.removeEventListener("scroll", requestScrollMotionUpdate);
      window.removeEventListener("resize", requestScrollMotionUpdate);
    }
    scrollMotionArmed = false;
    if (scrollMotionFrame !== null) {
      window.cancelAnimationFrame(scrollMotionFrame);
      scrollMotionFrame = null;
    }
    clearScrollMotionStyles();
  }

  // --- Motion: nav compact morph after leaving the hero ---------------
  // Paint-only (background-color / box-shadow / decorative transform):
  // header min-height and padding never change, so this never shifts
  // layout. Runs regardless of reduced motion since it is a state
  // signal, not spatial motion; the reduced-motion stylesheet keeps the
  // wordmark-mark's rotate(12deg) static and transition-free in both
  // states, so toggling is-compact never produces a visible rotation.
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

  function validateLocalProjectAsset(project, index, fieldName, expectedExtension, seenAssets) {
    const assetPath = requireNonEmptyString(
      project[fieldName],
      `Project ${index + 1} field "${fieldName}"`
    );
    const assetUrl = new URL(window.siteI18n.resolveSitePath(assetPath), window.location.href);
    const assetsUrl = new URL(
      window.siteI18n.resolveSitePath("assets/"),
      window.location.href
    );
    if (
      assetUrl.origin !== window.location.origin ||
      !assetUrl.pathname.startsWith(assetsUrl.pathname) ||
      assetUrl.search ||
      assetUrl.hash
    ) {
      throw new TypeError(`Project ${index + 1} field "${fieldName}" must be a local assets path.`);
    }
    if (!assetUrl.pathname.toLocaleLowerCase("en-US").endsWith(expectedExtension)) {
      throw new TypeError(
        `Project ${index + 1} field "${fieldName}" must use ${expectedExtension}.`
      );
    }

    const normalizedAsset = assetUrl.pathname;
    if (seenAssets.has(normalizedAsset)) {
      throw new TypeError(`Duplicate project asset detected: ${assetPath}`);
    }
    seenAssets.add(normalizedAsset);
  }

  function validateProject(
    project,
    index,
    seenSlugs,
    seenLinks,
    seenAssets,
    seenProofTexts
  ) {
    if (!project || typeof project !== "object") {
      throw new TypeError(`Project ${index + 1} must be an object.`);
    }

    validateStableSlug(project, index, seenSlugs);

    for (const fieldName of localizedProjectFields) {
      validateLocalizedField(project, index, fieldName);
    }

    const projectLink = requireNonEmptyString(project.link, `Project ${index + 1} field "link"`);
    const url = new URL(projectLink, window.location.href);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new TypeError(`Project ${index + 1} has an unsupported link protocol.`);
    }
    const normalizedLink = url.toString();
    if (seenLinks.has(normalizedLink)) {
      throw new TypeError(`Duplicate project link detected: ${normalizedLink}`);
    }
    seenLinks.add(normalizedLink);

    const hasSourceAction = Object.hasOwn(project, "sourceAction");
    const hasSourceLink = Object.hasOwn(project, "sourceLink");
    let sourceUrl = null;
    if (hasSourceAction !== hasSourceLink) {
      throw new TypeError(
        `Project ${index + 1} fields "sourceAction" and "sourceLink" must be provided together.`
      );
    }
    if (hasSourceAction) {
      validateLocalizedField(project, index, "sourceAction");
      for (const language of ["ja", "en"]) {
        const primaryAction = project.action[language].trim().toLocaleLowerCase(language);
        const sourceAction = project.sourceAction[language]
          .trim()
          .toLocaleLowerCase(language);
        if (sourceAction === primaryAction) {
          throw new TypeError(
            `Project ${index + 1} field "sourceAction.${language}" must differ from "action.${language}".`
          );
        }
      }

      const sourceLink = requireNonEmptyString(
        project.sourceLink,
        `Project ${index + 1} field "sourceLink"`
      );
      try {
        sourceUrl = new URL(sourceLink);
      } catch {
        throw new TypeError(
          `Project ${index + 1} field "sourceLink" must be an absolute HTTPS URL.`
        );
      }
      if (sourceUrl.protocol !== "https:") {
        throw new TypeError(
          `Project ${index + 1} field "sourceLink" must be an absolute HTTPS URL.`
        );
      }
      const normalizedSourceLink = sourceUrl.toString();
      if (normalizedSourceLink === normalizedLink) {
        throw new TypeError(`Project ${index + 1} source link must differ from its primary link.`);
      }
      if (seenLinks.has(normalizedSourceLink)) {
        throw new TypeError(`Duplicate project link detected: ${normalizedSourceLink}`);
      }
      seenLinks.add(normalizedSourceLink);
    }

    const hasProof = Object.hasOwn(project, "proof");
    const hasProofLink = Object.hasOwn(project, "proofLink");
    if (hasProof !== hasProofLink) {
      throw new TypeError(
        `Project ${index + 1} fields "proof" and "proofLink" must be provided together.`
      );
    }
    if (hasProof) {
      validateLocalizedField(project, index, "proof");
      const comparisonFields = [
        ...localizedProjectFields,
        ...(hasSourceAction ? ["sourceAction"] : [])
      ];
      for (const language of ["ja", "en"]) {
        const proofText = project.proof[language].trim();
        const normalizedProofText = proofText.toLocaleLowerCase(language);
        const duplicateField = comparisonFields.find(
          (fieldName) =>
            project[fieldName][language].trim().toLocaleLowerCase(language) ===
            normalizedProofText
        );
        const duplicatesStack =
          Array.isArray(project.stack) &&
          project.stack.some(
            (stackItem) =>
              typeof stackItem === "string" &&
              stackItem.trim().toLocaleLowerCase(language) === normalizedProofText
          );
        if (duplicateField || duplicatesStack) {
          throw new TypeError(
            `Project ${index + 1} field "proof.${language}" must add information beyond existing card copy.`
          );
        }

        const proofTextKey = `${language}:${normalizedProofText}`;
        if (seenProofTexts.has(proofTextKey)) {
          throw new TypeError(`Duplicate project proof text detected for language "${language}".`);
        }
        seenProofTexts.add(proofTextKey);
      }

      const proofLink = requireNonEmptyString(
        project.proofLink,
        `Project ${index + 1} field "proofLink"`
      );
      let proofUrl;
      try {
        proofUrl = new URL(proofLink);
      } catch {
        throw new TypeError(
          `Project ${index + 1} field "proofLink" must be an immutable GitHub blob HTTPS URL with a line anchor.`
        );
      }

      const blobMatch = proofUrl.pathname.match(
        /^\/([^/]+)\/([^/]+)\/blob\/([0-9a-f]{40})\/.+$/i
      );
      const lineMatch = proofUrl.hash.match(/^#L(\d+)(?:-L(\d+))?$/);
      if (
        proofUrl.protocol !== "https:" ||
        proofUrl.hostname.toLocaleLowerCase("en-US") !== "github.com" ||
        proofUrl.username ||
        proofUrl.password ||
        proofUrl.port ||
        proofUrl.search ||
        !blobMatch ||
        !lineMatch
      ) {
        throw new TypeError(
          `Project ${index + 1} field "proofLink" must be an immutable GitHub blob HTTPS URL with a line anchor.`
        );
      }
      if (lineMatch[2] && Number(lineMatch[2]) < Number(lineMatch[1])) {
        throw new TypeError(`Project ${index + 1} field "proofLink" has an invalid line range.`);
      }

      const proofRepositoryKey = `${blobMatch[1]}/${blobMatch[2].replace(/\.git$/i, "")}`
        .toLocaleLowerCase("en-US");
      const publicRepositoryKeys = new Set(
        [githubRepositoryKey(url), githubRepositoryKey(sourceUrl)].filter(Boolean)
      );
      if (!publicRepositoryKeys.has(proofRepositoryKey)) {
        throw new TypeError(
          `Project ${index + 1} field "proofLink" must match an existing public GitHub repository action.`
        );
      }

      const normalizedProofLink = proofUrl.toString();
      if (seenLinks.has(normalizedProofLink)) {
        throw new TypeError(`Duplicate project proof link detected: ${normalizedProofLink}`);
      }
      seenLinks.add(normalizedProofLink);
    }

    validateLocalProjectAsset(project, index, "image", ".jpg", seenAssets);
    validateLocalProjectAsset(project, index, "desktopImageAvif", ".avif", seenAssets);
    validateLocalProjectAsset(project, index, "mobileImageAvif", ".avif", seenAssets);

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

  function createProjectAction(action, href, variant) {
    const link = document.createElement("a");
    const linkText = document.createElement("span");
    const linkAnnouncement = document.createElement("span");
    const linkArrow = document.createElement("span");

    link.className = `project-link project-link--${variant}`;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    linkText.textContent = localizedValue(action);
    linkAnnouncement.className = "sr-only";
    linkAnnouncement.textContent = window.siteI18n.t("accessibility.opensInNewTab");
    linkArrow.className = "project-link-arrow";
    linkArrow.setAttribute("aria-hidden", "true");
    linkArrow.textContent = "\u2197";
    link.append(linkText, linkAnnouncement, linkArrow);

    return link;
  }

  // --- Motion: bounded, one-time project-row reveal -------------------
  // Rows are fully visible in the base stylesheet with zero JS
  // dependency. is-priming supplies the existing bounded transform cue;
  // modern.css keeps project text fully opaque, and a hard timeout clears
  // any stale priming state. The gate is re-evaluated on every render (not
  // captured once), so a runtime prefers-reduced-motion change takes
  // effect for the next render (e.g. a language toggle).
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

  function projectFragmentTarget(hash) {
    if (typeof hash !== "string" || !hash.startsWith("#")) {
      return null;
    }

    let targetId;
    try {
      targetId = decodeURIComponent(hash.slice(1));
    } catch {
      return null;
    }
    if (!/^project-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(targetId)) {
      return null;
    }

    const target = document.getElementById(targetId);
    if (!target) {
      return null;
    }

    const isEnhancedTarget =
      projectsContainer.contains(target) && target.classList.contains("project-row");
    const isVisibleFallbackTarget =
      projectsFallback.classList.contains("is-visible") &&
      projectsFallback.contains(target) &&
      target.classList.contains("projects-fallback-card");
    return isEnhancedTarget || isVisibleFallbackTarget ? target : null;
  }

  function focusProjectFragment(hash = window.location.hash) {
    const target = projectFragmentTarget(hash);
    if (!target) {
      return false;
    }

    if (target.classList.contains("project-row")) {
      target.classList.remove("is-priming");
      projectRevealObserver?.unobserve(target);
    }
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start"
    });
    return true;
  }

  let pendingProjectFragmentHash = null;
  let projectFragmentFocusQueued = false;

  function scheduleProjectFragmentFocus(hash = window.location.hash) {
    pendingProjectFragmentHash = hash;
    if (projectFragmentFocusQueued) {
      return;
    }

    projectFragmentFocusQueued = true;
    queueMicrotask(() => {
      const scheduledHash = pendingProjectFragmentHash;
      pendingProjectFragmentHash = null;
      projectFragmentFocusQueued = false;
      focusProjectFragment(scheduledHash);
    });
  }

  function handleProjectPermalinkClick(event) {
    const permalink = event.target?.closest?.(
      "a.project-permalink, a.project-directory-link, a.projects-fallback-permalink"
    );
    if (
      !permalink ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const hash = permalink.getAttribute("href");
    if (!hash || !projectFragmentTarget(hash)) {
      return;
    }

    event.preventDefault();
    if (window.location.hash !== hash) {
      window.history.pushState(window.history.state, "", hash);
    }
    window.siteI18n.rememberInHistory();
    scheduleProjectFragmentFocus(hash);
  }

  function handleProjectHashChange() {
    window.siteI18n.rememberInHistory();
    scheduleProjectFragmentFocus();
  }

  function handleProjectHistoryChange(event) {
    if (!window.siteI18n.syncFromHistory(event.state)) {
      scheduleProjectFragmentFocus();
    }
  }

  function updateProjectStatus(state) {
    const translationKey = projectStatusKeys[state];
    if (!translationKey) {
      throw new RangeError(`Unsupported project state: ${state}`);
    }

    const isReady = state === "ready";
    const isError = state === "error";
    const translatedStatus = window.siteI18n.t(translationKey);
    const statusMessage = isReady
      ? translatedStatus.replace("{count}", String(projects.length))
      : translatedStatus;

    projectState = state;
    projectsContainer.setAttribute("aria-busy", String(state === "loading"));
    projectsContainer.classList.toggle("projects-list", isReady);
    projectsStatus.classList.toggle("projects-list", !isReady);
    projectsStatus.classList.toggle("sr-only", isReady);
    projectsStatus.hidden = false;
    projectsFallback.classList.toggle("is-visible", isError);
    projectsFallback.setAttribute("aria-hidden", String(!isError));
    projectsStatus.dataset.i18n = translationKey;

    if (projectsStatus.textContent !== statusMessage) {
      projectsStatus.textContent = statusMessage;
    }
  }

  function clearProjectDirectory() {
    projectsDirectory.hidden = true;
    projectsDirectory.replaceChildren();
  }

  function resetProjectShareControllers({ discard = false } = {}) {
    projectShareControllers.forEach((controller) => controller.reset());
    if (discard) {
      projectShareControllers = [];
    }
  }

  function renderProjectDirectory() {
    if (!projects) {
      throw new Error("Project directory cannot render before project data is loaded.");
    }

    const list = document.createElement("ul");
    list.className = "project-directory-list";
    projects.forEach((project) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      const title = document.createElement("span");
      const kind = document.createElement("span");

      link.className = "project-directory-link";
      link.setAttribute("href", `#${projectTargetId(project.slug)}`);
      title.className = "project-directory-title";
      title.textContent = localizedValue(project.title);
      kind.className = "project-directory-kind";
      kind.textContent = localizedValue(project.kind);
      link.append(title, kind);
      item.append(link);
      list.append(item);
    });

    projectsDirectory.setAttribute(
      "aria-label",
      window.siteI18n.t("projects.directoryLabel")
    );
    projectsDirectory.replaceChildren(list);
    projectsDirectory.hidden = false;
  }

  function renderProjects() {
    if (!projects) {
      return;
    }

    resetProjectShareControllers({ discard: true });
    projectRevealObserver?.disconnect();
    const animateReveal = shouldAnimateProjectReveal();

    const fragment = document.createDocumentFragment();
    projects.forEach((project, index) => {
      const article = document.createElement("article");
      const media = document.createElement("div");
      const picture = document.createElement("picture");
      const desktopSource = document.createElement("source");
      const mobileSource = document.createElement("source");
      const image = document.createElement("img");
      const content = document.createElement("div");
      const headingGroup = document.createElement("div");
      const headingLine = document.createElement("div");
      const headingActions = document.createElement("div");
      const title = document.createElement("h3");
      const permalink = document.createElement("a");
      const shareButton = document.createElement("button");
      const shareStatus = document.createElement("p");
      const kind = document.createElement("p");
      const details = document.createElement("div");
      const description = document.createElement("p");
      const actions = document.createElement("div");

      article.className = "project-row";
      article.id = projectTargetId(project.slug);
      article.tabIndex = -1;
      article.dataset.scene = `project-${index + 1}`;
      article.style.setProperty("--row-index", String(index));
      if (animateReveal) {
        article.classList.add("is-priming");
      }
      media.className = "project-media";
      desktopSource.type = "image/avif";
      desktopSource.media = projectPreviewDesktopMedia;
      desktopSource.srcset = `${window.siteI18n.resolveSitePath(project.desktopImageAvif)} 960w`;
      desktopSource.sizes = "60vw";
      mobileSource.type = "image/avif";
      mobileSource.media = projectPreviewMobileMedia;
      mobileSource.srcset = `${window.siteI18n.resolveSitePath(project.mobileImageAvif)} 720w`;
      mobileSource.sizes = "100vw";
      image.alt = localizedValue(project.imageAlt);
      image.width = 960;
      image.height = 540;
      image.loading = "lazy";
      image.decoding = "async";
      picture.append(desktopSource, mobileSource, image);
      media.append(picture);
      image.src = window.siteI18n.resolveSitePath(project.image);
      content.className = "project-content";
      headingGroup.className = "project-heading";
      headingLine.className = "project-heading-line";
      headingActions.className = "project-heading-actions";
      const localizedTitle = localizedValue(project.title);
      title.id = `${article.id}-title`;
      title.textContent = localizedTitle;
      permalink.className = "project-permalink";
      permalink.setAttribute("href", `#${article.id}`);
      permalink.setAttribute(
        "aria-label",
        window.siteI18n.t("projects.permalinkLabel").replace("{title}", localizedTitle)
      );
      permalink.textContent = window.siteI18n.t("projects.permalinkAction");
      shareButton.className = "project-share-button";
      shareButton.type = "button";
      shareButton.hidden = true;
      shareButton.setAttribute(
        "aria-label",
        window.siteI18n.t("projects.shareLabel").replace("{title}", localizedTitle)
      );
      shareButton.textContent = window.siteI18n.t("projects.shareAction");
      shareStatus.id = `${article.id}-share-status`;
      shareStatus.className = "project-share-status";
      shareStatus.setAttribute("role", "status");
      shareStatus.setAttribute("aria-live", "polite");
      shareStatus.setAttribute("aria-atomic", "true");
      shareStatus.hidden = true;
      shareButton.setAttribute("aria-describedby", shareStatus.id);
      kind.className = "project-kind";
      kind.textContent = localizedValue(project.kind);
      description.className = "project-description";
      description.textContent = localizedValue(project.description);

      headingActions.append(permalink, shareButton);
      headingLine.append(title, headingActions);
      headingGroup.append(headingLine, shareStatus, kind);
      details.append(description);

      projectShareControllers.push(
        createProjectShareController({
          title: localizedTitle,
          button: shareButton,
          permalink,
          status: shareStatus,
          getUrl: () =>
            createStableProjectShareUrl(
              permalink.getAttribute("href"),
              window.siteI18n.stableUrl(window.siteI18n.language)
            ),
          share:
            typeof window.navigator?.share === "function"
              ? window.navigator.share.bind(window.navigator)
              : null,
          copyText: writeTextToClipboard,
          translate: (key) => window.siteI18n.t(key),
          schedule: (callback) => window.setTimeout(callback, 0)
        })
      );

      if (project.stack?.length) {
        const stack = document.createElement("p");
        stack.className = "project-stack";
        stack.textContent = project.stack.join(" · ");
        details.append(stack);
      }

      actions.className = "project-actions";
      actions.setAttribute("role", "group");
      actions.setAttribute("aria-labelledby", title.id);
      const primaryLink = createProjectAction(project.action, project.link, "primary");
      actions.append(primaryLink);
      if (Object.hasOwn(project, "sourceAction")) {
        const sourceLink = createProjectAction(
          project.sourceAction,
          project.sourceLink,
          "secondary"
        );
        actions.append(sourceLink);
      }

      content.append(headingGroup, details, actions);
      if (Object.hasOwn(project, "proof")) {
        const proof = document.createElement("div");
        const proofText = document.createElement("p");
        const proofLabel = document.createElement("span");
        const proofStatement = document.createElement("span");
        const proofLink = createProjectAction(
          window.siteI18n.t("projects.proofAction"),
          project.proofLink,
          "evidence"
        );

        proof.className = "project-proof";
        proofText.className = "project-proof-text";
        proofLabel.className = "project-proof-label";
        proofLabel.textContent = window.siteI18n.t("projects.proofLabel");
        proofStatement.textContent = localizedValue(project.proof);
        proofText.append(proofLabel, proofStatement);
        proof.append(proofText, proofLink);
        content.append(proof);
      }
      article.append(media, content);
      fragment.append(article);
    });

    projectsFallback.replaceChildren();
    projectsContainer.replaceChildren(fragment);
    renderProjectDirectory();
    projectRows = [...projectsContainer.querySelectorAll(".project-row")];
    refreshScrollScenes();
    requestScrollMotionUpdate();
    updateProjectStatus("ready");

    if (animateReveal) {
      const rows = [...projectsContainer.querySelectorAll(".project-row")];
      rows.forEach((row) => projectRevealObserver.observe(row));
      // Safety net: if the observer never fires, clear every stale
      // priming state after the bounded entrance window.
      window.setTimeout(() => {
        rows.forEach((row) => {
          if (row.classList.contains("is-priming")) {
            row.classList.remove("is-priming");
            projectRevealObserver.unobserve(row);
          }
        });
      }, 2500);
    }

    scheduleProjectFragmentFocus();
  }

  function renderProjectLoading() {
    resetProjectShareControllers({ discard: true });
    clearProjectDirectory();
    projectsContainer.replaceChildren();
    updateProjectStatus("loading");
    document.documentElement.classList.add(PROJECT_RUNTIME_READY_CLASS);
  }

  function renderProjectError() {
    resetProjectShareControllers({ discard: true });
    clearProjectDirectory();
    const wrapper = document.createElement("div");
    const retry = document.createElement("button");

    retry.className = "retry-button";
    retry.type = "button";
    retry.setAttribute("aria-describedby", "projects-status");
    retry.textContent = window.siteI18n.t("projects.retry");
    retry.addEventListener("click", loadProjects);
    wrapper.append(retry);
    projectsContainer.replaceChildren(wrapper);
    updateProjectStatus("error");
    scheduleProjectFragmentFocus();
  }

  async function loadProjects() {
    projectState = "loading";
    renderProjectLoading();

    try {
      const response = await fetch(window.siteI18n.resolveSitePath("projects.json"), {
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
      const seenSlugs = new Set();
      const seenAssets = new Set();
      const seenProofTexts = new Set();
      data.forEach((project, index) =>
        validateProject(
          project,
          index,
          seenSlugs,
          seenLinks,
          seenAssets,
          seenProofTexts
        )
      );
      projects = data;
      renderProjects();
    } catch (error) {
      console.error("Unable to load projects:", error);
      renderProjectError();
    }
  }

  document.addEventListener("site-languagechange", () => {
    contactEmailCopyController.reset();
    updateNavigationLabel();
    if (projectState === "ready") {
      renderProjects();
    } else if (projectState === "error") {
      renderProjectError();
    } else {
      renderProjectLoading();
    }
  });
  projectsDirectory.addEventListener("click", handleProjectPermalinkClick);
  projectsFallback.addEventListener("click", handleProjectPermalinkClick);
  projectsContainer.addEventListener("click", handleProjectPermalinkClick);
  window.addEventListener("hashchange", handleProjectHashChange);
  window.addEventListener("popstate", handleProjectHistoryChange);
  window.addEventListener("pageshow", contactEmailCopyController.reset);
  window.addEventListener("pageshow", () => resetProjectShareControllers());
  window.addEventListener("pageshow", () => scheduleProjectFragmentFocus());

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
  // arms or disarms the shared scene lifecycle immediately, without
  // creating duplicate listeners on repeated toggles.
  function handleMotionPreferenceChange(event) {
    prefersReducedMotion = event.matches;
    if (prefersReducedMotion) {
      disarmScrollMotion();
      disarmProjectReveal();
    } else {
      armScrollMotion();
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
