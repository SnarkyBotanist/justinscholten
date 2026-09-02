/*
  SITE / iNATURALIST SETTINGS
  Edit these values to change gallery behavior.
*/
window.SITE_CONFIG = {
  inaturalistUsername: "justinscholten",

  // Homepage rotating gallery. iNaturalist returns a random sample drawn from
  // the user's complete set of photo observations. API requests are capped at 200.
  homeGalleryCount: 12,
  homeRotationMilliseconds: 12000,
  homeRandomSampleSize: 200,

  // Full observations page. All public observations are loaded progressively
  // in batches of 200 using id_above pagination.
  apiRequestDelayMilliseconds: 1050,
  observationBatchSize: 200
};
