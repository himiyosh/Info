// i18n.js
i18next.init({
    lng: "ja",
    resources: {
      ja: {
        translation: {
          nav: {
            about: "About",
            projects: "Projects",
            contact: "Contact"
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
          }
        }
      },
      en: {
        translation: {
          nav: {
            about: "About",
            projects: "Projects",
            contact: "Contact"
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
          }
        }
      }
    }
  }, function(err, t) {
    updateContent();
  });
  
  // 言語が変わるたびに各要素のテキストを再描画
  i18next.on('languageChanged', () => updateContent());
  
  function updateContent() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = i18next.t(key);
    });
  }
  