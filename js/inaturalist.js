(() => {
  "use strict";

  const API_ROOT = "https://api.inaturalist.org/v1";

  const escapeHTML = (value = "") =>
    String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character]));

  const sleep = milliseconds =>
    new Promise(resolve => window.setTimeout(resolve, milliseconds));

  const getPhotoUrl = (observation, size = "large") => {
    const photo = observation?.observation_photos?.[0]?.photo;
    if (!photo?.url) return "";
    return photo.url.replace("square", size);
  };

  const getScientificName = observation =>
    observation?.taxon?.name || observation?.species_guess || "Unidentified";

  const getCommonName = observation =>
    observation?.taxon?.preferred_common_name || "";

  const getDisplayDate = observation => {
    const raw = observation?.observed_on || observation?.created_at;
    if (!raw) return "Date unavailable";
    const date = new Date(`${raw}`.slice(0, 10) + "T12:00:00");
    if (Number.isNaN(date.getTime())) return raw;
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(date);
  };

  const getObservationYear = observation =>
    String(observation?.observed_on || observation?.created_at || "").slice(0, 4);

  const getIconicTaxon = observation =>
    observation?.taxon?.iconic_taxon_name || "Unknown";

  const getPlace = observation =>
    observation?.place_guess || "Location not displayed";

  /*
    iNaturalist exposes place_guess as the public locality string. For an
    obscured observation, iNaturalist itself coarsens this locality text.
    This helper therefore uses only that PUBLIC field and takes the final two
    comma-separated units as state/province + country.
  */
  const getRegionCountry = observation => {
    const place = String(observation?.place_guess || "").trim();
    if (!place) return "";

    // Do not mistake a raw "lat, lon" string for a named locality.
    if (/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(place)) {
      return "";
    }

    const parts = place
      .split(",")
      .map(part => part.trim())
      .filter(Boolean);

    if (!parts.length) return "";
    if (parts.length === 1) return parts[0];

    let region = parts[parts.length - 2];
    const country = parts[parts.length - 1];

    // Remove a trailing US ZIP / ZIP+4 from strings such as "New York 14850".
    region = region.replace(/\s+\d{5}(?:-\d{4})?$/, "").trim();

    return [region, country].filter(Boolean).join(" · ");
  };

  /*
    PRIVACY RULE: use only observation.geojson, iNaturalist's PUBLIC geometry.
    Never read private_geojson, private_latitude, private_longitude, or any
    authenticated/private location field.
  */
  const getPublicCoordinates = observation => {
    const coordinates = observation?.geojson?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return { latitude, longitude };
  };

  const getGeoprivacyStatus = observation => {
    const hasPublicCoordinates = Boolean(getPublicCoordinates(observation));
    const isObscured = Boolean(
      observation?.obscured ||
      observation?.geoprivacy === "obscured" ||
      observation?.taxon_geoprivacy === "obscured"
    );

    if (!hasPublicCoordinates) return "private";
    if (isObscured) return "obscured";
    return "open";
  };

  const shuffle = input => {
    const array = [...input];
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  };

  const requestObservations = async paramsObject => {
    const params = new URLSearchParams();

    Object.entries(paramsObject).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
      }
    });

    const response = await fetch(`${API_ROOT}/observations?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`iNaturalist request failed (${response.status}).`);
    }

    return response.json();
  };

  const validateUsername = username => {
    if (!username || username === "YOUR_INAT_USERNAME") {
      throw new Error("Set your iNaturalist username in js/config.js first.");
    }
  };

  /*
    Homepage helper: iNaturalist draws a random sample from the user's complete
    set of photo observations. Thus older observations remain eligible without
    making the homepage download the full account on every visit.
  */
  const fetchRandomPhotoObservations = async ({ username, perPage = 200 } = {}) => {
    validateUsername(username);

    const data = await requestObservations({
      user_id: username,
      photos: true,
      per_page: Math.min(Math.max(Number(perPage) || 200, 1), 200),
      order_by: "random"
    });

    return (data.results || []).filter(obs => getPhotoUrl(obs));
  };

  /*
    Retrieve the complete public observation history in API-friendly batches.
    Sorting by ID ascending and advancing id_above avoids the ordinary 10,000
    result pagination ceiling. onBatch lets the page render progressively.
  */
  const fetchAllObservations = async ({
    username,
    perPage = 200,
    delayMs = 1050,
    onBatch,
    onProgress
  } = {}) => {
    validateUsername(username);

    const batchSize = Math.min(Math.max(Number(perPage) || 200, 1), 200);
    const pause = Math.max(Number(delayMs) || 1050, 1000);
    const observations = [];
    let idAbove = null;
    let firstRequest = true;
    let expectedTotal = null;

    while (true) {
      const data = await requestObservations({
        user_id: username,
        per_page: batchSize,
        order_by: "id",
        order: "asc",
        id_above: idAbove
      });

      const batch = data.results || [];

      if (firstRequest) {
        expectedTotal = Number.isFinite(Number(data.total_results))
          ? Number(data.total_results)
          : null;
        firstRequest = false;
      }

      observations.push(...batch);
      const done = batch.length < batchSize;

      if (typeof onBatch === "function") {
        onBatch({
          batch,
          loaded: observations.length,
          total: expectedTotal,
          done
        });
      }

      if (typeof onProgress === "function") {
        onProgress({
          loaded: observations.length,
          total: expectedTotal,
          done
        });
      }

      if (done) break;

      const lastId = Number(batch[batch.length - 1]?.id);
      if (!Number.isFinite(lastId)) {
        throw new Error("Could not continue iNaturalist pagination safely.");
      }

      idAbove = lastId;
      await sleep(pause);
    }

    return observations;
  };

  const fetchObservations = async ({ username, perPage = 200 } = {}) => {
    validateUsername(username);

    const data = await requestObservations({
      user_id: username,
      photos: true,
      per_page: Math.min(Math.max(Number(perPage) || 200, 1), 200),
      order: "desc",
      order_by: "observed_on"
    });

    return (data.results || []).filter(obs => getPhotoUrl(obs));
  };

  const cardHTML = (observation, { detailed = false } = {}) => {
    const id = observation.id;
    const scientific = escapeHTML(getScientificName(observation));
    const common = escapeHTML(getCommonName(observation));
    const image = getPhotoUrl(observation, detailed ? "large" : "original");
    const date = escapeHTML(getDisplayDate(observation));
    const place = escapeHTML(getPlace(observation));
    const regionCountry = escapeHTML(getRegionCountry(observation));
    const observationURL = `https://www.inaturalist.org/observations/${id}`;

    const imageMarkup = image
      ? `<img src="${image}" alt="${scientific}" loading="lazy">`
      : `<span class="inat-no-photo" aria-hidden="true">No photo</span>`;

    if (!detailed) {
      return `
        <a class="inat-card" href="${observationURL}" target="_blank" rel="noopener">
          ${imageMarkup}
          <span class="inat-overlay">
            ${common ? `<span class="common-name">${common}</span>` : ""}
            <span class="scientific-name"><em>${scientific}</em></span>
            ${regionCountry ? `<span class="observation-location">${regionCountry}</span>` : ""}
          </span>
        </a>
      `;
    }

    return `
      <button class="inat-card inat-card-detailed" type="button" data-observation-id="${id}">
        ${imageMarkup}
        <span class="inat-overlay">
          ${common ? `<span class="common-name">${common}</span>` : ""}
          <span class="scientific-name"><em>${scientific}</em></span>
          <span class="observation-meta">${date}</span>
        </span>
        <span class="sr-only">View details for ${scientific}, ${place}</span>
      </button>
    `;
  };

  window.INaturalistSite = {
    fetchObservations,
    fetchRandomPhotoObservations,
    fetchAllObservations,
    getPhotoUrl,
    getScientificName,
    getCommonName,
    getDisplayDate,
    getObservationYear,
    getIconicTaxon,
    getPlace,
    getRegionCountry,
    getPublicCoordinates,
    getGeoprivacyStatus,
    shuffle,
    cardHTML,
    escapeHTML
  };
})();
