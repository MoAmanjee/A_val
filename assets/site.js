/* Studio number: digits only, country code included, no plus.
   Example: "27821234567". Leave empty until the number is ready. */
const STUDIO_WHATSAPP = "";

const SCENES = {
  counter: {
    shop: "Mochachos Potch",
    status: "orders",
    mood: "counter",
    line: "Sharp · send it to the kitchen",
    messages: [
      { from: "them", text: "Hot quarter chicken meal with a Coke, collection", time: "18:02" },
      {
        from: "bot",
        text: "1/4 chicken meal, hot, with a Coke.\nCollection · 17 Nelson Mandela Drive\nTotal R95.90\n\nReply yes and I’ll send it to the kitchen.",
        time: "18:02",
      },
      { from: "them", text: "Sharp", time: "18:03" },
      { from: "note", text: "Kitchen accepted · 18 min" },
      {
        from: "bot",
        text: "The kitchen has it. About 18 minutes, then collect at 17 Nelson Mandela Drive.",
        time: "18:04",
      },
    ],
  },
  parts: {
    shop: "Parts counter",
    status: "quoting",
    mood: "parts",
    line: "Draft is with the counter",
    messages: [
      { from: "them", text: "Front brake pads for a 2018 Polo 1.4", time: "11:16" },
      {
        from: "bot",
        text: "2018 Volkswagen Polo 1.4. I’m checking your fitment list, not guessing a part.",
        time: "11:16",
      },
      { from: "note", text: "2 matches on the shelf · draft with the counter" },
      {
        from: "bot",
        text: "Two pads fit. The PDF lands here only after someone presses Approve & send.",
        time: "11:17",
      },
    ],
  },
  bookings: {
    shop: "Cool Cuts",
    status: "bookings",
    mood: "bookings",
    line: "Reminder the day before",
    messages: [
      { from: "note", text: "Booked on the public link" },
      {
        from: "bot",
        text: "Cool Cuts · fade and beard · tomorrow 14:00. You’re in. I’ll message you the day before.",
        time: "09:12",
      },
      { from: "note", text: "24 hours before" },
      {
        from: "bot",
        text: "Reminder from Cool Cuts. Fade and beard today at 14:00. Reply if you need to move it.",
        time: "14:00",
      },
    ],
  },
};

const ORDER = ["counter", "parts", "bookings"];
const thread = document.querySelector("#thread");
const phone = document.querySelector("#phone");
const shopName = document.querySelector("#phone-shop");
const shopStatus = document.querySelector("#phone-status");
const sceneStatus = document.querySelector("#scene-status");
const tabs = [...document.querySelectorAll("[data-scene][role='tab']")];
const cases = [...document.querySelectorAll(".case")];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;
const desktop = window.matchMedia("(min-width: 861px)");

let token = 0;
let current = "";
let holdSpyUntil = 0;

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function messageNode(message) {
  if (message.from === "note") {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = message.text;
    return note;
  }

  const item = document.createElement("article");
  item.className = `bubble ${message.from === "bot" ? "bubble-bot" : "bubble-them"}`;
  const body = document.createElement("p");
  body.textContent = message.text;
  const meta = document.createElement("span");
  meta.className = "bubble-meta";
  meta.textContent = message.time;
  item.append(body, meta);
  return item;
}

function typingNode() {
  const node = document.createElement("p");
  node.className = "typing";
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = "<i></i><i></i><i></i>";
  return node;
}

async function showScene(key, { animate = false, force = false } = {}) {
  const scene = SCENES[key];
  if (!scene || !thread) return;
  if (key === current && !force) return;

  current = key;
  const run = ++token;
  document.body.dataset.mood = scene.mood;
  shopName.textContent = scene.shop;
  shopStatus.textContent = scene.status;
  if (sceneStatus) sceneStatus.textContent = `${scene.shop} sample chat`;

  tabs.forEach((tab) => {
    const selected = tab.dataset.scene === key;
    tab.setAttribute("aria-selected", selected ? "true" : "false");
    tab.tabIndex = selected ? 0 : -1;
  });
  cases.forEach((item) => {
    item.classList.toggle("is-current", item.dataset.scene === key);
  });

  thread.replaceChildren();
  phone?.classList.remove("is-shifting");
  if (animate && !reduceMotion) {
    phone?.classList.add("is-shifting");
    window.setTimeout(() => phone?.classList.remove("is-shifting"), 420);
  }

  for (const message of scene.messages) {
    if (run !== token) return;
    const step = animate && !reduceMotion;
    if (step && message.from === "bot") {
      const typing = typingNode();
      thread.append(typing);
      thread.scrollTop = thread.scrollHeight;
      await wait(380);
      if (run !== token) return;
      typing.remove();
    } else if (step) {
      await wait(160);
      if (run !== token) return;
    }
    thread.append(messageNode(message));
    thread.scrollTop = thread.scrollHeight;
  }
}

