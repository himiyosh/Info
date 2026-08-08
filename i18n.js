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
        shareImageAlt: "ポートフォリオの見出しと山岳写真を組み合わせた himiyosh のトップ画面"
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
        title: "好奇心を、実用へ。",
        content:
          "某グローバルIT企業で、テクノロジー領域の課題解決に取り組\u2060んでいます。役に立つ知識や技術を見つけ、試し、分かりやすい形にすることが好きです。",
        site:
          "このサイトでは、個人で公開している小さなツールと実験を紹介しています。内容はすべて個人の見解です。",
        statement: "好奇心を、実用へ。"
      },
      projects: {
        title: "小さな不便を、道具に。",
        intro: "日々の不便を小さくするために作った、公開中のサイト、サービス、ツールです。",
        skipToContact: "連絡先へスキップ",
        directoryLabel: "プロジェクト一覧",
        fallback: "JavaScript なしでも公開プロジェクトへ直接アクセスできます",
        loading: "プロジェクトを読み込んでいます。",
        ready: "{count}件のプロジェクトを表示しました。",
        error: "プロジェクトを読み込めませんでした。通信状況を確認して、もう一度お試しください。",
        retry: "再読み込み",
        proofLabel: "公開根拠",
        proofAction: "根拠を見る",
        permalinkAction: "固定リンク",
        permalinkLabel: "「{title}」プロジェクトへの固定リンク",
        shareAction: "共有",
        shareLabel: "「{title}」プロジェクトを共有",
        shareSuccess: "プロジェクトのリンクを共有しました。",
        copySuccess: "プロジェクトのリンクをコピーしました。",
        shareFailure:
          "共有できませんでした。固定リンクのコンテキストメニューからリンクをコピーしてください。"
      },
      contact: {
        title: "話しましょう。",
        intro: "技術や公開プロジェクトについてのご連絡は、メールまたは GitHub からどうぞ。",
        emailLabel: "Email",
        copyEmail: "メールアドレスをコピー",
        copySuccess: "メールアドレスをコピーしました。",
        copyManualSelected: "コピーできませんでした。選択中のアドレスを手動でコピーしてください。",
        copyFailure: "コピーできませんでした。表示中のアドレスを手動でコピーしてください。"
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
        backToTop: "ページ上部へ"
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
        shareImageAlt: "Portfolio hero pairing the himiyosh headline with a mountain photograph"
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
        title: "Curiosity, put to work.",
        content:
          "I work on technology challenges at a global IT company. I enjoy finding useful knowledge and techniques, testing them, and making them easier to understand.",
        site:
          "This site introduces small tools and experiments I publish independently. All content reflects my personal views.",
        statement: "Curiosity, put to work."
      },
      projects: {
        title: "Small frictions, made into tools.",
        intro: "Public sites, services, and tools built to make small, everyday tasks a little easier.",
        skipToContact: "Skip to Contact",
        directoryLabel: "Project directory",
        fallback: "Direct links to public projects:",
        loading: "Loading projects.",
        ready: "{count} projects loaded.",
        error: "Projects could not be loaded. Check your connection and try again.",
        retry: "Try again",
        proofLabel: "Public evidence",
        proofAction: "View evidence",
        permalinkAction: "Permalink",
        permalinkLabel: "Permalink to the {title} project",
        shareAction: "Share",
        shareLabel: "Share the {title} project",
        shareSuccess: "Project link shared.",
        copySuccess: "Project link copied.",
        shareFailure:
          "Sharing failed. Use the permalink's context menu to copy the link."
      },
      contact: {
        title: "Let's talk.",
        intro: "For questions about technology or these public projects, reach out by email or GitHub.",
        emailLabel: "Email",
        copyEmail: "Copy email address",
        copySuccess: "Email address copied.",
        copyManualSelected: "Copy failed. Copy the selected address manually.",
        copyFailure: "Copy failed. Select the visible address and copy it manually."
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
        backToTop: "Back to top"
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
