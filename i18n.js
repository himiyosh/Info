(() => {
  "use strict";

  const STORAGE_KEY = "info-language";
  const HISTORY_LANGUAGE_KEY = "infoLanguage";
  const DEFAULT_LANGUAGE = "ja";
  const SUPPORTED_LANGUAGES = new Set(["ja", "en"]);

  const translations = {
    ja: {
      meta: {
        title: "himiyosh | エンジニアのポートフォリオ",
        description:
          "エンジニア himiyosh の個人ポートフォリオ。技術への関心、公開プロジェクト、連絡先を日本語と英語で紹介します。",
        locale: "ja_JP",
        alternateLocale: "en_US",
        imageAlt: "山岳風景の中で手を上げる himiyosh のシルエット",
        shareImageAlt: "夜藍の背景に「技術を、役に立つ形へ。」の見出しと山のロゴマークを配した himiyosh の共有カード"
      },
      accessibility: {
        skip: "メインコンテンツへ移動",
        opensInNewTab: "（新しいタブで開きます）"
      },
      nav: {
        label: "主要ナビゲーション",
        about: "About",
        projects: "Projects",
        contact: "Contact",
        openMenu: "ナビゲーションを開く",
        closeMenu: "ナビゲーションを閉じる",
        switchLanguage: "EN（英語に切り替える）",
        toggleShort: "EN"
      },
      hero: {
        role: "Engineer / Rookie Dad",
        titleLine1: "技術を、",
        titleLine2: "役に立つ形へ。",
        lede:
          "課題を解き、学びを分かち合う。好奇心を実用へつなぐ、himiyosh\u00a0のポートフォリオです。",
        projectsCta: "プロジェクトを見る",
        contactCta: "連絡する",
        imageAlt: "山岳風景の中で手を上げる himiyosh のシルエット",
        caption: "画面の内外で、好奇心を持ち続ける。"
      },
      about: {
        eyebrow: "ABOUT",
        title: "好奇心を、実用へ。",
        factProjects: "公開プロジェクト",
        factBilingual: "バイリンガル対応",
        factSource: "ソース公開中心",
        content:
          "某グローバルIT企業で、テクノロジー領域の課題解決に取り組\u2060んでいます。役に立つ知識や技術を見つけ、試し、分かりやすい形にすることが好きです。",
        site:
          "このサイトでは、個人で公開している小さなツールと実験を紹介しています。内容はすべて個人の見解です。",
        statement: "好奇心を、実用へ。"
      },
      projects: {
        eyebrow: "WORKS — 09 PUBLIC PROJECTS",
        title: "小さな不便を、道具に。",
        intro: "日々の不便を小さくするために作った、公開中のサイト、サービス、ツールです。",
        skipToContact: "連絡先へスキップ",
        panelLabel: "その他の公開プロジェクト",
        panelHead: "projects — live & open source",
        statusLive: "200 OK",
        statusSource: "SOURCE",
        goOpen: "OPEN ↗",
        goCode: "CODE ↗",
        previewLabel: "PREVIEW"
      },
      contact: {
        eyebrow: "CONTACT",
        title: "話しましょう。",
        intro: "技術や公開プロジェクトについてのご連絡は、メールまたは GitHub からどうぞ。",
        emailLabel: "Email",
        copyEmail: "メールアドレスをコピー",
        copySuccess: "メールアドレスをコピーしました。",
        copyManualSelected: "コピーできませんでした。選択中のアドレスを手動でコピーしてください。",
        copyFailure: "コピーできませんでした。表示中のアドレスを手動でコピーしてください。"
      },
      stack: {
        eyebrow: "STACK",
        title: "道具箱。",
        build: "BUILD",
        platform: "PLATFORM",
        quality: "QUALITY",
        chipAccessibility: "アクセシビリティ",
        chipI18n: "i18n(JA / EN)"
      },
      theme: {
        toLight: "白妙(ライトモード)に切り替え",
        toDark: "夜藍(ダークモード)に切り替え",
        akatsukiUnlocked: "夜が明けました — 隠しテーマ「暁」"
      },
      notFound: {
        metaDescription:
          "指定されたページは見つかりませんでした。himiyosh のポートフォリオから日本語または英語のページへ移動できます。",
        title: "ページが見つかりません",
        languageLabel: "日本語",
        guidance:
          "指定された URL にページはありません。ホームへ戻るか、プロジェクトや連絡先へ移動してください。",
        navigationLabel: "日本語の復帰先",
        homeAction: "日本語ホームへ",
        projectsAction: "プロジェクトを見る",
        contactAction: "お問い合わせ"
      },
      footer: {
        backToTop: "ページ上部へ",
        clockLabel: "現在時刻(日本標準時)",
        scrollCue: "SCROLL"
      },
      disclaimer:
        "このサイトは個人で運営しており、所属組織の公式見解を代表するものではありません。"
    },
    en: {
      meta: {
        title: "himiyosh | Engineer Portfolio",
        description:
          "Personal portfolio of engineer himiyosh, featuring technical interests, public projects, and contact links in Japanese and English.",
        locale: "en_US",
        alternateLocale: "ja_JP",
        imageAlt: "Silhouette of himiyosh raising a hand in a mountain landscape",
        shareImageAlt: "Share card for himiyosh: the headline Technology, made useful. set beside a mountain logo mark on a deep indigo field"
      },
      accessibility: {
        skip: "Skip to main content",
        opensInNewTab: "(opens in a new tab)"
      },
      nav: {
        label: "Primary navigation",
        about: "About",
        projects: "Projects",
        contact: "Contact",
        openMenu: "Open navigation",
        closeMenu: "Close navigation",
        switchLanguage: "JP (Switch to Japanese)",
        toggleShort: "JP"
      },
      hero: {
        role: "Engineer / Rookie Dad",
        titleLine1: "Technology,",
        titleLine2: "made useful.",
        lede:
          "Solving problems, sharing what I learn, and turning curiosity into practical work. This is himiyosh's personal portfolio.",
        projectsCta: "View projects",
        contactCta: "Get in touch",
        imageAlt: "Silhouette of himiyosh raising a hand in a mountain landscape",
        caption: "Staying curious, on and off the screen."
      },
      about: {
        eyebrow: "ABOUT",
        title: "Curiosity, put to work.",
        factProjects: "public projects",
        factBilingual: "bilingual throughout",
        factSource: "source-first, open",
        content:
          "I work on technology challenges at a global IT company. I enjoy finding useful knowledge and techniques, testing them, and making them easier to understand.",
        site:
          "This site introduces small tools and experiments I publish independently. All content reflects my personal views.",
        statement: "Curiosity, put to work."
      },
      projects: {
        eyebrow: "WORKS — 09 PUBLIC PROJECTS",
        title: "Small frictions, made into tools.",
        intro: "Public sites, services, and tools built to make small, everyday tasks a little easier.",
        skipToContact: "Skip to Contact",
        panelLabel: "More public projects",
        panelHead: "projects — live & open source",
        statusLive: "200 OK",
        statusSource: "SOURCE",
        goOpen: "OPEN ↗",
        goCode: "CODE ↗",
        previewLabel: "PREVIEW"
      },
      contact: {
        eyebrow: "CONTACT",
        title: "Let's talk.",
        intro: "For questions about technology or these public projects, reach out by email or GitHub.",
        emailLabel: "Email",
        copyEmail: "Copy email address",
        copySuccess: "Email address copied.",
        copyManualSelected: "Copy failed. Copy the selected address manually.",
        copyFailure: "Copy failed. Select the visible address and copy it manually."
      },
      stack: {
        eyebrow: "STACK",
        title: "The toolbox.",
        build: "BUILD",
        platform: "PLATFORM",
        quality: "QUALITY",
        chipAccessibility: "Accessibility",
        chipI18n: "i18n (JA / EN)"
      },
      theme: {
        toLight: "Switch to Shirotae (light mode)",
        toDark: "Switch to Yoruai (dark mode)",
        akatsukiUnlocked: "Dawn breaks — hidden theme: Akatsuki"
      },
      notFound: {
        metaDescription:
          "The requested page was not found. Continue to the Japanese or English pages of himiyosh's portfolio.",
        title: "Page not found",
        languageLabel: "English",
        guidance:
          "There is no page at this URL. Return home, browse the projects, or use the contact links.",
        navigationLabel: "Recovery links in English",
        homeAction: "English home",
        projectsAction: "View projects",
        contactAction: "Contact"
      },
      footer: {
        backToTop: "Back to top",
        clockLabel: "Current time (Japan Standard Time)",
        scrollCue: "SCROLL"
      },
      disclaimer:
        "This is a personal site and does not represent the official views of my employer."
    }
  };

  let currentLanguage = DEFAULT_LANGUAGE;

  function getTranslation(language, key) {
    const value = key
      .split(".")
      .reduce((result, part) => result?.[part], translations[language]);
    if (typeof value === "string") {
      return value;
    }

    const fallback = key
      .split(".")
      .reduce((result, part) => result?.[part], translations[DEFAULT_LANGUAGE]);
    if (typeof fallback === "string") {
      return fallback;
    }

    console.error(`Missing translation: ${language}.${key}`);
    return key;
  }

  if (
    typeof window === "undefined" &&
    typeof module !== "undefined" &&
    module.exports
  ) {
    module.exports = {
      DEFAULT_LANGUAGE,
      SUPPORTED_LANGUAGES,
      getTranslation,
      translations
    };
    return;
  }

  function readRouteLanguage() {
    const routeLanguage = document.documentElement.lang.toLocaleLowerCase("en-US");
    return SUPPORTED_LANGUAGES.has(routeLanguage) ? routeLanguage : DEFAULT_LANGUAGE;
  }

  function persistLanguage(language) {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch (error) {
      console.warn("Language preference could not be saved:", error);
    }
  }

  function siteRootUrl(sourceUrl = window.location.href) {
    return new URL(document.documentElement.dataset.siteRoot || ".", sourceUrl);
  }

  function stableLanguageUrl(language, sourceUrl = window.location.href) {
    if (!SUPPORTED_LANGUAGES.has(language)) {
      throw new RangeError(`Unsupported language: ${language}`);
    }

    const source = new URL(sourceUrl);
    const root = siteRootUrl(source);
    const target = new URL(language === DEFAULT_LANGUAGE ? "." : "en/", root);
    target.search = source.search;
    target.searchParams.delete("lang");
    target.hash = source.hash;
    return target;
  }

  function resolveSitePath(relativePath) {
    if (
      typeof relativePath !== "string" ||
      relativePath === "" ||
      /^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(relativePath)
    ) {
      throw new TypeError("Site paths must be non-empty relative paths.");
    }
    return `${document.documentElement.dataset.siteRoot || ""}${relativePath}`;
  }

  function historyState(language) {
    return {
      ...(window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {}),
      [HISTORY_LANGUAGE_KEY]: language
    };
  }

  function replaceHistoryUrl(language, url) {
    window.history.replaceState(
      historyState(language),
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  }

  function updateLanguageHistoryState(language) {
    replaceHistoryUrl(language, new URL(window.location.href));
  }

  function alternateLanguage() {
    return currentLanguage === DEFAULT_LANGUAGE ? "en" : DEFAULT_LANGUAGE;
  }

  function updateLanguageLink() {
    const toggle = document.getElementById("lang-toggle");
    if (!toggle) {
      return;
    }

    const language = alternateLanguage();
    const label = toggle.querySelector("[data-language-label]");
    toggle.setAttribute("href", stableLanguageUrl(language).href);
    toggle.setAttribute("hreflang", language);
    label?.setAttribute("lang", language);
  }

  function prepareAlternateNavigation() {
    const language = alternateLanguage();
    persistLanguage(language);
    updateLanguageLink();
    return stableLanguageUrl(language).href;
  }

  function normalizeLegacyLanguageQuery() {
    const source = new URL(window.location.href);
    const queryLanguage = source.searchParams.get("lang");
    if (!SUPPORTED_LANGUAGES.has(queryLanguage)) {
      return false;
    }

    const target = stableLanguageUrl(queryLanguage, source);
    persistLanguage(queryLanguage);
    if (target.pathname !== source.pathname) {
      window.location.replace(target.href);
      return true;
    }

    replaceHistoryUrl(queryLanguage, target);
    return false;
  }

  function syncLanguageFromHistory() {
    const routeLanguage = readRouteLanguage();
    if (routeLanguage !== currentLanguage) {
      setLanguage(routeLanguage, { persist: false });
      return true;
    }

    updateLanguageHistoryState(currentLanguage);
    updateLanguageLink();
    return false;
  }

  function rememberLanguageInHistory() {
    updateLanguageHistoryState(currentLanguage);
    updateLanguageLink();
  }

  function updateTextContent() {
    document.querySelectorAll("[data-i18n]:not([data-i18n-dynamic])").forEach((element) => {
      element.textContent = getTranslation(
        currentLanguage,
        element.getAttribute("data-i18n")
      );
    });
  }

  function updateTranslatedAttribute(selector, dataAttribute, targetAttribute) {
    document.querySelectorAll(selector).forEach((element) => {
      element.setAttribute(
        targetAttribute,
        getTranslation(currentLanguage, element.getAttribute(dataAttribute))
      );
    });
  }

  function setLanguage(language, { persist = true } = {}) {
    if (!SUPPORTED_LANGUAGES.has(language)) {
      throw new RangeError(`Unsupported language: ${language}`);
    }

    currentLanguage = language;
    document.documentElement.lang = language;
    document.title = getTranslation(language, "meta.title");
    updateTextContent();
    updateTranslatedAttribute(
      "[data-i18n-content]",
      "data-i18n-content",
      "content"
    );
    updateTranslatedAttribute("[data-i18n-alt]", "data-i18n-alt", "alt");
    updateTranslatedAttribute(
      "[data-i18n-aria-label]",
      "data-i18n-aria-label",
      "aria-label"
    );

    if (persist) {
      persistLanguage(language);
    }
    updateLanguageHistoryState(language);
    updateLanguageLink();
    if (typeof window.updateNavigationLabel === "function") {
      window.updateNavigationLabel();
    }

    document.dispatchEvent(
      new CustomEvent("site-languagechange", {
        detail: { language }
      })
    );
  }

  window.siteI18n = {
    get language() {
      return currentLanguage;
    },
    rememberInHistory: rememberLanguageInHistory,
    t(key) {
      return getTranslation(currentLanguage, key);
    },
    setLanguage,
    syncFromHistory: syncLanguageFromHistory,
    prepareAlternateNavigation,
    resolveSitePath,
    stableUrl(language) {
      return stableLanguageUrl(language).href;
    },
    toggle() {
      window.location.assign(prepareAlternateNavigation());
    }
  };

  currentLanguage = readRouteLanguage();
  const redirecting = normalizeLegacyLanguageQuery();
  window.siteI18n.redirecting = redirecting;
  if (!redirecting) {
    setLanguage(currentLanguage);
  }
})();
