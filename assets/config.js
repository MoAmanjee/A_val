/* M³ Technologies — public site settings.
   Leave a value as an empty string until it is real. Do not invent a number or an inbox.

   whatsapp
     Digits only, country code included, no plus sign. Example: "27821234567".
     When set, WhatsApp buttons open this chat, and the quote form can open WhatsApp
     with the enquiry already written.

   leadEndpoint
     An https address that accepts POST application/json.
     Body: { name, business, email, phone, industry, service, details, consent, source }.
     A response in the 200 range is the only result treated as received.
     This static site does not store enquiries. Point this at your own API,
     a Cloudflare Worker, Formspark, or another lead inbox you control.

   contactEmail / operatorAddress
     Published on the privacy notice when you want them public. They are not used
     as a hidden mailer.

   analyticsProvider
     "" (off), "plausible", or "ga4".
     Nothing loads until a visitor chooses Allow.
     plausible needs analyticsDomain. ga4 needs analyticsId, for example "G-XXXXXXXX".
*/
window.M3_CONFIG = {
  whatsapp: "",
  leadEndpoint: "",
  contactEmail: "",
  operatorAddress: "",
  analyticsProvider: "",
  analyticsId: "",
  analyticsDomain: "",
};
