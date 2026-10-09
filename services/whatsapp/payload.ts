/**
 * Build a Meta-shaped inbound webhook. Used by the local playground so the same
 * processor that handles a live WhatsApp message can be driven from the browser
 * without talking to Meta.
 */
export function inboundTextPayload(opts: {
  phoneNumberId: string;
  from: string;
  text: string;
  name?: string;
  id?: string;
}) {
  return envelope({
    phoneNumberId: opts.phoneNumberId,
    from: opts.from,
    name: opts.name,
    id: opts.id,
    type: "text",
    text: { body: opts.text },
  });
}

export function inboundButtonPayload(opts: {
  phoneNumberId: string;
  from: string;
  replyId: string;
  title: string;
  name?: string;
  id?: string;
}) {
  return envelope({
    phoneNumberId: opts.phoneNumberId,
    from: opts.from,
    name: opts.name,
    id: opts.id,
    type: "interactive",
    interactive: { type: "button_reply", button_reply: { id: opts.replyId, title: opts.title } },
  });
}

export function inboundListPayload(opts: {
  phoneNumberId: string;
  from: string;
  replyId: string;
  title: string;
  name?: string;
  id?: string;
}) {
  return envelope({
    phoneNumberId: opts.phoneNumberId,
    from: opts.from,
    name: opts.name,
    id: opts.id,
    type: "interactive",
    interactive: { type: "list_reply", list_reply: { id: opts.replyId, title: opts.title } },
  });
}

function envelope(opts: {
  phoneNumberId: string;
  from: string;
  name?: string;
  id?: string;
  type: string;
  text?: { body: string };
  interactive?: Record<string, unknown>;
}) {
  const id = opts.id ?? `wamid.PLAY${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "27182975500", phone_number_id: opts.phoneNumberId },
              contacts: [{ profile: { name: opts.name ?? "You" }, wa_id: opts.from }],
              messages: [
                {
                  from: opts.from,
                  id,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: opts.type,
                  ...(opts.text ? { text: opts.text } : {}),
                  ...(opts.interactive ? { interactive: opts.interactive } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
