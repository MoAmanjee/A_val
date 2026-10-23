/* Studio number: digits only, country code included, no plus.
   Example: "27821234567". Leave empty until the number is ready. */
const STUDIO_WHATSAPP = "";

const SCENES = {
  counter: {
    shop: "Mochachos Potch",
    status: "orders",
    messages: [
      {
        from: "them",
        text: "Hot quarter chicken meal with a Coke, collection",
        time: "18:02",
      },
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
    messages: [
      {
        from: "them",
        text: "Front brake pads for a 2018 Polo 1.4",
        time: "11:16",
      },
      {
        from: "bot",
        text: "2018 Volkswagen Polo 1.4. I’m checking your fitment list, not guessing a part.",
        time: "11:16",
      },
      { from: "note", text: "2 matches on the shelf · draft with the counter" },
      {
        from: "bot",
        text: "Two pads fit. The counter is checking the quote. The PDF lands here only after someone presses Approve & send.",
        time: "11:17",
      },
    ],
  },
  bookings: {
    shop: "Cool Cuts",
    status: "bookings",
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

const thread = document.querySelector("#thread");
const shopName = document.querySelector("#phone-shop");
const shopStatus = document.querySelector("#phone-status");
const tabs = [...document.querySelectorAll("[data-scene]")];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

function showScene(key, animate) {
  const scene = SCENES[key];
  if (!scene || !thread) return;

  shopName.textContent = scene.shop;
  shopStatus.textContent = scene.status;
  thread.replaceChildren();

  scene.messages.forEach((message, index) => {
    const node = messageNode(message);
    if (animate && !reduceMotion) {
      node.classList.add("is-waiting");
      window.setTimeout(() => {
        node.classList.remove("is-waiting");
        thread.scrollTop = thread.scrollHeight;
      }, 220 * index + 40);
    }
    thread.append(node);
  });

  tabs.forEach((tab) => {
    const selected = tab.dataset.scene === key;
    tab.setAttribute("aria-selected", selected ? "true" : "false");
  });

  thread.dataset.scene = key;
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => showScene(tab.dataset.scene, true));
});

document.querySelector("#replay")?.addEventListener("click", () => {
  showScene(thread?.dataset.scene || "counter", true);
});

showScene("counter", true);

const brief = document.querySelector("#brief");
const result = document.querySelector("#brief-result");
const resultText = document.querySelector("#brief-text");
const studioNumber = (document.body.dataset.studioWhatsapp || STUDIO_WHATSAPP).replace(/\D/g, "");
const submitButton = brief?.querySelector("[type=submit]");

if (!studioNumber && submitButton) {
  submitButton.textContent = "Copy WhatsApp brief";
}

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
    const firstInvalid = brief.querySelector("[aria-invalid='true']");
    firstInvalid?.focus();
    return;
  }

  const lines = [
    "New agent brief",
    `Name: ${name}`,
    `Business: ${business}`,
    `Agent: ${agent}`,
  ];
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

document.querySelector("#year").textContent = String(new Date().getFullYear());
