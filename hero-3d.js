/* 稜線 — Ridgeline: the hero's cinematic 3D centerpiece.
 *
 * A procedural mountain ridge drawn as a topographic wireframe in raw
 * WebGL. It extends the site's existing motifs (the drifting topo lines
 * behind the hero, the mountain wordmark, the Yosemite valley photo) into
 * depth rather than importing a generic 3D object.
 *
 * Dependency-free on purpose: a 3D library would ship more bytes than the
 * whole current site for one hero scene, which the performance contract in
 * PRODUCT.md does not accept. Everything here is one file, no build step.
 *
 * Progressive enhancement, in strict order:
 *   no JS            -> markup never shows the canvas (.hero-3d-ready gate)
 *   no WebGL         -> canvas is torn down, the photo hero stands alone
 *   reduced motion   -> exactly one static frame, no rAF loop, no input
 *   coarse pointer   -> animation without mouse parallax, lighter grid
 *   hero off-screen  -> loop parked, GPU idle
 */
(() => {
  "use strict";

  /* The scene is the most expensive thing on the page to bootstrap:
   * compiling two programs and uploading the grid can occupy the main
   * thread for longer than the hero entrance takes to play. Holding it
   * until after `load`, then until the browser is idle, keeps the text
   * entrance and the LCP image on an uncontested thread. The canvas fades
   * in when it arrives, so a late start reads as intent, not as a stall. */
  function initialiseRidgeline() {
    const canvas = document.querySelector("[data-hero-canvas]");
    const hero = document.querySelector(".hero");
    if (!canvas || !hero) {
      return;
    }

    const root = document.documentElement;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointerQuery = window.matchMedia("(pointer: coarse)");

    // --- Scene constants --------------------------------------------------
    // Depth range is deliberately long and the near edge deliberately flat:
    // the composition reads as a valley floor opening onto a distant range,
    // which is the same story the hero photograph tells.
    const NEAR_Z = 3.5;
    const FAR_Z = -34;
    const HALF_WIDTH = 16;
    // The camera sits low and pitches slightly up, which drops the range into
    // the lower third of the frame and leaves the headline column clear.
    const CAMERA = { x: 0, y: 1.5, z: 5.2 };
    const TARGET = { x: 0, y: 4.05, z: -9 };
    const FOV = 52;
    const ENTRANCE_MS = 1900;
    const MAX_DPR = 2;

    function gridResolution() {
      // Responsive 3D complexity: the same scene, fewer samples, so a phone
      // spends roughly a quarter of the vertex work a desktop does.
      const memory = navigator.deviceMemory;
      const lowMemory = typeof memory === "number" && memory <= 4;
      if (coarsePointerQuery.matches || lowMemory || window.innerWidth < 768) {
        return { columns: 96, rows: 54 };
      }
      if (window.innerWidth < 1280) {
        return { columns: 144, rows: 78 };
      }
      return { columns: 196, rows: 104 };
    }

    // --- Colour bridge ----------------------------------------------------
    // Themes are defined in oklch(). Rather than parse a colour space by
    // hand, let the browser resolve any CSS colour to sRGB bytes through a
    // 1x1 2D canvas. This keeps the scene correct for 夜藍 / 白妙 / 暁 and for
    // the OS scheme, with no palette duplicated into JS.
    const swatch = document.createElement("canvas");
    swatch.width = 1;
    swatch.height = 1;
    const swatchContext = swatch.getContext("2d", { willReadFrequently: true });

    function readColor(customProperty, fallback) {
      const declared = getComputedStyle(root).getPropertyValue(customProperty).trim();
      if (!swatchContext || declared === "") {
        return fallback;
      }
      try {
        swatchContext.clearRect(0, 0, 1, 1);
        swatchContext.fillStyle = "#000";
        swatchContext.fillStyle = declared;
        swatchContext.fillRect(0, 0, 1, 1);
        const [r, g, b] = swatchContext.getImageData(0, 0, 1, 1).data;
        return [r / 255, g / 255, b / 255];
      } catch (error) {
        // Tainted or unsupported colour: keep the reviewed fallback rather
        // than rendering an unreadable scene.
        return fallback;
      }
    }

    const palette = {
      fog: [0.06, 0.09, 0.14],
      line: [0.42, 0.5, 0.6],
      crest: [0.85, 0.68, 0.4],
      lineGain: 1
    };

    function refreshPalette() {
      palette.fog = readColor("--color-paper", palette.fog);
      // --color-muted rather than --color-rule: rule is tuned for hairlines
      // against a surface and washes out entirely on the 白妙 palette, where
      // the scene needs a line that still reads on near-white paper.
      palette.line = readColor("--color-muted", palette.line);
      palette.crest = readColor("--color-accent", palette.crest);
      palette.lineGain = lineGainFor(palette.fog);
    }

    // sRGB compresses differences near black, so the alpha that reads as a
    // clear ridge on 白妙 lands at roughly half the contrast on 夜藍 and 暁 —
    // measured at 1.28:1 against 2.45:1 before this correction. Dark grounds
    // get a gain to bring both palettes to the same perceived weight. Derived
    // from the ground colour rather than the theme name, so it stays correct
    // for the OS scheme and for any palette added later.
    function lineGainFor(ground) {
      const channel = (value) =>
        value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      const luminance =
        0.2126 * channel(ground[0]) + 0.7152 * channel(ground[1]) + 0.0722 * channel(ground[2]);
      // smoothstep(0.35 -> 0.05): full gain on a near-black ground, none on paper.
      const t = Math.min(1, Math.max(0, (0.35 - luminance) / 0.3));
      return 1 + 1.9 * t * t * (3 - 2 * t);
    }

    // --- Matrix helpers (column-major, GL order) --------------------------
    function perspective(fovDegrees, aspect, near, far) {
      const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
      const range = 1 / (near - far);
      return [
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (near + far) * range, -1,
        0, 0, near * far * range * 2, 0
      ];
    }

    function lookAt(eye, target) {
      let zx = eye.x - target.x;
      let zy = eye.y - target.y;
      let zz = eye.z - target.z;
      const zLength = Math.hypot(zx, zy, zz) || 1;
      zx /= zLength;
      zy /= zLength;
      zz /= zLength;
      // World up is (0,1,0), so x = normalize(up x z) collapses to (zz, 0, -zx).
      let xx = zz;
      let xy = 0;
      let xz = -zx;
      const xLength = Math.hypot(xx, xy, xz) || 1;
      xx /= xLength;
      xy /= xLength;
      xz /= xLength;
      const yx = zy * xz - zz * xy;
      const yy = zz * xx - zx * xz;
      const yz = zx * xy - zy * xx;
      return [
        xx, yx, zx, 0,
        xy, yy, zy, 0,
        xz, yz, zz, 0,
        -(xx * eye.x + xy * eye.y + xz * eye.z),
        -(yx * eye.x + yy * eye.y + yz * eye.z),
        -(zx * eye.x + zy * eye.y + zz * eye.z),
        1
      ];
    }

    function multiply(a, b) {
      const out = new Array(16);
      for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) {
          out[column * 4 + row] =
            a[row] * b[column * 4] +
            a[4 + row] * b[column * 4 + 1] +
            a[8 + row] * b[column * 4 + 2] +
            a[12 + row] * b[column * 4 + 3];
        }
      }
      return out;
    }

    // --- Shaders ----------------------------------------------------------
    // Height is evaluated per-vertex on the GPU, so the terrain scrolls and
    // the entrance resolves without touching a single buffer after upload.
    const TERRAIN_VERTEX = `
      precision highp float;
      attribute vec2 aGrid;
      uniform mat4 uViewProjection;
      uniform float uTime;
      uniform float uEntrance;
      uniform float uAmplitude;
      varying float vHeight;
      varying float vDepth;
      varying float vRow;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        // The lattice is wrapped before hashing. hash() takes sin() of a
        // value that scales with the coordinate and the octave frequency,
        // and in mediump/highp float that loses its last significant digits
        // as the scene scrolls: left running, the ridge visibly flattens
        // into a bare grid after a few minutes. Wrapping keeps every hash
        // argument small, so the terrain is as sharp on hour two as on
        // second one. The period is far larger than the visible span, so
        // the repeat never enters frame.
        vec2 i0 = mod(i, 256.0);
        vec2 i1 = mod(i + 1.0, 256.0);
        return mix(
          mix(hash(i0), hash(vec2(i1.x, i0.y)), u.x),
          mix(hash(vec2(i0.x, i1.y)), hash(i1), u.x),
          u.y
        );
      }

      float ridged(vec2 p) {
        float sum = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        for (int octave = 0; octave < 5; octave += 1) {
          float n = valueNoise(p * frequency);
          n = 1.0 - abs(n * 2.0 - 1.0);
          sum += n * n * amplitude;
          amplitude *= 0.5;
          frequency *= 2.03;
        }
        return sum;
      }

      void main() {
        float x = aGrid.x * ${HALF_WIDTH.toFixed(1)};
        float z = mix(${NEAR_Z.toFixed(1)}, ${FAR_Z.toFixed(1)}, aGrid.y);

        // Far rows resolve first so the range appears to rise out of the
        // haze toward the viewer instead of inflating all at once.
        float rowEntrance = clamp(uEntrance * 1.9 - (1.0 - aGrid.y) * 0.9, 0.0, 1.0);
        rowEntrance = rowEntrance * rowEntrance * (3.0 - 2.0 * rowEntrance);

        // The valley floor stays open near the camera; relief builds with
        // distance, mirroring the hero photograph's composition.
        float relief = smoothstep(0.04, 0.62, aGrid.y);
        float ridge = ridged(vec2(x * 0.11, z * 0.07 - uTime * 0.021));
        float height = (ridge - 0.35) * uAmplitude * relief * rowEntrance;

        vHeight = clamp(ridge * relief, 0.0, 1.0);
        vRow = aGrid.y;
        vec4 world = vec4(x, height, z, 1.0);
        vDepth = clamp((${NEAR_Z.toFixed(1)} - z) / ${(NEAR_Z - FAR_Z).toFixed(1)}, 0.0, 1.0);
        gl_Position = uViewProjection * world;
      }
    `;

    const TERRAIN_FRAGMENT = `
      precision mediump float;
      uniform vec3 uFog;
      uniform vec3 uLine;
      uniform vec3 uCrest;
      uniform float uOpacity;
      uniform float uLineGain;
      varying float vHeight;
      varying float vDepth;
      varying float vRow;

      void main() {
        // Atmosphere: exponential extinction toward the page background, so
        // the scene dissolves into the section instead of ending on an edge.
        float fog = exp(-vDepth * vDepth * 5.2);
        // Crest lighting: altitude drives the accent, which is the only
        // saturated colour the scene is allowed to spend.
        vec3 colour = mix(uLine, uCrest, smoothstep(0.26, 0.7, vHeight));
        colour = mix(uFog, colour, fog);
        // The foreground grid is suppressed outright. Fog already dissolves
        // the far edge, so what survives is a band of relief at middle
        // distance — a range on a horizon, not a plane under the copy.
        float band = smoothstep(0.08, 0.46, vRow);
        float alpha = min(1.0, uOpacity * fog * band * uLineGain);
        gl_FragColor = vec4(colour, alpha);
      }
    `;

    const MOTE_VERTEX = `
      precision highp float;
      attribute vec3 aSeed;
      uniform mat4 uViewProjection;
      uniform float uTime;
      uniform float uEntrance;
      uniform float uPixelRatio;
      varying float vFade;

      void main() {
        float drift = fract(aSeed.z + uTime * 0.014);
        float x = (aSeed.x * 2.0 - 1.0) * ${HALF_WIDTH.toFixed(1)};
        float y = mix(-0.4, 5.4, drift);
        float z = mix(${NEAR_Z.toFixed(1)}, ${FAR_Z.toFixed(1)}, aSeed.y);
        vec4 world = vec4(x + sin(uTime * 0.22 + aSeed.z * 22.0) * 0.5, y, z, 1.0);
        float depth = clamp((${NEAR_Z.toFixed(1)} - z) / ${(NEAR_Z - FAR_Z).toFixed(1)}, 0.0, 1.0);
        // Motes fade in and out at both ends of their travel so none of them
        // ever pops into or out of existence.
        vFade = uEntrance * exp(-depth * depth * 4.0) * sin(drift * 3.14159);
        gl_PointSize = max(1.0, (2.6 - depth * 1.8) * uPixelRatio);
        gl_Position = uViewProjection * world;
      }
    `;

    const MOTE_FRAGMENT = `
      precision mediump float;
      uniform vec3 uCrest;
      uniform float uOpacity;
      uniform float uLineGain;
      varying float vFade;

      void main() {
        vec2 offset = gl_PointCoord - vec2(0.5);
        float disc = smoothstep(0.5, 0.06, length(offset));
        gl_FragColor = vec4(uCrest, min(1.0, uOpacity * vFade * disc * 0.5 * uLineGain));
      }
    `;

    // --- GL bootstrap -----------------------------------------------------
    const contextOptions = {
      alpha: true,
      antialias: true,
      depth: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: "low-power",
      premultipliedAlpha: false
    };

    let gl = null;
    try {
      gl =
        canvas.getContext("webgl", contextOptions) ||
        canvas.getContext("experimental-webgl", contextOptions);
    } catch (error) {
      gl = null;
    }

    function teardown() {
      canvas.remove();
      root.classList.remove("hero-3d-ready");
    }

    if (!gl) {
      // No WebGL: the photographic hero is the whole hero, exactly as before.
      teardown();
      return;
    }

    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Hero shader failed to compile: ${log}`);
      }
      return shader;
    }

    function link(vertexSource, fragmentSource) {
      const program = gl.createProgram();
      const vertex = compile(gl.VERTEX_SHADER, vertexSource);
      const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Hero program failed to link: ${log}`);
      }
      return program;
    }

    function uniformMap(program, names) {
      const map = {};
      names.forEach((name) => {
        map[name] = gl.getUniformLocation(program, name);
      });
      return map;
    }

    let terrain;
    let motes;
    try {
      const { columns, rows } = gridResolution();
      const positions = new Float32Array(columns * rows * 2);
      let cursor = 0;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          positions[cursor] = (column / (columns - 1)) * 2 - 1;
          positions[cursor + 1] = row / (rows - 1);
          cursor += 2;
        }
      }

      // Lines run across the ridge (constant depth) so the wireframe reads as
      // contour lines. A sparser set of spines runs into depth to give the
      // eye a sense of perspective without turning the scene into a mesh.
      const indices = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns - 1; column += 1) {
          const start = row * columns + column;
          indices.push(start, start + 1);
        }
      }
      const spineStep = Math.max(4, Math.round(columns / 24));
      for (let column = 0; column < columns; column += spineStep) {
        for (let row = 0; row < rows - 1; row += 1) {
          const start = row * columns + column;
          indices.push(start, start + columns);
        }
      }

      const useUint32 =
        positions.length / 2 > 65535 && Boolean(gl.getExtension("OES_element_index_uint"));
      const indexArray = useUint32 ? new Uint32Array(indices) : new Uint16Array(indices);
      if (!useUint32 && positions.length / 2 > 65535) {
        throw new Error("Hero grid exceeds the 16-bit index range without OES_element_index_uint");
      }

      const positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

      const indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexArray, gl.STATIC_DRAW);

      const program = link(TERRAIN_VERTEX, TERRAIN_FRAGMENT);
      terrain = {
        program,
        positionBuffer,
        indexBuffer,
        indexCount: indexArray.length,
        indexType: useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        attribute: gl.getAttribLocation(program, "aGrid"),
        uniforms: uniformMap(program, [
          "uViewProjection",
          "uTime",
          "uEntrance",
          "uAmplitude",
          "uFog",
          "uLine",
          "uCrest",
          "uOpacity",
          "uLineGain"
        ])
      };

      const moteCount = coarsePointerQuery.matches ? 90 : 210;
      const seeds = new Float32Array(moteCount * 3);
      for (let index = 0; index < moteCount; index += 1) {
        seeds[index * 3] = Math.random();
        seeds[index * 3 + 1] = Math.random();
        seeds[index * 3 + 2] = Math.random();
      }
      const moteBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, moteBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
      const moteProgram = link(MOTE_VERTEX, MOTE_FRAGMENT);
      motes = {
        program: moteProgram,
        buffer: moteBuffer,
        count: moteCount,
        attribute: gl.getAttribLocation(moteProgram, "aSeed"),
        uniforms: uniformMap(moteProgram, [
          "uViewProjection",
          "uTime",
          "uEntrance",
          "uPixelRatio",
          "uCrest",
          "uOpacity",
          "uLineGain"
        ])
      };
    } catch (error) {
      // A driver that cannot build this scene must not cost the visitor the
      // hero. Fail loudly in the console, silently in the layout.
      console.error(error);
      teardown();
      return;
    }

    refreshPalette();
    root.classList.add("hero-3d-ready");

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // --- Frame state ------------------------------------------------------
    let pixelRatio = 1;
    let viewportWidth = 0;
    let viewportHeight = 0;
    let pointerX = 0;
    let pointerY = 0;
    let pointerTargetX = 0;
    let pointerTargetY = 0;
    let scrollProgress = 0;
    let entrance = 0;
    let startTimestamp = 0;
    let frameHandle = null;
    let heroVisible = true;

    function resize() {
      const rect = hero.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      pixelRatio = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const targetWidth = Math.round(width * pixelRatio);
      const targetHeight = Math.round(height * pixelRatio);
      viewportWidth = targetWidth;
      viewportHeight = targetHeight;
      // Reallocating the drawing buffer is the expensive part, so only the
      // assignment is guarded — the viewport itself is always current.
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
    }

    function viewProjection() {
      const aspect = viewportHeight === 0 ? 1 : viewportWidth / viewportHeight;
      // Mouse parallax moves the camera, not the geometry, so the whole
      // scene shifts with correct perspective rather than sliding as a plane.
      const eye = {
        x: CAMERA.x + pointerX * 1.15,
        y: CAMERA.y + pointerY * 0.5 + scrollProgress * 2.6,
        z: CAMERA.z
      };
      const target = {
        x: TARGET.x + pointerX * 0.35,
        y: TARGET.y + pointerY * 0.18 - scrollProgress * 1.5,
        z: TARGET.z
      };
      return multiply(perspective(FOV, aspect, 0.1, 120), lookAt(eye, target));
    }

    function draw(seconds) {
      gl.viewport(0, 0, viewportWidth, viewportHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const matrix = new Float32Array(viewProjection());
      const opacity = Math.max(0, 1 - scrollProgress * 1.25);
      if (opacity <= 0.001) {
        return;
      }

      gl.useProgram(terrain.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, terrain.positionBuffer);
      gl.enableVertexAttribArray(terrain.attribute);
      gl.vertexAttribPointer(terrain.attribute, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrain.indexBuffer);
      gl.uniformMatrix4fv(terrain.uniforms.uViewProjection, false, matrix);
      gl.uniform1f(terrain.uniforms.uTime, seconds);
      gl.uniform1f(terrain.uniforms.uEntrance, entrance);
      gl.uniform1f(terrain.uniforms.uAmplitude, 7.4);
      gl.uniform3fv(terrain.uniforms.uFog, palette.fog);
      gl.uniform3fv(terrain.uniforms.uLine, palette.line);
      gl.uniform3fv(terrain.uniforms.uCrest, palette.crest);
      gl.uniform1f(terrain.uniforms.uOpacity, opacity);
      gl.uniform1f(terrain.uniforms.uLineGain, palette.lineGain);
      gl.drawElements(gl.LINES, terrain.indexCount, terrain.indexType, 0);

      gl.useProgram(motes.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, motes.buffer);
      gl.enableVertexAttribArray(motes.attribute);
      gl.vertexAttribPointer(motes.attribute, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(motes.uniforms.uViewProjection, false, matrix);
      gl.uniform1f(motes.uniforms.uTime, seconds);
      gl.uniform1f(motes.uniforms.uEntrance, entrance);
      gl.uniform1f(motes.uniforms.uPixelRatio, pixelRatio);
      gl.uniform3fv(motes.uniforms.uCrest, palette.crest);
      gl.uniform1f(motes.uniforms.uOpacity, opacity);
      gl.uniform1f(motes.uniforms.uLineGain, palette.lineGain);
      gl.drawArrays(gl.POINTS, 0, motes.count);
    }

    function renderStaticFrame() {
      // Reduced motion still deserves the composition — it just never moves.
      resize();
      entrance = 1;
      scrollProgress = 0;
      pointerX = 0;
      pointerY = 0;
      draw(0);
    }

    function frame(timestamp) {
      frameHandle = null;
      if (startTimestamp === 0) {
        startTimestamp = timestamp;
      }
      const elapsed = timestamp - startTimestamp;
      entrance = Math.min(1, elapsed / ENTRANCE_MS);
      // Critically damped follow, so the parallax never overshoots or
      // snaps when the pointer stops.
      pointerX += (pointerTargetX - pointerX) * 0.045;
      pointerY += (pointerTargetY - pointerY) * 0.045;
      resize();
      draw(elapsed / 1000);
      if (heroVisible && !document.hidden) {
        frameHandle = window.requestAnimationFrame(frame);
      }
    }

    function startLoop() {
      if (frameHandle !== null || motionQuery.matches) {
        return;
      }
      frameHandle = window.requestAnimationFrame(frame);
    }

    function stopLoop() {
      if (frameHandle === null) {
        return;
      }
      window.cancelAnimationFrame(frameHandle);
      frameHandle = null;
    }

    function updateScrollProgress() {
      const rect = hero.getBoundingClientRect();
      const travel = rect.height || 1;
      scrollProgress = Math.min(1, Math.max(0, -rect.top / travel));
    }

    // --- Wiring -----------------------------------------------------------
    if ("IntersectionObserver" in window) {
      const visibility = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            heroVisible = entry.isIntersecting;
            if (heroVisible) {
              startLoop();
            } else {
              stopLoop();
            }
          });
        },
        { threshold: 0 }
      );
      visibility.observe(hero);
    }

    window.addEventListener(
      "scroll",
      () => {
        updateScrollProgress();
      },
      { passive: true }
    );

    window.addEventListener("resize", () => {
      if (motionQuery.matches) {
        renderStaticFrame();
      }
    });

    if (!coarsePointerQuery.matches) {
      window.addEventListener(
        "pointermove",
        (event) => {
          if (event.pointerType === "touch") {
            return;
          }
          pointerTargetX = (event.clientX / window.innerWidth) * 2 - 1;
          pointerTargetY = -((event.clientY / window.innerHeight) * 2 - 1);
        },
        { passive: true }
      );
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopLoop();
      } else if (heroVisible) {
        startLoop();
      }
    });

    // Theme changes repaint the scene from the new tokens. The static branch
    // has no loop to pick the change up, so it redraws explicitly.
    const themeObserver = new MutationObserver(() => {
      refreshPalette();
      if (motionQuery.matches) {
        renderStaticFrame();
      }
    });
    themeObserver.observe(root, { attributeFilter: ["data-theme"] });

    function applyMotionPreference() {
      if (motionQuery.matches) {
        stopLoop();
        renderStaticFrame();
      } else {
        startTimestamp = 0;
        startLoop();
      }
    }

    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", applyMotionPreference);
    } else if (typeof motionQuery.addListener === "function") {
      motionQuery.addListener(applyMotionPreference);
    }

    updateScrollProgress();
    applyMotionPreference();
  }

  function scheduleRidgeline() {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(initialiseRidgeline, { timeout: 1200 });
    } else {
      window.setTimeout(initialiseRidgeline, 200);
    }
  }

  if (document.readyState === "complete") {
    scheduleRidgeline();
  } else {
    window.addEventListener("load", scheduleRidgeline, { once: true });
  }
})();
