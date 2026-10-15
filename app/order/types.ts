export interface MenuOption {
  id: string;
  name: string;
  description: string | null;
  priceDeltaCents: number;
}

export interface MenuModifier {
  groupId: string;
  name: string;
  prompt: string;
  selection: "SINGLE" | "MULTIPLE";
  minSelect: number;
  maxSelect: number;
  required: boolean;
  scope: "ALWAYS" | "MEAL_ONLY";
  options: MenuOption[];
}

export interface MenuItem {
  id: string;
  name: string;
  shortName: string | null;
  description: string | null;
  priceCents: number;
  mealUpgradeCents: number | null;
  mealDescription: string | null;
  imageUrl: string;
  modifiers: MenuModifier[];
}

export interface MenuCategory {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string;
  items: MenuItem[];
}

export interface OrderMenuPayload {
  store: {
    id: string;
    name: string;
    city: string;
    addressLine: string;
    acceptingOrders: boolean;
    pausedReason: string | null;
    webEnabled: boolean;
    billingStatus: "ACTIVE" | "PAST_DUE" | "SUSPENDED";
    suspendedReason: string | null;
    defaultPrepMinutes: number;
    deliveryEnabled: boolean;
    deliveryFeeCents: number;
    whatsappDisplay: string | null;
  };
  brand: {
    logo: string;
    mark: string;
    hero: string;
    zeeFlavours: string;
    pattern: string;
  };
  orderUrl: string;
  categories: MenuCategory[];
}

export interface CartModifierChoice {
  groupId: string;
  groupName: string;
  optionIds: string[];
  optionNames: string[];
  priceDeltaCents: number;
}

export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  imageUrl: string;
  quantity: number;
  unitPriceCents: number;
  mealUpgradeCents: number;
  isMeal: boolean | null;
  mealDescription: string | null;
  modifiers: CartModifierChoice[];
  notes?: string;
}

export function lineTotalCents(line: CartLine): number {
  const meal = line.isMeal ? line.mealUpgradeCents : 0;
  const mods = line.modifiers.reduce((sum, m) => sum + m.priceDeltaCents, 0);
  return (line.unitPriceCents + meal + mods) * line.quantity;
}