function selectScene(key, { scroll = false } = {}) {
  holdSpyUntil = performance.now() + 1200;
  showScene(key, { animate: true, force: true });
  if (scroll) {
    document.getElementById(key)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectScene(tab.dataset.scene, { scroll: desktop.matches }));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index + tabs.length - 1) % tabs.length;
    tabs[next].focus();
    selectScene(tabs[next].dataset.scene, { scroll: desktop.matches });
  });
});

let touchStart = null;
phone?.addEventListener("touchstart", (event) => {
  const point = event.changedTouches[0];
  touchStart = { x: point.clientX, y: point.clientY };
}, { passive: true });

phone?.addEventListener("touchend", (event) => {
  if (!touchStart) return;
  const point = event.changedTouches[0];
  const dx = point.clientX - touchStart.x;
  const dy = point.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
  const index = ORDER.indexOf(current);
  const next = dx < 0 ? Math.min(index + 1, ORDER.length - 1) : Math.max(index - 1, 0);
  if (ORDER[next] !== current) selectScene(ORDER[next]);
}, { passive: true });

const ratios = new Map();
const caseObserver = new IntersectionObserver((entries) => {
  if (!desktop.matches || performance.now() < holdSpyUntil) return;
  entries.forEach((entry) => ratios.set(entry.target.dataset.scene, entry.isIntersecting ? entry.intersectionRatio : 0));
  let best = null;
  let bestRatio = 0.35;
  ratios.forEach((ratio, key) => {
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = key;
    }
  });
  if (best) showScene(best, { animate: true });
}, { threshold: [0, 0.25, 0.5, 0.75, 1] });

cases.forEach((item) => caseObserver.observe(item));

const header = document.querySelector(".site-header");
const progress = document.querySelector("#progress");

function onScroll() {
  header?.classList.toggle("is-scrolled", window.scrollY > 8);
  const height = document.documentElement.scrollHeight - window.innerHeight;
  if (progress) progress.style.transform = `scaleX(${height > 0 ? window.scrollY / height : 0})`;
}

document.addEventListener("scroll", onScroll, { passive: true });
onScroll();

if (finePointer && !reduceMotion) {
  window.addEventListener("pointermove", (event) => {
    document.documentElement.style.setProperty("--gx", `${event.clientX}px`);
    document.documentElement.style.setProperty("--gy", `${event.clientY}px`);
  }, { passive: true });
}

showScene("counter", { animate: true, force: true });

const brief = document.querySelector("#brief");
const result = document.querySelector("#brief-result");
const resultText = document.querySelector("#brief-text");
const studioNumber = (document.body.dataset.studioWhatsapp || STUDIO_WHATSAPP).replace(/\D/g, "");
const submitButton = brief?.querySelector("[type=submit]");

if (!studioNumber && submitButton) submitButton.textContent = "Copy WhatsApp brief";

function fieldValue(name) {
  const field = brief.elements[name];
  return field ? field.value.trim() : "";
}

function setInvalid(name, invalid) {
  const field = brief.elements[name];
  if (!field) return;
  field.setAttribute("aria-invalid", invalid ? "true" : "false");
  const error = brief.querySelector(`[data-error-for="${name}"]`);
  if (error) error.hidden = !invalid;
}

brief?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = fieldValue("name");
  const business = fieldValue("business");
  const agent = fieldValue("agent");
  const note = fieldValue("note");
  const missingName = name.length < 2;
  const missingBusiness = business.length < 2;
  const missingAgent = agent === "";

  setInvalid("name", missingName);
  setInvalid("business", missingBusiness);
  setInvalid("agent", missingAgent);

  if (missingName || missingBusiness || missingAgent) {
    brief.querySelector("[aria-invalid='true']")?.focus();
    return;
  }

  const lines = ["New agent brief", `Name: ${name}`, `Business: ${business}`, `Agent: ${agent}`];
  if (note) lines.push("", note);
  const text = lines.join("\n");
  resultText.textContent = text;
  result.hidden = false;

  const status = document.querySelector("#brief-status");
  if (studioNumber) {
    status.textContent = "Opening WhatsApp with this brief.";
    window.open(`https://wa.me/${studioNumber}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    return;
  }

  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = false;
  }
  status.textContent = copied
    ? "Copied. Paste it into WhatsApp."
    : "Copy the brief below and paste it into WhatsApp.";
});

const year = document.querySelector("#year");
if (year) year.textContent = String(new Date().getFullYear());
