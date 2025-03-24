// script.js
document.addEventListener("DOMContentLoaded", () => {
    // タイピングアニメ
    // ↓ ここを "Engineer / Rookie Dad / Camera, Travel, Movie" に変更
    const text = "Engineer / Rookie Dad";
    const typingTarget = document.getElementById("typing");
    let index = 0;
  
    function typeWriter() {
      if (index < text.length) {
        typingTarget.textContent += text.charAt(index);
        index++;
        setTimeout(typeWriter, 80);
      }
    }
    typeWriter();
  
    // GSAP: セクションのふわっとフェードイン
    gsap.utils.toArray(".fade-section").forEach((section) => {
      gsap.fromTo(
        section,
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 1,
          scrollTrigger: {
            trigger: section,
            start: "top 80%",
          },
        }
      );
    });
  
    // ヘッダー縮小アニメ
    const header = document.getElementById("header");
    window.addEventListener("scroll", () => {
      header.classList.toggle("shrink", window.scrollY > 50);
    });
  
    // プロジェクトリスト読込
    fetch("projects.json")
      .then((res) => res.json())
      .then((projects) => {
        const container = document.getElementById("projects-container");
        projects.forEach((project) => {
          const card = document.createElement("div");
          card.className = "project-card";
          card.innerHTML = `
            <h3>${project.title}</h3>
            <p>${project.description}</p>
            <a href="${project.link}" target="_blank">View Project</a>
          `;
          container.appendChild(card);
        });
      });
  
    // 幾何学模様のロード
    particlesJS.load("particles-js", "particles.json?v=1", () => {
      console.log("particles.js loaded with geometric polygons");
    });
  
    // 言語切り替え
    const langToggle = document.getElementById("lang-toggle");
    let currentLang = "ja";
    langToggle.addEventListener("click", () => {
      currentLang = currentLang === "ja" ? "en" : "ja";
      langToggle.textContent = currentLang === "ja" ? "EN" : "JP";
      i18next.changeLanguage(currentLang);
    });
  });
  