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
        switchLanguage: "EN（英語に切り替える）"
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
        title: "About",
        content:
          "某グローバルIT企業で、テクノロジー領域の課題解決に取り組\u2060んでいます。役に立つ知識や技術を見つけ、試し、分かりやすい形にすることが好きです。",
        site:
          "このサイトでは、個人で公開している小さなツールと実験を紹介しています。内容はすべて個人の見解です。",
        statement: "好奇心を、実用へ。"
      },
      projects: {
        title: "Projects",
        intro: "日々の不便を小さくするために作った、公開中のサイト、サービス、ツールです。",
        loading: "プロジェクトを読み込んでいます。",
        ready: "{count}件のプロジェクトを表示しました。",
        error: "プロジェクトを読み込めませんでした。通信状況を確認して、もう一度お試しください。",
        retry: "再読み込み",
        proofLabel: "公開根拠",
        proofAction: "根拠を見る",
        permalinkAction: "固定リンク",
        permalinkLabel: "「{title}」プロジェクトへの固定リンク"
      },
      contact: {
        title: "Contact",
        intro: "技術や公開プロジェクトについてのご連絡は、メールまたは GitHub からどうぞ。",
        emailLabel: "Email"
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
        switchLanguage: "JP (Switch to Japanese)"
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
        title: "About",
        content:
          "I work on technology challenges at a global IT company. I enjoy finding useful knowledge and techniques, testing them, and making them easier to understand.",
        site:
          "This site introduces small tools and experiments I publish independently. All content reflects my personal views.",
        statement: "Curiosity, put to work."
      },
      projects: {
        title: "Projects",
        intro: "Public sites, services, and tools built to make small, everyday tasks a little easier.",
        loading: "Loading projects.",
        ready: "{count} projects loaded.",
        error: "Projects could not be loaded. Check your connection and try again.",
        retry: "Try again",
        proofLabel: "Public evidence",
        proofAction: "View evidence",
        permalinkAction: "Permalink",
        permalinkLabel: "Permalink to the {title} project"
      },
      contact: {
        title: "Contact",
        intro: "For questions about technology or these public projects, reach out by email or GitHub.",
        emailLabel: "Email"
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

  function readStoredLanguage() {
    const urlLanguage = new URLSearchParams(window.location.search).get("lang");
    if (SUPPORTED_LANGUAGES.has(urlLanguage)) {
      return urlLanguage;
    }

    try {
      const storedLanguage = window.localStorage.getItem(STORAGE_KEY);
      return SUPPORTED_LANGUAGES.has(storedLanguage)
        ? storedLanguage
        : DEFAULT_LANGUAGE;
    } catch (error) {
      console.warn("Language preference could not be read:", error);
      return DEFAULT_LANGUAGE;
    }
  }

  function persistLanguage(language) {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch (error) {
      console.warn("Language preference could not be saved:", error);
    }
  }

  function updateLanguageUrl(language) {
    const url = new URL(window.location.href);
    if (language === DEFAULT_LANGUAGE) {
      url.searchParams.delete("lang");
    } else {
      url.searchParams.set("lang", language);
    }
    window.history.replaceState(
      {
        ...(window.history.state && typeof window.history.state === "object"
          ? window.history.state
          : {}),
        [HISTORY_LANGUAGE_KEY]: language
      },
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  }

  function updateLanguageHistoryState(language) {
    window.history.replaceState(
      {
        ...(window.history.state && typeof window.history.state === "object"
          ? window.history.state
          : {}),
        [HISTORY_LANGUAGE_KEY]: language
      },
      "",
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
  }

  function syncLanguageFromHistory(state) {
    const stateLanguage =
      state && typeof state === "object" ? state[HISTORY_LANGUAGE_KEY] : null;
    const urlLanguage = new URLSearchParams(window.location.search).get("lang");
    const language = SUPPORTED_LANGUAGES.has(stateLanguage)
      ? stateLanguage
      : SUPPORTED_LANGUAGES.has(urlLanguage)
        ? urlLanguage
        : currentLanguage;
    if (language === currentLanguage) {
      return false;
    }

    setLanguage(language, { persist: false });
    return true;
  }

  function rememberLanguageInHistory() {
    updateLanguageHistoryState(currentLanguage);
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

    const toggle = document.getElementById("lang-toggle");
    if (toggle) {
      toggle.textContent = language === "ja" ? "EN" : "JP";
      toggle.setAttribute(
        "aria-label",
        getTranslation(language, "nav.switchLanguage")
      );
    }

    if (persist) {
      persistLanguage(language);
      updateLanguageUrl(language);
    } else {
      updateLanguageHistoryState(language);
    }
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
    toggle() {
      setLanguage(currentLanguage === "ja" ? "en" : "ja");
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    setLanguage(readStoredLanguage(), { persist: false });
  });
})();
