(() => {
  "use strict";

  const config = window.SITE_CONFIG || {};
  const api = window.INaturalistSite;

  const grid = document.getElementById("observations-grid");
  if (!grid || !api) return;

  const search = document.getElementById("obs-search");
  const group = document.getElementById("obs-group");
  const year = document.getElementById("obs-year");
  const sort = document.getElementById("obs-sort");
  const count = document.getElementById("obs-count");
  const loadMore = document.getElementById("load-more");
  const shuffleButton = document.getElementById("shuffle-button");
  const dialog = document.getElementById("observation-dialog");
  const dialogContent = document.getElementById("dialog-content");
  const dialogClose = dialog?.querySelector(".dialog-close");

  let allObservations = [];
  let observationById = new Map();
  let filteredObservations = [];
  let visibleCount = 24;
  let activeMap = null;
  let loadState = {
    loaded: 0,
    total: null,
    done: false
  };

  const taxonMatchesGroup = (obs, selectedGroup) => {
    if (selectedGroup === "all") return true;
    const iconic = api.getIconicTaxon(obs);
    if (selectedGroup === "Animalia") {
      return [
        "Animalia", "Mollusca", "Reptilia", "Aves", "Amphibia",
        "Actinopterygii", "Mammalia", "Insecta", "Arachnida"
      ].includes(iconic);
    }
    return iconic === selectedGroup;
  };

  const renderYears = () => {
    const previous = year.value;
    const years = [...new Set(allObservations.map(api.getObservationYear).filter(Boolean))]
      .sort((a, b) => Number(b) - Number(a));

    year.innerHTML = `<option value="all">All years</option>` +
      years.map(value => `<option value="${api.escapeHTML(value)}">${api.escapeHTML(value)}</option>`).join("");

    if (previous !== "all" && years.includes(previous)) {
      year.value = previous;
    }
  };

  const sortFilteredObservations = () => {
    if (sort.value === "oldest") {
      filteredObservations.sort((a, b) =>
        String(a.observed_on || a.created_at).localeCompare(String(b.observed_on || b.created_at)));
    } else if (sort.value === "name") {
      filteredObservations.sort((a, b) =>
        api.getScientificName(a).localeCompare(api.getScientificName(b)));
    } else if (sort.value === "random") {
      filteredObservations = api.shuffle(filteredObservations);
    } else {
      filteredObservations.sort((a, b) =>
        String(b.observed_on || b.created_at).localeCompare(String(a.observed_on || a.created_at)));
    }
  };

  const applyFilters = ({ resetVisible = true } = {}) => {
    const term = search.value.trim().toLowerCase();
    const selectedGroup = group.value;
    const selectedYear = year.value;

    filteredObservations = allObservations.filter(obs => {
      const searchable = [
        api.getScientificName(obs),
        api.getCommonName(obs),
        api.getPlace(obs)
      ].join(" ").toLowerCase();

      const matchesSearch = !term || searchable.includes(term);
      const matchesGroup = taxonMatchesGroup(obs, selectedGroup);
      const matchesYear = selectedYear === "all" || api.getObservationYear(obs) === selectedYear;

      return matchesSearch && matchesGroup && matchesYear;
    });

    sortFilteredObservations();

    if (resetVisible) visibleCount = 24;
    render();
  };

  const renderStatus = () => {
    const matches = filteredObservations.length.toLocaleString();
    const loaded = loadState.loaded.toLocaleString();

    if (!loadState.done) {
      const totalText = loadState.total
        ? ` of ${loadState.total.toLocaleString()}`
        : "";
      count.textContent = `${matches} matching among ${loaded}${totalText} observations loaded…`;
      return;
    }

    count.textContent = `${matches} matching · ${loaded} total observations loaded`;
  };

  const render = () => {
    const visible = filteredObservations.slice(0, visibleCount);
    renderStatus();

    if (!visible.length) {
      grid.innerHTML = `<div class="gallery-placeholder">${loadState.done ? "No observations match those filters." : "Loading observations…"}</div>`;
    } else {
      grid.innerHTML = visible.map(obs => api.cardHTML(obs, { detailed: true })).join("");
    }

    loadMore.hidden = visibleCount >= filteredObservations.length;
  };

  const destroyMap = () => {
    if (activeMap) {
      activeMap.remove();
      activeMap = null;
    }
  };

  const initializeObservationMap = observation => {
    destroyMap();

    const mapElement = document.getElementById("observation-map");
    if (!mapElement || !window.L) return;

    const coordinates = api.getPublicCoordinates(observation);
    if (!coordinates) return;

    const privacy = api.getGeoprivacyStatus(observation);
    const { latitude, longitude } = coordinates;

    activeMap = window.L.map(mapElement, {
      zoomControl: true,
      scrollWheelZoom: false
    });

    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(activeMap);

    const accuracyMeters = Number(observation.positional_accuracy);
    const hasAccuracy = Number.isFinite(accuracyMeters) && accuracyMeters > 0;

    if (privacy === "obscured") {
      const point = window.L.circleMarker([latitude, longitude], {
        radius: 7,
        weight: 2,
        fillOpacity: 0.7
      }).addTo(activeMap);

      if (hasAccuracy) {
        const uncertainty = window.L.circle([latitude, longitude], {
          radius: accuracyMeters,
          weight: 1,
          fillOpacity: 0.08
        }).addTo(activeMap);
        activeMap.fitBounds(uncertainty.getBounds(), { padding: [18, 18], maxZoom: 10 });
      } else {
        activeMap.setView(point.getLatLng(), 8);
      }
    } else {
      const marker = window.L.marker([latitude, longitude]).addTo(activeMap);

      if (hasAccuracy && accuracyMeters > 20) {
        const accuracyCircle = window.L.circle([latitude, longitude], {
          radius: accuracyMeters,
          weight: 1,
          fillOpacity: 0.08
        }).addTo(activeMap);
        activeMap.fitBounds(accuracyCircle.getBounds(), { padding: [18, 18], maxZoom: 15 });
      } else {
        activeMap.setView(marker.getLatLng(), 14);
      }
    }

    window.setTimeout(() => activeMap?.invalidateSize(), 50);
  };

  const locationMarkup = observation => {
    const coordinates = api.getPublicCoordinates(observation);
    const privacy = api.getGeoprivacyStatus(observation);

    if (!coordinates || privacy === "private") {
      return `
        <section class="observation-map-section">
          <div class="map-heading-row">
            <h3>Location</h3>
            <span class="privacy-badge privacy-private">Private</span>
          </div>
          <p class="map-privacy-note">
            This observation has no coordinates available to the public, so no map is shown.
          </p>
        </section>
      `;
    }

    if (privacy === "obscured") {
      return `
        <section class="observation-map-section">
          <div class="map-heading-row">
            <h3>Location</h3>
            <span class="privacy-badge privacy-obscured">Obscured</span>
          </div>
          <div id="observation-map" class="observation-map" aria-label="Map of the publicly obscured iNaturalist location"></div>
          <p class="map-privacy-note">
            iNaturalist has obscured this location. The map uses only the randomized public point
            and public positional accuracy supplied by iNaturalist; precise coordinates are never requested or displayed.
          </p>
        </section>
      `;
    }

    return `
      <section class="observation-map-section">
        <div class="map-heading-row">
          <h3>Location</h3>
          <span class="privacy-badge privacy-open">Open</span>
        </div>
        <div id="observation-map" class="observation-map" aria-label="Map of the public iNaturalist observation location"></div>
        <p class="map-privacy-note public-coordinate-text">
          ${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}
        </p>
      </section>
    `;
  };

  const showObservation = observation => {
    destroyMap();

    const image = api.getPhotoUrl(observation, "original");
    const scientific = api.escapeHTML(api.getScientificName(observation));
    const common = api.escapeHTML(api.getCommonName(observation));
    const place = api.escapeHTML(api.getPlace(observation));
    const date = api.escapeHTML(api.getDisplayDate(observation));
    const url = `https://www.inaturalist.org/observations/${observation.id}`;

    const imageMarkup = image
      ? `<img src="${image}" alt="${scientific}">`
      : `<div class="dialog-no-photo">No photograph attached to this observation</div>`;

    dialogContent.innerHTML = `
      <div class="dialog-image-wrap">
        ${imageMarkup}
      </div>
      <div class="dialog-copy">
        <p class="eyebrow">FIELD OBSERVATION</p>
        ${common ? `<h2>${common}</h2>` : `<h2><em>${scientific}</em></h2>`}
        ${common ? `<p class="dialog-scientific"><em>${scientific}</em></p>` : ""}
        <dl>
          <div><dt>Date</dt><dd>${date}</dd></div>
          <div><dt>Place</dt><dd>${place}</dd></div>
        </dl>
        ${locationMarkup(observation)}
        <a class="button observation-inat-link" href="${url}" target="_blank" rel="noopener">Open on iNaturalist ↗</a>
      </div>
    `;

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      initializeObservationMap(observation);
    } else {
      window.open(url, "_blank", "noopener");
    }
  };

  grid.addEventListener("click", event => {
    const card = event.target.closest("[data-observation-id]");
    if (!card) return;
    const id = Number(card.dataset.observationId);
    const observation = observationById.get(id);
    if (observation) showObservation(observation);
  });

  dialogClose?.addEventListener("click", () => {
    destroyMap();
    dialog.close();
  });

  dialog?.addEventListener("click", event => {
    if (event.target === dialog) {
      destroyMap();
      dialog.close();
    }
  });

  dialog?.addEventListener("close", destroyMap);

  [search, group, year, sort].forEach(control => {
    control.addEventListener(control === search ? "input" : "change", () => {
      applyFilters({ resetVisible: true });
    });
  });

  loadMore.addEventListener("click", () => {
    visibleCount += 24;
    render();
  });

  shuffleButton.addEventListener("click", () => {
    filteredObservations = api.shuffle(filteredObservations);
    render();
  });

  api.fetchAllObservations({
    username: config.inaturalistUsername,
    perPage: config.observationBatchSize || 200,
    delayMs: config.apiRequestDelayMilliseconds || 1050,
    onBatch: ({ batch, loaded, total, done }) => {
      for (const observation of batch) {
        if (!observationById.has(observation.id)) {
          observationById.set(observation.id, observation);
          allObservations.push(observation);
        }
      }

      loadState = { loaded, total, done };
      renderYears();
      applyFilters({ resetVisible: loaded <= batch.length });
    }
  }).then(observations => {
    allObservations = observations;
    observationById = new Map(observations.map(obs => [obs.id, obs]));
    loadState = {
      loaded: observations.length,
      total: observations.length,
      done: true
    };
    renderYears();
    applyFilters({ resetVisible: false });
  }).catch(error => {
    if (!allObservations.length) {
      grid.innerHTML = `<div class="gallery-placeholder">${api.escapeHTML(error.message)}</div>`;
      count.textContent = "Gallery not configured";
      loadMore.hidden = true;
    } else {
      loadState.done = true;
      count.textContent = `${allObservations.length.toLocaleString()} observations loaded before an API error occurred.`;
    }
  });
})();
