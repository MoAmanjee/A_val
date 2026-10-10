/**
 * Every button and list row the bot sends carries one of these ids, and Meta
 * echoes it back verbatim when the customer taps it. That is what lets a tap be
 * applied to the exact item and question it was asked about, with no guessing
 * and no AI call - even if the customer taps a button from ten minutes ago.
 *
 * Format is "kind:arg:arg". Ids must stay under 256 characters, which cuid
 * identifiers comfortably do.
 */

export type ReplyAction =
  /** Show the items in a menu category. `page` walks past WhatsApp's 10-row cap. */
  | { kind: "category"; categoryId: string; page?: number }
  /** Go back to the list of categories. `page` walks past the 10-row cap. */
  | { kind: "categories"; page?: number }
  /** Send the printed menu pictures. */
  | { kind: "menuPhotos" }
  /** The customer would rather type the whole order than tap the menu. */
  | { kind: "typeOrder" }
  /** Add a menu item to the basket. */
  | { kind: "item"; menuItemId: string }
  /** Answer a modifier question (basting, side, drink, extra). */
  | { kind: "modifier"; orderItemId: string; optionId: string }
  /** Decline an optional modifier group. */
  | { kind: "modifierSkip"; orderItemId: string; groupId: string }
  /** Answer "would you like that as a meal?". */
  | { kind: "meal"; orderItemId: string; yes: boolean }
  /** Answer "anything else?". */
  | { kind: "anythingElse"; done: boolean }
  /** Collection from the shop, or delivery to an address. */
  | { kind: "fulfilment"; mode: "COLLECTION" | "DELIVERY" }
  /** Answer the order confirmation. */
  | { kind: "confirm"; answer: "yes" | "change" | "cancel" }
  /** Answer "are you sure you want to cancel?". */
  | { kind: "cancelOrder"; yes: boolean }
  /** Ask for a staff member. */
  | { kind: "human" }
  /** Back to Confirm order, Add to order, and Cancel order. */
  | { kind: "basket" }
  /** Skip the optional driver note. */
  | { kind: "deliveryNote"; skip: true };

export function encodeReplyId(action: ReplyAction): string {
  switch (action.kind) {
    case "category":
      return action.page ? `cat:${action.categoryId}:${action.page}` : `cat:${action.categoryId}`;
    case "categories":
      return action.page ? `cats:${action.page}` : "cats";
    case "menuPhotos":
      return "photos";
    case "typeOrder":
      return "type";
    case "item":
      return `item:${action.menuItemId}`;
    case "modifier":
      return `mod:${action.orderItemId}:${action.optionId}`;
    case "modifierSkip":
      return `modskip:${action.orderItemId}:${action.groupId}`;
    case "meal":
      return `meal:${action.orderItemId}:${action.yes ? "y" : "n"}`;
    case "anythingElse":
      return `else:${action.done ? "done" : "add"}`;
    case "fulfilment":
      return action.mode === "COLLECTION" ? "fulfil:collect" : "fulfil:deliver";
    case "confirm":
      return `confirm:${action.answer}`;
    case "cancelOrder":
      return `cancel:${action.yes ? "y" : "n"}`;
    case "human":
      return "human";
    case "basket":
      return "basket";
    case "deliveryNote":
      return "dnote:skip";
  }
}

export function decodeReplyId(raw: string | undefined | null): ReplyAction | null {
  if (!raw) return null;
  const [kind, a, b] = raw.split(":");
  switch (kind) {
    case "cat": {
      if (!a) return null;
      const page = b ? Number(b) : 0;
      return { kind: "category", categoryId: a, page: Number.isFinite(page) && page > 0 ? page : 0 };
    }
    case "cats": {
      const page = a ? Number(a) : 0;
      return page > 0 && Number.isFinite(page) ? { kind: "categories", page } : { kind: "categories" };
    }
    case "photos":
      return { kind: "menuPhotos" };
    case "type":
      return { kind: "typeOrder" };
    case "item":
      return a ? { kind: "item", menuItemId: a } : null;
    case "mod":
      return a && b ? { kind: "modifier", orderItemId: a, optionId: b } : null;
    case "modskip":
      return a && b ? { kind: "modifierSkip", orderItemId: a, groupId: b } : null;
    case "meal":
      return a && (b === "y" || b === "n") ? { kind: "meal", orderItemId: a, yes: b === "y" } : null;
    case "else":
      return a === "done" || a === "add" ? { kind: "anythingElse", done: a === "done" } : null;
    case "fulfil":
      if (a === "collect") return { kind: "fulfilment", mode: "COLLECTION" };
      if (a === "deliver") return { kind: "fulfilment", mode: "DELIVERY" };
      return null;
    case "confirm":
      return a === "yes" || a === "change" || a === "cancel" ? { kind: "confirm", answer: a } : null;
    case "cancel":
      return a === "y" || a === "n" ? { kind: "cancelOrder", yes: a === "y" } : null;
    case "human":
      return { kind: "human" };
    case "basket":
      return { kind: "basket" };
    case "dnote":
      return a === "skip" ? { kind: "deliveryNote", skip: true } : null;
    default:
      return null;
  }
}
