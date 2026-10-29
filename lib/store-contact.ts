/**
 * Public contact links for the Potchefstroom CBD storefront.
 * Change FACEBOOK_PAGE_URL here when the branch page URL updates.
 */

/** Verified branch Facebook page (Mochachos Potchefstroom). */
export const FACEBOOK_PAGE_URL = "https://www.facebook.com/p/Mochachos-Potchefstroom-61555559168216/";

export const STORE_MAP = {
  label: "17 Nelson Mandela Drive, Potchefstroom CBD",
  /** Classic embed — no Maps API key required. */
  embedSrc:
    "https://maps.google.com/maps?q=Mochachos%20Potchefstroom%2017%20Nelson%20Mandela%20Drive&z=16&output=embed",
  /** Opens Google Maps / directions in a new tab. */
  directionsUrl:
    "https://www.google.com/maps/search/?api=1&query=Mochachos+Potchefstroom+17+Nelson+Mandela+Drive",
} as const;
