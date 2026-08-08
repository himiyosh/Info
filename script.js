"use strict";

const CONTACT_EMAIL_ADDRESS = "himiyosh@gmail.com";
const CONTACT_COPY_STATUS_KEYS = Object.freeze({
  success: "contact.copySuccess",
  manualSelected: "contact.copyManualSelected",
  failure: "contact.copyFailure"
});
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
  const contactEmailLink = requireElement("contact-email-link");
  const contactEmailText = requireElement("contact-email-address");
  const contactCopyButton = requireElement("copy-email-address");
  const contactCopyStatus = requireElement("copy-email-status");
  const mobileNavigation = window.matchMedia("(max-width: 47.999rem)");
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
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

  // --- Theme: 夜藍 ⇄ 白妙 selection lifecycle (3s hold wakes 暁) --------
  // The inline head script has already applied any stored choice before
  // first paint; with no stored choice the OS scheme drives the palette
  // through CSS alone, so this block only manages the control state,
  // persistence, the theme-color meta, and announcements.
  const THEME_STORAGE_KEY = "info-theme";
  const THEME_COLORS = Object.freeze({
    yoruai: "#06101c",
    shirotae: "#f4f2e9",
    akatsuki: "#160d1d"
  });
  const themeToggle = requireElement("theme-toggle");
  const themeStatus = requireElement("theme-status");
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  const lightSchemeQuery = window.matchMedia("(prefers-color-scheme: light)");
  let themeStatusTimer = null;
  let themeHoldTimer = null;
  let themeEggFiredAt = 0;
  let themeEggPending = false;

  function storedTheme() {
    try {
      const value = window.localStorage.getItem(THEME_STORAGE_KEY);
      return Object.hasOwn(THEME_COLORS, value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function persistTheme(theme) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.warn("Theme preference could not be saved:", error);
    }
  }

  function effectiveTheme() {
    return (
      document.documentElement.dataset.theme ||
      (lightSchemeQuery.matches ? "shirotae" : "yoruai")
    );
  }

  // Always sync from the explicit target theme: startViewTransition runs
  // its update callback asynchronously, so reading the DOM right after
  // setTheme() would still observe the previous data-theme value.
  function syncThemeControl(theme = effectiveTheme()) {
    const labelKey = theme === "yoruai" ? "theme.toLight" : "theme.toDark";
    themeToggle.setAttribute("data-i18n-aria-label", labelKey);
    themeToggle.setAttribute("aria-label", window.siteI18n.t(labelKey));
    themeToggle.setAttribute(
      "aria-pressed",
      theme === "akatsuki" ? "mixed" : String(theme === "shirotae")
    );
    themeColorMeta?.setAttribute("content", THEME_COLORS[theme]);
  }

  function withThemeTransition(applyChange) {
    if (!prefersReducedMotion && typeof document.startViewTransition === "function") {
      // Rapid re-toggles abort the in-flight crossfade; the rejected
      // promises are expected there and must not surface as console noise.
      const transition = document.startViewTransition(applyChange);
      transition.ready?.catch?.(() => {});
      transition.finished?.catch?.(() => {});
    } else {
      applyChange();
    }
  }

  // Clear then set on a later task, matching the contact/share status
  // regions: a live region that keeps the same text between announcements
  // is not guaranteed to be re-read, and one that is toggled `hidden` can
  // be dropped from the accessibility tree before it is announced at all.
  function announceTheme(message) {
    window.clearTimeout(themeStatusTimer);
    themeStatus.textContent = "";
    themeStatus.classList.add("theme-status-on");
    window.setTimeout(() => {
      themeStatus.textContent = message;
    }, 0);
    themeStatusTimer = window.setTimeout(() => {
      themeStatus.classList.remove("theme-status-on");
      themeStatus.textContent = "";
    }, 2400);
  }

  function setTheme(theme, { announceKey = null } = {}) {
    withThemeTransition(() => {
      document.documentElement.dataset.theme = theme;
    });
    persistTheme(theme);
    syncThemeControl(theme);
    if (announceKey) {
      announceTheme(window.siteI18n.t(announceKey));
    }
  }

  themeToggle.hidden = false;
  themeStatus.hidden = false;
  themeToggle.addEventListener("click", () => {
    // Swallow only the click synthesized by the long-press that just woke
    // 暁; a time window (not a flag) keeps later keyboard clicks working.
    if (Date.now() - themeEggFiredAt < 800) {
      return;
    }
    setTheme(effectiveTheme() === "yoruai" ? "shirotae" : "yoruai");
  });
  themeToggle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    themeToggle.classList.add("theme-toggle-charging");
    window.clearTimeout(themeHoldTimer);
    themeHoldTimer = window.setTimeout(() => {
      themeEggPending = true;
      themeToggle.classList.remove("theme-toggle-charging");
      setTheme("akatsuki", { announceKey: "theme.akatsukiUnlocked" });
    }, 3000);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((type) =>
    themeToggle.addEventListener(type, () => {
      // The suppression window has to start when the pointer is released,
      // not when the egg fires: the charge animation ends exactly at the
      // unlock, so a hold that runs a little long would otherwise let the
      // trailing click through and immediately undo the theme it just
      // revealed — persisting that undo and dropping OS-scheme following.
      if (themeEggPending) {
        themeEggPending = false;
        themeEggFiredAt = Date.now();
      }
      window.clearTimeout(themeHoldTimer);
      themeToggle.classList.remove("theme-toggle-charging");
    })
  );
  themeToggle.addEventListener("contextmenu", (event) => event.preventDefault());

  function handleSchemeChange() {
    if (!storedTheme()) {
      syncThemeControl();
    }
  }

  if (typeof lightSchemeQuery.addEventListener === "function") {
    lightSchemeQuery.addEventListener("change", handleSchemeChange);
  } else if (typeof lightSchemeQuery.addListener === "function") {
    // Safari < 14 fallback.
    lightSchemeQuery.addListener(handleSchemeChange);
  }

  syncThemeControl();

  // --- Motion: one-time heading decode reveal ---------------------------
  // Scrambles [data-decode] headings once as they enter the viewport and
  // always lands on the exact translated text. A language change cancels
  // in-flight runs so a stale frame can never overwrite the fresh copy
  // written by i18n.js before site-languagechange is dispatched.
  const DECODE_POOL = "アイウエオカキクケコサシスセソ〇一二三四五六七八九◆※+<>/";
  // Latin characters scramble within same-case Latin pools so English
  // headings keep their line count (no layout shift) while decoding.
  const DECODE_POOL_UPPER = "ABCDEFGHKMNPRSTUVXYZ2345789#*+<>/";
  const DECODE_POOL_LOWER = "abcdefghkmnoprstuvxyz2345789*+</";
  const decodeTargets = [...document.querySelectorAll("[data-decode]")];
  const activeDecodes = new Map();
  const printMediaQuery = window.matchMedia("print");

  function cancelActiveDecodes() {
    // Language change: i18n.js has already written the fresh copy, so the
    // in-flight runs are abandoned without touching the text again.
    activeDecodes.forEach((token) => {
      token.cancelled = true;
      window.clearTimeout(token.backstopTimer);
    });
    activeDecodes.clear();
  }

  function finalizeActiveDecodes() {
    // Print: land every in-flight run on its exact final text right away.
    activeDecodes.forEach((token, element) => {
      token.cancelled = true;
      window.clearTimeout(token.backstopTimer);
      element.textContent = token.target;
    });
    activeDecodes.clear();
  }

  function runDecode(element) {
    const target = element.textContent;
    const characters = [...target];
    const token = { cancelled: false, backstopTimer: null, target };
    activeDecodes.set(element, token);
    let frame = 0;
    const totalFrames = characters.length * 3 + 12;

    function finish() {
      window.clearTimeout(token.backstopTimer);
      element.textContent = target;
      activeDecodes.delete(element);
    }

    // Frames can stall mid-run (throttled background tabs, print
    // rendering), so a timer independently lands the exact final text
    // once the intended duration has passed.
    token.backstopTimer = window.setTimeout(() => {
      if (!token.cancelled) {
        token.cancelled = true;
        element.textContent = target;
        activeDecodes.delete(element);
      }
    }, totalFrames * 17 + 100);

    function step() {
      if (token.cancelled) {
        return;
      }
      frame += 1;
      if (frame >= totalFrames) {
        finish();
        return;
      }
      element.textContent = characters
        .map((character, index) => {
          if (character === " " || frame > index * 3 + 10) {
            return character;
          }
          const pool =
            character.charCodeAt(0) >= 0x2e80
              ? DECODE_POOL
              : /[a-z]/.test(character)
                ? DECODE_POOL_LOWER
                : DECODE_POOL_UPPER;
          return pool[Math.floor(Math.random() * pool.length)];
        })
        .join("");
      window.requestAnimationFrame(step);
    }

    window.requestAnimationFrame(step);
  }

  if (supportsIntersectionObserver && decodeTargets.length > 0) {
    const decodeObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }
          decodeObserver.unobserve(entry.target);
          if (!prefersReducedMotion && !printMediaQuery.matches) {
            runDecode(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    decodeTargets.forEach((element) => decodeObserver.observe(element));
    window.addEventListener("beforeprint", finalizeActiveDecodes);
    if (typeof printMediaQuery.addEventListener === "function") {
      printMediaQuery.addEventListener("change", (event) => {
        if (event.matches) {
          finalizeActiveDecodes();
        }
      });
    }
  }

  // --- Motion: bounded, one-time section reveal ------------------------
  // The prototype's .reveal treatment, hardened for production: the
  // resting state is fully visible; priming only happens when JS is
  // running, motion is allowed, and IntersectionObserver exists; and a
  // timeout backstop clears priming even if an observer never fires, so
  // content can never be left invisible.
  const revealTargets = [
    ...document.querySelectorAll(
      ".card, .panel, .tool-group, .about-grid > *, .section-head, .hero-visual, .contact-panel > *"
    )
  ];
  let revealObserver = null;
  let revealBackstopTimer = null;

  function shouldAnimateReveal() {
    return !prefersReducedMotion && supportsIntersectionObserver;
  }

  function disarmReveal() {
    revealObserver?.disconnect();
    revealObserver = null;
    window.clearTimeout(revealBackstopTimer);
    revealBackstopTimer = null;
    revealTargets.forEach((element) => {
      element.classList.remove("is-priming");
    });
  }

  function armReveal() {
    if (!shouldAnimateReveal() || revealObserver !== null) {
      return;
    }
    revealTargets.forEach((element) => {
      element.classList.add("is-priming");
    });
    revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }
          entry.target.classList.remove("is-priming");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.14 }
    );
    revealTargets.forEach((element) => revealObserver.observe(element));
    revealBackstopTimer = window.setTimeout(disarmReveal, 2500);
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
  // The preference is re-checked live, so a runtime OS/browser toggle
  // arms or disarms the reveal immediately without duplicate listeners.
  function handleMotionPreferenceChange(event) {
    prefersReducedMotion = event.matches;
    if (prefersReducedMotion) {
      disarmReveal();
    } else {
      armReveal();
    }
  }

  if (typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", handleMotionPreferenceChange);
  } else if (typeof motionQuery.addListener === "function") {
    // Safari < 14 fallback.
    motionQuery.addListener(handleMotionPreferenceChange);
  }

  if (!prefersReducedMotion) {
    armReveal();
  }

  document.addEventListener("site-languagechange", () => {
    contactEmailCopyController.reset();
    cancelActiveDecodes();
    updateNavigationLabel();
  });
  window.addEventListener("pageshow", contactEmailCopyController.reset);

  requireElement("current-year").textContent = String(new Date().getFullYear());

  // --- Footer: live Japan Standard Time -------------------------------
  // The template ships a static placeholder so the printed and
  // no-JavaScript footers still read as a clock rather than an empty line.
  // Teardown rides pagehide: the shared scene lifecycle deliberately owns
  // no page-visibility listener, and a contract keeps it that way.
  const footerClock = requireElement("footer-clock");
  const jstFormatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  let footerClockTimer = null;

  function renderFooterClock() {
    footerClock.textContent = `${jstFormatter.format(new Date())} JST`;
  }

  renderFooterClock();
  footerClockTimer = window.setInterval(renderFooterClock, 1000);
  window.addEventListener("pagehide", () => {
    window.clearInterval(footerClockTimer);
    footerClockTimer = null;
  });
  window.addEventListener("pageshow", () => {
    if (footerClockTimer === null) {
      renderFooterClock();
      footerClockTimer = window.setInterval(renderFooterClock, 1000);
    }
  });

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
