(() => {
  "use strict";

  const config = window.SITE_CONFIG || {};
  const api = window.INaturalistSite;

  document.querySelectorAll("#current-year").forEach(element => {
    element.textContent = new Date().getFullYear();
  });

  const profileURL = config.inaturalistUsername && config.inaturalistUsername !== "YOUR_INAT_USERNAME"
    ? `https://www.inaturalist.org/people/${encodeURIComponent(config.inaturalistUsername)}`
    : "https://www.inaturalist.org/";

  document.querySelectorAll("#inat-profile-link").forEach(link => {
    link.href = profileURL;
  });

  const menuButton = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".site-nav");
  if (menuButton && nav) {
    menuButton.addEventListener("click", () => {
      const open = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("open", !open);
    });
  }

  const gallery = document.getElementById("home-inat-gallery");
  const hero = document.getElementById("hero-observation");

  if (!gallery || !api) return;

  let rotationTimer = null;

  const showError = message => {
    gallery.innerHTML = `<div class="gallery-placeholder">${api.escapeHTML(message)}</div>`;
    if (hero) {
      hero.innerHTML = `<div class="loading-message"><strong>Gallery setup</strong><span>${api.escapeHTML(message)}</span></div>`;
    }
  };

  // Ask iNaturalist for a random sample drawn from the user's complete set of
  // photo observations. This keeps the homepage fast while allowing any public
  // photo observation to be selected.
  api.fetchRandomPhotoObservations({
    username: config.inaturalistUsername,
    perPage: config.homeRandomSampleSize || 200
  }).then(observations => {
    if (!observations.length) {
      showError("No photo observations were returned.");
      return;
    }

    let queue = api.shuffle(observations);
    const count = Math.min(config.homeGalleryCount || 12, queue.length);
    let cursor = 0;

    const render = () => {
      if (cursor + count > queue.length) {
        queue = api.shuffle(queue);
        cursor = 0;
      }
      const set = queue.slice(cursor, cursor + count);
      cursor += count;

      gallery.classList.add("is-changing");
      window.setTimeout(() => {
        gallery.innerHTML = set.map(obs => api.cardHTML(obs)).join("");
        gallery.classList.remove("is-changing");
      }, 180);

      if (hero) {
        const featured = set[0];
        const image = api.getPhotoUrl(featured, "original");
        const scientific = api.escapeHTML(api.getScientificName(featured));
        const common = api.escapeHTML(api.getCommonName(featured));
        const regionCountry = api.escapeHTML(api.getRegionCountry(featured));
        hero.classList.remove("loading-card");
        hero.innerHTML = `
          <a class="hero-observation-link"
             href="https://www.inaturalist.org/observations/${featured.id}"
             target="_blank"
             rel="noopener">
            <img src="${image}" alt="${scientific}">
            <span class="hero-observation-caption">
              ${common ? `<strong>${common}</strong>` : ""}
              <em>${scientific}</em>
              ${regionCountry ? `<span>${regionCountry}</span>` : ""}
              <span>${api.escapeHTML(api.getDisplayDate(featured))}</span>
            </span>
          </a>
        `;
      }
    };

    render();

    const interval = Math.max(Number(config.homeRotationMilliseconds) || 12000, 4000);
    if (queue.length > count) {
      rotationTimer = window.setInterval(render, interval);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && rotationTimer) {
        clearInterval(rotationTimer);
        rotationTimer = null;
      } else if (!document.hidden && !rotationTimer && queue.length > count) {
        rotationTimer = window.setInterval(render, interval);
      }
    });
  }).catch(error => {
    showError(error.message);
  });
})();
