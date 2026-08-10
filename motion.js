/* The premium motion layer: page loading, depth parallax, magnetic
 * buttons, and cursor presence.
 *
 * These live outside script.js on purpose. script.js owns the site's
 * behaviour — navigation, i18n, the contact controller — and its contents
 * are pinned by quality contracts. Decoration belongs in its own file that
 * can be deleted wholesale without touching a single functional path.
 *
 * Every effect in here is subtractive-safe. Each one is skipped, not
 * degraded, when the visitor asks for reduced motion, when the pointer is
 * coarse, or when the element it decorates is absent. Nothing here moves
 * layout: transforms and opacity only, so no effect can push a control out
 * from under a finger or invalidate a hit target.
 */
(() => {
  "use strict";

  const root = document.documentElement;
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointerQuery = window.matchMedia("(pointer: fine)");
  const prefersMotion = () => !motionQuery.matches;

  // --- Page loading -----------------------------------------------------
  // A determinate-looking top rail rather than a curtain: the content
  // underneath is readable from the first paint, so a slow network costs a
  // visitor nothing but the rail. A hard timeout retires it even if `load`
  // never fires (a hung third-party subresource must not strand the UI).
  function runPageLoadSequence() {
    if (!prefersMotion() || document.readyState === "complete") {
      return;
    }

    const rail = document.createElement("div");
    rail.className = "page-load-rail";
    rail.setAttribute("aria-hidden", "true");
    document.body.prepend(rail);

    let settled = false;
    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(failsafe);
      rail.classList.add("is-complete");
      // Outlives its own fade before leaving the DOM.
      window.setTimeout(() => rail.remove(), 520);
    };

    const failsafe = window.setTimeout(settle, 6000);
    if (document.readyState === "complete") {
      settle();
    } else {
      window.addEventListener("load", settle, { once: true });
    }
  }

  // --- Depth parallax ---------------------------------------------------
  // Drives the --parallax-distance and --depth-* tokens that tokens.css has
  // always declared. Offsets are single-digit pixels: this is depth
  // separation between planes, not scenery sliding past a window.
  function setupParallax() {
    const layers = [
      { element: document.querySelector(".hero-visual"), depth: "--depth-hero-max", factor: -1 },
      ...[...document.querySelectorAll(".featured .card")].map((element, index) => ({
        element,
        depth: "--depth-project-max",
        // The sign alternates per row, not per card. Adjacent cards share a
        // grid row on desktop, so giving neighbours opposite directions
        // pulled a row visibly out of alignment — measured at 17px apart
        // mid-scroll and up to ~56px at the extremes. Pairing the sign keeps
        // each row rigid and still separates successive rows into two planes.
        factor: Math.floor(index / 2) % 2 === 0 ? 1 : -1
      }))
    ].filter((layer) => layer.element);

    if (layers.length === 0) {
      return;
    }

    const styles = getComputedStyle(root);
    const distanceFor = (token, fallback) => {
      const declared = Number.parseFloat(styles.getPropertyValue(token));
      return Number.isFinite(declared) ? declared : fallback;
    };

    layers.forEach((layer) => {
      layer.distance = distanceFor(layer.depth, 5);
    });

    let frame = null;
    let active = false;

    function clear() {
      layers.forEach((layer) => {
        layer.element.style.removeProperty("translate");
      });
    }

    function apply() {
      frame = null;
      const viewportHeight = window.innerHeight || 1;
      layers.forEach((layer) => {
        const rect = layer.element.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > viewportHeight) {
          return;
        }
        // -1..1 across the viewport, 0 when the layer is centred.
        const centre = (rect.top + rect.height / 2 - viewportHeight / 2) / viewportHeight;
        const offset = centre * layer.distance * layer.factor * 2;
        layer.element.style.translate = `0 ${offset.toFixed(2)}px`;
      });
    }

    function request() {
      if (frame === null) {
        frame = window.requestAnimationFrame(apply);
      }
    }

    function arm() {
      if (active || !prefersMotion()) {
        return;
      }
      active = true;
      window.addEventListener("scroll", request, { passive: true });
      window.addEventListener("resize", request, { passive: true });
      request();
    }

    function disarm() {
      if (!active) {
        return;
      }
      active = false;
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      clear();
    }

    onMotionPreferenceChange(() => (prefersMotion() ? arm() : disarm()));
    arm();
  }

  // --- Magnetic buttons -------------------------------------------------
  // The pull is capped well inside the control's own padding, so the
  // pointer is always still inside the element it is pulling. Keyboard
  // users never see it (it is pointer-driven), and it resets on leave,
  // blur, and pointercancel so a control cannot be left displaced.
  const MAGNET_RADIUS = 88;
  const MAGNET_PULL = 0.28;
  const MAGNET_MAX = 7;

  function setupMagnets() {
    const magnets = [...document.querySelectorAll("[data-magnetic]")];
    if (magnets.length === 0) {
      return;
    }

    let active = false;

    function release(element) {
      element.style.removeProperty("translate");
    }

    function handleMove(event) {
      const element = event.currentTarget;
      const rect = element.getBoundingClientRect();
      const deltaX = event.clientX - (rect.left + rect.width / 2);
      const deltaY = event.clientY - (rect.top + rect.height / 2);
      if (Math.hypot(deltaX, deltaY) > MAGNET_RADIUS) {
        release(element);
        return;
      }
      const x = Math.max(-MAGNET_MAX, Math.min(MAGNET_MAX, deltaX * MAGNET_PULL));
      const y = Math.max(-MAGNET_MAX, Math.min(MAGNET_MAX, deltaY * MAGNET_PULL));
      element.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
    }

    function handleLeave(event) {
      release(event.currentTarget);
    }

    function arm() {
      if (active || !prefersMotion() || !finePointerQuery.matches) {
        return;
      }
      active = true;
      magnets.forEach((element) => {
        element.addEventListener("pointermove", handleMove, { passive: true });
        element.addEventListener("pointerleave", handleLeave, { passive: true });
        element.addEventListener("pointercancel", handleLeave, { passive: true });
        element.addEventListener("blur", handleLeave, true);
      });
    }

    function disarm() {
      if (!active) {
        return;
      }
      active = false;
      magnets.forEach((element) => {
        element.removeEventListener("pointermove", handleMove);
        element.removeEventListener("pointerleave", handleLeave);
        element.removeEventListener("pointercancel", handleLeave);
        element.removeEventListener("blur", handleLeave, true);
        release(element);
      });
    }

    onMotionPreferenceChange(() => (prefersMotion() ? arm() : disarm()));
    onPointerChange(() => (finePointerQuery.matches ? arm() : disarm()));
    arm();
  }

  // --- Cursor presence --------------------------------------------------
  // A trailing ring that widens over interactive targets. The native
  // cursor is deliberately never hidden: replacing it would cost hit-target
  // legibility and break high-contrast and forced-colours setups for a
  // decorative gain.
  function setupCursor() {
    if (!finePointerQuery.matches) {
      return;
    }

    const ring = document.createElement("div");
    ring.className = "cursor-ring";
    ring.setAttribute("aria-hidden", "true");
    let attached = false;
    let frame = null;
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;
    let ringX = pointerX;
    let ringY = pointerY;

    const interactiveSelector = "a[href], button, [role='button'], input, select, textarea, summary";

    function render() {
      frame = null;
      ringX += (pointerX - ringX) * 0.18;
      ringY += (pointerY - ringY) * 0.18;
      ring.style.translate = `${ringX.toFixed(1)}px ${ringY.toFixed(1)}px`;
      if (Math.hypot(pointerX - ringX, pointerY - ringY) > 0.4) {
        frame = window.requestAnimationFrame(render);
      }
    }

    function handleMove(event) {
      if (event.pointerType !== "mouse") {
        return;
      }
      pointerX = event.clientX;
      pointerY = event.clientY;
      ring.classList.add("is-visible");
      ring.classList.toggle(
        "is-over-target",
        Boolean(event.target instanceof Element && event.target.closest(interactiveSelector))
      );
      if (frame === null) {
        frame = window.requestAnimationFrame(render);
      }
    }

    function handleOut(event) {
      if (event.relatedTarget === null) {
        ring.classList.remove("is-visible");
      }
    }

    function arm() {
      if (attached || !prefersMotion() || !finePointerQuery.matches) {
        return;
      }
      attached = true;
      document.body.append(ring);
      window.addEventListener("pointermove", handleMove, { passive: true });
      document.addEventListener("pointerout", handleOut, { passive: true });
    }

    function disarm() {
      if (!attached) {
        return;
      }
      attached = false;
      window.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerout", handleOut);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      ring.remove();
    }

    onMotionPreferenceChange(() => (prefersMotion() ? arm() : disarm()));
    onPointerChange(() => (finePointerQuery.matches ? arm() : disarm()));
    arm();
  }

  // --- Shared media-query plumbing --------------------------------------
  function subscribe(query, handler) {
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", handler);
    } else if (typeof query.addListener === "function") {
      // Safari < 14 fallback.
      query.addListener(handler);
    }
  }

  function onMotionPreferenceChange(handler) {
    subscribe(motionQuery, handler);
  }

  function onPointerChange(handler) {
    subscribe(finePointerQuery, handler);
  }

  function start() {
    runPageLoadSequence();
    setupParallax();
    setupMagnets();
    setupCursor();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
