/**
 * Deterministic reading of the short, high-stakes replies.
 *
 * "Is this order correct?" has to be understood every single time, including
 * when the answer is "ja", "yebo", "sharp" or "nope thats all", so these
 * answers are matched against a lexicon instead of being sent to a language
 * model. Anything that is not clearly one thing or the other returns "unclear"
 * and the agent takes over, which is the safe direction to fail in: the bot
 * asks again rather than placing an order the customer did not agree to.
 *
 * Note that the same words mean different things depending on the question.
 * "That's it" confirms an order but ends the "anything else?" question, so each
 * question gets its own reader rather than sharing one yes/no function.
 */

export type Confirmation = "yes" | "no" | "unclear";
export type AnythingElse = "add" | "done" | "unclear";

/** Lowercase, strip punctuation and collapse whitespace, keeping emoji. */
export function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['`’]/g, "")
    .replace(/[.,!?;:"()\-_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Enthusiasm stretches words out ("yesss", "nooo", "hiii"), so each message is
 * also tested with long letter runs shortened. Both a one-letter and a
 * two-letter collapse are tried so "coooool" still reaches "cool".
 */
function variants(text: string): string[] {
  const one = text.replace(/(.)\1{2,}/g, "$1");
  const two = text.replace(/(.)\1{2,}/g, "$1$1");
  return [...new Set([text, one, two])];
}

/** Politeness that may follow a yes or a no without changing its meaning. */
const POLITE_TAIL = "(?:\\s*(?:please|pls|plz|thanks|thank you|thanx|thnx|dankie|ta|my friend|boss|sir|maam|baie dankie))*";

function lexicon(words: string[]): (text: string) => boolean {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`^(?:${escaped.join("|")})${POLITE_TAIL}$`);
  return (text: string) => variants(text).some((v) => re.test(v));
}

const YES_WORDS = [
  "yes", "yeah", "yea", "yep", "yup", "ya", "yah", "yas",
  "ja", "jah", "jaa", "jees", "yebo", "ewe",
  "sure", "ok", "oki", "okay", "okey", "oke", "kk", "k", "cool", "cool cool",
  "sharp", "shap", "sharp sharp", "shap shap", "lekker", "kwaai", "aweh",
  "correct", "korrek", "dis reg", "is reg", "right", "thats right", "thats correct", "thats it",
  "confirm", "confirmed", "confirm it", "approved", "approve",
  "go ahead", "go for it", "send it", "send it through", "place it", "place the order", "order it", "make it",
  "all good", "its good", "looks good", "sounds good", "looks right", "perfect", "great", "lovely",
  "100", "100%", "yes 100", "fine", "indeed", "definitely", "absolutely", "for sure", "no problem",
  "👍", "👍🏽", "👍🏾", "👍🏿", "👌", "✅", "✔", "💯", "🔥",
];

const NO_WORDS = [
  "no", "nope", "nah", "naah", "na", "nee", "negative", "nay",
  "no no", "no man", "ag no", "hayi", "cha",
  "wrong", "incorrect", "not right", "thats wrong", "thats not right", "thats incorrect", "not correct",
  "not quite", "not really", "not yet", "nog nie",
  "hold on", "hold up", "wait", "wag", "one sec", "one second", "hang on",
  "👎", "❌", "🚫",
];

const isYes = lexicon(YES_WORDS);
const isNo = lexicon(NO_WORDS);

/**
 * A reply that both agrees and asks for something ("yes but make it hot") is a
 * change request, not a confirmation, so it goes to the agent instead.
 */
const CORRECTION_MARKERS =
  /\b(but|instead|rather|actually|change|swap|replace|remove|take off|without|add|extra|make it|can i|could i|id like|i want|i would)\b/;

export function readConfirmation(raw: string): Confirmation {
  const text = normalise(raw);
  if (!text) return "unclear";
  const yes = isYes(text);
  const no = isNo(text);
  if (yes === no) return "unclear";
  if (CORRECTION_MARKERS.test(text)) return "unclear";
  return yes ? "yes" : "no";
}

const DONE_WORDS = [
  ...NO_WORDS.filter((w) => !["wait", "wag", "hold on", "hold up", "one sec", "one second", "hang on"].includes(w)),
  "thats all", "thats it", "thats everything", "that will be all", "thats me", "thats us",
  "nothing else", "nothing more", "no more", "nothing thanks", "niks meer", "niks",
  "im good", "im fine", "im done", "done", "finished", "complete", "thats the lot",
  "no thats all", "no thats it", "nope thats all", "nee dis al", "dis al",
  "place the order", "send it", "send it through", "confirm", "checkout", "thats my order", "order it",
];

const ADD_WORDS = [
  "yes", "yeah", "yea", "yep", "yup", "ya", "ja", "yebo", "sure", "ok", "okay",
  "one more", "another", "also", "and", "add", "more", "nog een", "nog",
];

const isDone = lexicon(DONE_WORDS);
const isAdd = lexicon(ADD_WORDS);

/**
 * "Anything else?" inverts the usual sense: "no thanks" finishes the order and
 * "yes" means the customer wants to keep adding.
 */
export function readAnythingElse(raw: string): AnythingElse {
  const text = normalise(raw);
  if (!text) return "unclear";
  const done = isDone(text);
  const add = isAdd(text);
  if (done && !add) return "done";
  if (add && !done) return "add";
  return "unclear";
}

const isGreetingWord = lexicon([
  "hi", "hi there", "hey", "hey there", "hello", "hello there", "helo", "hallo", "haai", "hiya", "yo",
  "howzit", "heita", "aweh", "awe", "molo", "sawubona", "dumela", "thobela", "avuxeni",
  "good morning", "good afternoon", "good evening", "good day", "morning", "afternoon", "evening",
  "goeie more", "goeiemore", "goeie dag", "goeiedag", "goeie middag", "goeie naand", "middag", "naand",
  "hoe gaan dit", "hoe gaan dit daar", "salaam", "as salaam alaikum", "assalamualaikum", "greetings",
  "👋", "🙋", "🤚", "✋",
]);

export function isGreeting(raw: string): boolean {
  return isGreetingWord(normalise(raw));
}

const MENU_RE =
  /\b(menu|spyskaart|kos lys|price list|prices|pricelist|what do you (?:have|sell)|whats (?:on|available)|wat het julle|specials|options|can i (?:see|order)|i want to order|id like to order|order something|place an order|lets order|start(?: an)? order|order please)\b/;

export function wantsMenu(raw: string): boolean {
  return MENU_RE.test(normalise(raw));
}

const PICTURE_RE =
  /\b(picture|pictures|photo|photos|image|images|pdf|menu board|printed menu|show me the menu|send (?:me )?(?:the |a )?(?:menu|picture|pictures|photo|photos|pdf|file))\b/;

/** The customer wants the printed menu, not only the tappable list. */
export function wantsMenuPictures(raw: string): boolean {
  return PICTURE_RE.test(normalise(raw));
}

const HUMAN_RE = [
  /\b(?:speak|talk|chat|connect|transfer|put me through)\b[\s\S]{0,25}\b(?:to|with)\b[\s\S]{0,20}\b(?:someone|somebody|a human|human|a person|person|agent|staff|manager|owner|consultant|cashier|real)\b/,
  /\b(real person|live agent|human agent|actual person|customer (?:service|care)|call me|phone me|ring me|bel my|praat met iemand)\b/,
  /\b(complaint|complain|refund|manager)\b/,
];

export function wantsHuman(raw: string): boolean {
  const text = normalise(raw);
  return HUMAN_RE.some((re) => re.test(text));
}

const CANCEL_RE =
  /\b(cancel|kanselleer|scrap (?:that|it|my order)|forget (?:it|the order|my order)|dont want (?:it|the order)|no longer want|call it off)\b/;

export function wantsCancel(raw: string): boolean {
  return CANCEL_RE.test(normalise(raw));
}

const STATUS_RE =
  /\b(where(?:s| is) my order|is (?:it|my order) ready|ready yet|how long|how much longer|what time (?:will|is)|when will (?:it|my order)|status|hoe lank|is dit gereed|any update|still waiting|order update)\b/;

export function wantsStatus(raw: string): boolean {
  return STATUS_RE.test(normalise(raw));
}
