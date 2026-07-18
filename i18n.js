if (typeof window.i18next === "undefined") {
  console.error("Translations are unavailable because i18next did not load.");
} else {
  window.updateNavigationLabel = function updateNavigationLabel() {
    const menuButton = document.getElementById("hamburger-menu");
    const labelKey =
      menuButton.getAttribute("aria-expanded") === "true"
        ? "nav.closeMenu"
        : "nav.openMenu";
    menuButton.setAttribute("aria-label", i18next.t(labelKey));
  };

  function updateContent() {
    document.documentElement.lang = i18next.resolvedLanguage;
    document.title = i18next.t("meta.title");

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      el.textContent = i18next.t(key);
    });

    document.querySelectorAll("[data-i18n-content]").forEach((el) => {
      const key = el.getAttribute("data-i18n-content");
      el.setAttribute("content", i18next.t(key));
    });

    const langToggle = document.getElementById("lang-toggle");
    langToggle.textContent = i18next.resolvedLanguage === "ja" ? "EN" : "JP";
    langToggle.setAttribute("aria-label", i18next.t("nav.switchLanguage"));
    window.updateNavigationLabel();
  }

  i18next.on("languageChanged", updateContent);

  i18next.init({
    lng: "ja",
    resources: {
      ja: {
        translation: {
          meta: {
            title: "himiyosh | エンジニアのポートフォリオ",
            description: "エンジニア himiyosh の個人ポートフォリオ。技術への関心、公開プロジェクト、連絡先を日本語と英語で紹介します。",
            locale: "ja_JP",
            alternateLocale: "en_US"
          },
          nav: {
            about: "About",
            projects: "Projects",
            contact: "Contact",
            openMenu: "ナビゲーションを開く",
            closeMenu: "ナビゲーションを閉じる",
            switchLanguage: "EN（英語に切り替える）"
          },
          about: {
            title: "About",
            content: "某グローバルIT企業にてテクノロジー領域の課題解決に携わるエンジニア。人の役に立つ知識・技術の探求が大好き。"
          },
          projects: {
            title: "Projects"
          },
          contact: {
            title: "Contact"
          },
          // 日本語ディスクレーマー（やや控えめ）
          disclaimer: "[免責事項] このアカウントは個人的利用を目的としています。所属組織の公式見解を代表するものではありません。"
        }
      },
      en: {
        translation: {
          meta: {
            title: "himiyosh | Engineer Portfolio",
            description: "Personal portfolio of engineer himiyosh, featuring technical interests, public projects, and contact links in Japanese and English.",
            locale: "en_US",
            alternateLocale: "ja_JP"
          },
          nav: {
            about: "About",
            projects: "Projects",
            contact: "Contact",
            openMenu: "Open navigation",
            closeMenu: "Close navigation",
            switchLanguage: "JP (Switch to Japanese)"
          },
          about: {
            title: "About",
            content: "Engineer working in a global IT company, passionate about solving technical challenges and helping others."
          },
          projects: {
            title: "Projects"
          },
          contact: {
            title: "Contact"
          },
          // 英語ディスクレーマー（控えめ）
          disclaimer: "[Disclaimer] This account is for personal usage. Does not represent the official views of the organization."
        }
      }
    }
  }, function(err) {
    if (err) {
      console.error("Unable to initialize translations:", err);
      return;
    }
    updateContent();
  });
}