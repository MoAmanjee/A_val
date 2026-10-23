(function () {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const desktopNav = window.matchMedia("(min-width: 960px)");
  const cfg = window.M3_CONFIG || {};

  const whatsapp = cleanWhatsapp(cfg.whatsapp);
  const leadEndpoint = cleanEndpoint(cfg.leadEndpoint);

  const header = document.querySelector(".site-header");
  const menuToggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".site-nav");

  initYear();
  initHeader();
  initWhatsApp();
  initDeliveryNote();
  initPresets();
  initDemo();
  initForm();
  initAnalytics();

  function initYear() {
    document.querySelectorAll("[data-year]").forEach((node) => {
      node.textContent = String(new Date().getFullYear());
    });
  }

  function initHeader() {
    if (!header || !menuToggle || !nav) return;

    const setOpen = (open) => {
      header.classList.toggle("is-open", open);
      menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
      menuToggle.textContent = open ? "Close" : "Menu";
      document.body.classList.toggle("nav-open", open);
    };

    menuToggle.addEventListener("click", () => {
      setOpen(!header.classList.contains("is-open"));
    });

    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });

    const onScroll = () => {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    desktopNav.addEventListener("change", () => setOpen(false));
  }

  function initWhatsApp() {
    document.querySelectorAll("[data-whatsapp-link]").forEach((link) => {
      if (!whatsapp) return;
      link.href = `https://wa.me/${whatsapp}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.dataset.whatsappReady = "true";
    });

    document.querySelectorAll("[data-whatsapp-missing]").forEach((node) => {
      node.hidden = Boolean(whatsapp);
    });
  }

  function initDeliveryNote() {
    const note = document.querySelector("[data-delivery-note]");
    if (!note) return;
    if (leadEndpoint) {
      note.textContent = "The form delivers to the enquiry inbox. A confirmation appears only after that inbox accepts it. Details are used to respond to this request.";
      return;
    }
    if (whatsapp) {
      note.textContent = "Sending the form opens WhatsApp with your enquiry written out. You still press send in WhatsApp. You can also message that chat directly.";
      return;
    }
    note.textContent = "The WhatsApp number and the enquiry inbox are not connected on this site yet. You can complete the form. It will not be marked as sent.";
  }

  function initPresets() {
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-preset-service], [data-open-demo]");
      if (!trigger) return;

      const service = trigger.getAttribute("data-preset-service");
      const industry = trigger.getAttribute("data-preset-industry");
      if (service) setSelect("service", service);
      if (industry) setSelect("industry", industry);

      const demoId = trigger.getAttribute("data-open-demo");
      if (demoId) {
        event.preventDefault();
        openDemo(demoId);
        const demo = document.getElementById("demo");
        if (demo) demo.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }
    });
  }

  function setSelect(name, value) {
    const field = document.querySelector(`#quote-form [name="${name}"]`);
    if (!field) return;
    const hasOption = [...field.options].some((option) => option.value === value);
    if (hasOption) field.value = value;
  }

  function initDemo() {
    const root = document.querySelector("[data-demo]");
    if (!root) return;

    const thread = root.querySelector("[data-demo-thread]");
    const form = root.querySelector("[data-demo-form]");
    const input = root.querySelector("[data-demo-input]");
    const tabs = [...root.querySelectorAll("[data-demo-industry]")];
    const status = root.querySelector("[data-demo-status]");
    let industry = "restaurant";
    let replyToken = 0;

    const scripts = {
      restaurant: {
        name: "Sample Kitchen",
        welcome: "Welcome to the Sample Kitchen preview. Ask about hours, the menu, or a table. This is a scripted demonstration. It will not book, order, or contact a restaurant.",
        suggestions: ["Opening hours", "What is on the menu?", "Book a table", "Can I place an order?"],
        answers: [
          { test: /hour|open|close|when/i, text: "Sample hours are Tuesday to Sunday, 11:00 to 21:00. A live assistant would use the hours you provide, including days you are closed." },
          { test: /menu|food|dish|eat|drink|price|cost/i, text: "The sample menu is only a stand-in for lunch and dinner. A customised assistant reads your dishes and your prices. This preview does not invent a bill." },
          { test: /book|table|reserv|tonight|party/i, text: "A booking assistant would ask for a name, party size, date, and time, then hand that to the restaurant. This preview does not look at a diary and does not reserve a table." },
          { test: /order|deliver|collect|takeaway/i, text: "Ordering can be scoped for collection or delivery. This preview will not send anything to a kitchen or add a delivery fee." },
          { test: /where|address|location|find/i, text: "Sample Kitchen is not a real place and has no street address. Your assistant would share the address and collection point you publish." },
          { test: /person|human|staff|manager/i, text: "When a question sits outside the notes it was given, the assistant should hand the chat to a person. This preview cannot reach your staff." },
        ],
      },
      salon: {
        name: "Sample Studio",
        welcome: "Welcome to the Sample Studio preview. Ask about services, hours, or an appointment. Nothing here is written into a booking book.",
        suggestions: ["Which services?", "Opening hours", "Book an appointment", "How much is a cut?"],
        answers: [
          { test: /service|offer|treatment|colour|color|cut|beard/i, text: "The sample list is a cut, a colour consultation, and a treatment. Your assistant would list the services you actually sell, in your words." },
          { test: /hour|open|close|when/i, text: "Sample hours are Wednesday to Saturday, 09:00 to 17:00. Your hours, including a day you are closed, replace these." },
          { test: /book|appoint|chair|today|tomorrow/i, text: "A booking flow would collect the service, a preferred day, and a number to confirm on. This preview does not hold a chair or send a reminder." },
          { test: /price|cost|how much|fee/i, text: "This preview will not invent a price. A live assistant quotes only figures you have supplied." },
          { test: /person|human|staff/i, text: "Questions the assistant has not been given go to a person. This preview cannot message the studio." },
        ],
      },
      retail: {
        name: "Sample Store",
        welcome: "Welcome to the Sample Store preview. Ask about products, hours, or help with a purchase. This preview is not connected to stock or a till.",
        suggestions: ["Do you have this product?", "Opening hours", "How do I buy?", "What does it cost?"],
        answers: [
          { test: /product|stock|item|size|have/i, text: "A store assistant can describe a product and tell the customer when a person must confirm stock. This preview cannot see a shelf." },
          { test: /hour|open|close|when/i, text: "Sample hours are Monday to Saturday, 09:00 to 18:00, and Sunday 10:00 to 14:00. Your published hours would be used instead." },
          { test: /buy|purchase|pay|deliver|collect|order/i, text: "A customised assistant can guide a customer toward a purchase or a collection enquiry when that path is in scope. This preview does not take payment." },
          { test: /price|cost|how much/i, text: "No sample price is shown, because a made-up price would be misleading. Your assistant uses your price list." },
          { test: /person|human|staff/i, text: "If stock, a discount, or a return needs a person, the chat should be handed over. This preview stops at the explanation." },
        ],
      },
      professional: {
        name: "Sample Practice",
        welcome: "Welcome to the Sample Practice preview. Ask what the practice helps with, or how to request an appointment. This is not advice, and it does not create a client file.",
        suggestions: ["What do you help with?", "Request an appointment", "Opening hours", "Speak to a person"],
        answers: [
          { test: /help|service|offer|advice|consult/i, text: "The sample practice explains its services and invites a consultation request. It does not give professional advice, and a live assistant should not either unless you have set the exact answers." },
          { test: /book|appoint|consult|meet/i, text: "An appointment request would collect the topic, a preferred time, and contact details for the practice to confirm. This preview does not schedule anyone." },
          { test: /hour|open|close|when/i, text: "Sample hours are Monday to Friday, 08:00 to 16:30. Your real diary hours replace these." },
          { test: /person|human|staff|call/i, text: "A person should take anything the assistant was not given, including advice. This preview cannot transfer a call." },
          { test: /price|cost|fee|how much/i, text: "Fees depend on the matter. This preview will not quote one. Your assistant can share only the fee notes you approve." },
        ],
      },
    };

    const customReply = "A customised assistant is built around your services, your prices, and the way customers already reach you. Use the quote form and describe what they ask all day. This window will not send that request.";

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => selectIndustry(tab.dataset.demoIndustry));
    });

    root.querySelector("[data-demo-tabs]")?.addEventListener("keydown", (event) => {
      const current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
      if (current < 0) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const next = event.key === "ArrowRight" ? (current + 1) % tabs.length : (current - 1 + tabs.length) % tabs.length;
      tabs[next].focus();
      selectIndustry(tabs[next].dataset.demoIndustry);
    });

    root.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-ask]");
      if (!chip) return;
      ask(chip.dataset.ask);
    });

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      ask(text);
    });

    selectIndustry("restaurant");

    function selectIndustry(id) {
      if (!scripts[id]) return;
      industry = id;
      replyToken += 1;
      tabs.forEach((tab) => {
        const on = tab.dataset.demoIndustry === id;
        tab.setAttribute("aria-selected", on ? "true" : "false");
        tab.tabIndex = on ? 0 : -1;
      });
      thread.replaceChildren();
      addBubble("bot", scripts[id].welcome);
      renderSuggestions();
      if (status) status.textContent = `${scripts[id].name}. Scripted demonstration.`;
    }

    function renderSuggestions() {
      const box = root.querySelector("[data-demo-suggestions]");
      box.replaceChildren();
      scripts[industry].suggestions.forEach((label) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.ask = label;
        button.textContent = label;
        box.appendChild(button);
      });
    }

    function ask(text) {
      addBubble("them", text);
      const token = ++replyToken;
      const reply = answerFor(text);
      const wait = reduceMotion ? 0 : 280;
      window.setTimeout(() => {
        if (token !== replyToken) return;
        addBubble("bot", reply);
      }, wait);
    }

    function answerFor(text) {
      if (/custom|quote|my business|build one|for my|m³|m3/i.test(text)) return customReply;
      const found = scripts[industry].answers.find((item) => item.test.test(text));
      if (found) return found.text;
      return "This preview only answers a fixed set of questions for the sample business. Try a suggestion below, or ask for a customised version. A live assistant would use your own information.";
    }

    function addBubble(from, text) {
      const item = document.createElement("article");
      item.className = `bubble bubble-${from}`;
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      item.appendChild(paragraph);
      thread.appendChild(item);
      while (thread.children.length > 8) thread.firstChild.remove();
      thread.scrollTop = thread.scrollHeight;
    }

    function openDemo(id) {
      if (scripts[id]) selectIndustry(id);
    }

    root.openDemo = openDemo;
  }

  function openDemo(id) {
    const root = document.querySelector("[data-demo]");
    if (root && typeof root.openDemo === "function") root.openDemo(id);
  }

  function initForm() {
    const form = document.querySelector("#quote-form");
    if (!form) return;

    const status = form.querySelector("[data-form-status]");
    const submit = form.querySelector("[type='submit']");
    const defaultLabel = submit.textContent;
    let sending = false;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (sending) return;
      clearErrors(form);
      status.textContent = "";
      status.className = "form-status";

      const payload = {
        name: valueOf(form, "name").trim(),
        business: valueOf(form, "business").trim(),
        email: valueOf(form, "email").trim(),
        phone: valueOf(form, "phone").trim(),
        industry: valueOf(form, "industry"),
        service: valueOf(form, "service"),
        details: valueOf(form, "details").trim(),
        consent: form.elements.consent.checked,
        source: "m3-technologies-website",
      };

      if (valueOf(form, "company_url").trim()) {
        status.classList.add("is-error");
        status.textContent = "Enquiry not sent.";
        return;
      }

      const errors = validate(payload);
      if (Object.keys(errors).length) {
        showErrors(form, errors);
        status.classList.add("is-error");
        status.textContent = "Complete the highlighted fields before this enquiry can be prepared.";
        return;
      }

      sending = true;
      submit.disabled = true;

      try {
        if (leadEndpoint) {
          submit.textContent = "Sending";
          await postLead(payload);
          form.reset();
          status.classList.add("is-success");
          status.textContent = "Enquiry received. We will use these details only to contact you about this request.";
          return;
        }
        if (whatsapp) {
          submit.textContent = "Opening WhatsApp";
          const link = `https://wa.me/${whatsapp}?text=${encodeURIComponent(formatLead(payload))}`;
          const opened = window.open(link, "_blank", "noopener,noreferrer");
          status.classList.add("is-pending");
          status.textContent = opened
            ? "WhatsApp opened with your enquiry. Press send there to deliver it. It is not received until you do."
            : "WhatsApp was blocked by the browser. Allow pop-ups, or use the WhatsApp button and paste the enquiry.";
          return;
        }
        status.classList.add("is-error");
        status.textContent = "Enquiry not sent. WhatsApp and the enquiry inbox are not connected yet, so nothing was stored.";
      } catch (error) {
        status.classList.add("is-error");
        status.textContent = error.message || "Enquiry not sent.";
      } finally {
        sending = false;
        submit.disabled = false;
        submit.textContent = defaultLabel;
      }
    });
  }

  function validate(payload) {
    const errors = {};
    if (payload.name.length < 2) errors.name = "Add your name.";
    if (payload.business.length < 2) errors.business = "Add the business name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) errors.email = "Add a valid email address.";
    if (payload.phone.replace(/\D/g, "").length < 8) errors.phone = "Add a WhatsApp or contact number.";
    if (!payload.industry) errors.industry = "Choose an industry.";
    if (!payload.service) errors.service = "Choose a service.";
    if (payload.details.length < 8) errors.details = "Add a short description of what you need.";
    if (!payload.consent) errors.consent = "Confirm that we may contact you about this enquiry.";
    return errors;
  }

  function showErrors(form, errors) {
    Object.entries(errors).forEach(([name, message]) => {
      const field = form.querySelector(`[data-error-for="${name}"]`);
      if (!field) return;
      field.textContent = message;
      field.hidden = false;
      const input = form.elements[name];
      if (input) input.setAttribute("aria-invalid", "true");
    });
    const first = form.querySelector("[aria-invalid='true']");
    first?.focus();
  }

  function clearErrors(form) {
    form.querySelectorAll("[data-error-for]").forEach((node) => {
      node.hidden = true;
      node.textContent = "";
    });
    [...form.elements].forEach((field) => field.removeAttribute("aria-invalid"));
  }

  async function postLead(payload) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(leadEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Enquiry not sent. The inbox did not accept it, so it has not been received.");
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Enquiry not sent. The inbox took too long to answer.");
      if (error.message.startsWith("Enquiry not sent")) throw error;
      throw new Error("Enquiry not sent. The inbox could not be reached.");
    } finally {
      window.clearTimeout(timer);
    }
  }

  function formatLead(payload) {
    return [
      "Quote request — M³ Technologies",
      `Name: ${payload.name}`,
      `Business: ${payload.business}`,
      `Email: ${payload.email}`,
      `Phone: ${payload.phone}`,
      `Industry: ${payload.industry}`,
      `Service: ${payload.service}`,
      `Needs: ${payload.details}`,
      "Consent: yes, contact me about this enquiry",
    ].join("\n");
  }

  function valueOf(form, name) {
    const field = form.elements[name];
    return field ? String(field.value || "") : "";
  }

  function initAnalytics() {
    const banner = document.querySelector("[data-analytics-banner]");
    const provider = String(cfg.analyticsProvider || "");
    const id = String(cfg.analyticsId || "");
    const domain = String(cfg.analyticsDomain || "");
    const enabled = provider === "plausible" || provider === "ga4";
    if (!banner || !enabled) return;
    if (provider === "ga4" && !/^G-[A-Za-z0-9]+$/.test(id)) return;
    if (provider === "plausible" && !/^[a-z0-9.-]+$/i.test(domain)) return;

    const key = "m3-analytics-choice";
    const choice = localStorage.getItem(key);
    if (choice === "granted") {
      loadAnalytics(provider, id, domain);
      return;
    }
    if (choice === "denied") return;

    banner.hidden = false;
    banner.querySelector("[data-analytics-allow]")?.addEventListener("click", () => {
      localStorage.setItem(key, "granted");
      banner.hidden = true;
      loadAnalytics(provider, id, domain);
    });
    banner.querySelector("[data-analytics-deny]")?.addEventListener("click", () => {
      localStorage.setItem(key, "denied");
      banner.hidden = true;
    });
  }

  function loadAnalytics(provider, id, domain) {
    if (document.querySelector("[data-m3-analytics]")) return;
    const script = document.createElement("script");
    script.dataset.m3Analytics = provider;
    if (provider === "plausible") {
      script.defer = true;
      script.dataset.domain = domain;
      script.src = "https://plausible.io/js/script.js";
      document.head.appendChild(script);
      return;
    }
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(script);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    gtag("js", new Date());
    gtag("config", id, { anonymize_ip: true });
  }

  function fillPrivacy() {
    const box = document.querySelector("[data-privacy-contact]");
    if (!box) return;
    const email = String(cfg.contactEmail || "").trim();
    const address = String(cfg.operatorAddress || "").trim();
    const lines = [];
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) lines.push(`Email: ${email}`);
    if (whatsapp) lines.push(`WhatsApp: +${whatsapp}`);
    if (address) lines.push(address);
    box.textContent = lines.length
      ? lines.join("\n")
      : "A public email address and street address have not been added to this notice yet. Until they are, use the quote form on the home page. If WhatsApp is connected, that chat is the direct line.";
  }

  fillPrivacy();

  function cleanWhatsapp(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return /^\d{8,15}$/.test(digits) ? digits : "";
  }

  function cleanEndpoint(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "https:") return "";
      return url.toString();
    } catch {
      return "";
    }
  }
})();
