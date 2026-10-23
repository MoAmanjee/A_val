/**
 * The Mochachos Potchefstroom CBD catalogue, taken from the Mochachos RSA 2026
 * menu.
 *
 * This is the starting point the seeder loads into the database. It is NOT the
 * runtime source of truth: once seeded, staff change prices, flavours and
 * sold-out flags in the database and the bot picks them up on the next message.
 *
 * Two things worth knowing when editing:
 *
 * - Sizes and fillings are modelled as modifier groups rather than separate
 *   items, so "Chips" is one menu row that asks Beeg / Beeger / Beegest. The
 *   price difference lives on the option, which is why each size group is
 *   per-item: a Beegest chips is +R35 while a Beegest onion rings is +R30.
 *
 * - A meal upgrade is priced off the matching Combinacion combo, so ordering
 *   "Chicken Burger, Beeg Chips & Buddy" directly and upgrading a Chicken
 *   Burger to a meal come to the same total.
 */

/** Rand to cents, so the prices below read like the menu board. */
const R = (rands: number): number => Math.round(rands * 100);

export interface ModifierOptionSeed {
  name: string;
  description?: string;
  priceDeltaCents?: number;
  posCode?: string;
}

export interface ModifierGroupSeed {
  name: string;
  /** Exact question the bot asks. */
  prompt: string;
  selection: "SINGLE" | "MULTIPLE";
  minSelect: number;
  maxSelect: number;
  options: ModifierOptionSeed[];
}

export interface ModifierRef {
  group: string;
  /** Required groups block the order from being confirmed. Defaults to true. */
  required?: boolean;
  /** MEAL_ONLY is only asked once the item is upgraded to a meal. */
  scope?: "ALWAYS" | "MEAL_ONLY";
}

export interface MenuItemSeed {
  name: string;
  /** Used for WhatsApp list rows when the full name is over 24 characters. */
  shortName?: string;
  description?: string;
  priceCents: number;
  posCode?: string;
  mealUpgradeCents?: number;
  mealDescription?: string;
  modifiers?: ModifierRef[];
}

export interface CategorySeed {
  name: string;
  description?: string;
  items: MenuItemSeed[];
}

export interface FaqSeed {
  question: string;
  answer: string;
  keywords: string[];
}

export interface MenuImageSeed {
  filePath: string;
  caption?: string;
  isDocument?: boolean;
  fileName?: string;
  mimeType?: string;
}

export interface MenuSeed {
  modifierGroups: ModifierGroupSeed[];
  categories: CategorySeed[];
  faqs: FaqSeed[];
  images: MenuImageSeed[];
}

// ---------------------------------------------------------------- Group names

export const ZEE_FLAVOURS = "Zee Flavours";
export const SOFT_DRINK = "Soft drink flavour";
export const BURGER_PORTION = "Burger portion";
export const DIPZ = "Dipz";
export const MOCHACHOS_SAUCE = "Mochachos sauce";
export const MAYO_CHOICE = "Mayo choice";
export const EXTRAS = "Extras";
export const MEXICAN_FILLING = "Mexican filling";
export const NACHOS_TOPPING = "Nachos topping";
export const SCHWARMA_FILLING = "Schwarma filling";
export const FILLETS_SIDE = "Fillets side";
export const FAMILY_CHIPS = "Family chips choice";
export const FAMILY_SALAD = "Family salad choice";
export const BAMBINO_CHOICE = "Bambino choice";
export const MILKSHAKE_FLAVOUR = "Milkshake flavour";
export const FREEZO_FLAVOUR = "Freezo flavour";
export const WATER_TYPE = "Water type";
export const APPLETISER_CHOICE = "Appletiser choice";
export const CHURROS_SIZE = "Churros size";
export const CHURROS_DIP = "Churros dip";

const SIZE_PROMPT = "Which size would you like?";

/** Shorthand for a one-of-many question. */
function single(name: string, prompt: string, options: ModifierOptionSeed[]): ModifierGroupSeed {
  return { name, prompt, selection: "SINGLE", minSelect: 1, maxSelect: 1, options };
}

/** Shorthand for an optional add-anything-you-like question. */
function multi(name: string, prompt: string, maxSelect: number, options: ModifierOptionSeed[]): ModifierGroupSeed {
  return { name, prompt, selection: "MULTIPLE", minSelect: 0, maxSelect, options };
}

/** A per-item size question. Deltas are from the item's smallest size. */
function sizes(name: string, options: ModifierOptionSeed[]): ModifierGroupSeed {
  return single(name, SIZE_PROMPT, options);
}

const SOFT_DRINK_OPTIONS: ModifierOptionSeed[] = [
  { name: "Coke", posCode: "DR-COK" },
  { name: "Coke Zero", posCode: "DR-COKZ" },
  { name: "Fanta Orange", posCode: "DR-FNT" },
  { name: "Sprite", posCode: "DR-SPR" },
  { name: "Creme Soda", posCode: "DR-CRM" },
  { name: "Stoney Ginger Beer", posCode: "DR-STN" },
];

const DIP_OPTIONS: ModifierOptionSeed[] = [
  { name: "Salsa", posCode: "DIP-SLS" },
  { name: "Guacamole", posCode: "DIP-GUA" },
  { name: "Peri-Mayo", posCode: "DIP-PRM" },
  { name: "Sweet Chilli", posCode: "DIP-SWC" },
  { name: "Sour Cream", posCode: "DIP-SRC" },
];

// Size group names, one per item because the price steps differ.
const SIZE_CHIPS = "Chips size";
const SIZE_LOADED = "Loaded chips size";
const SIZE_WEDGES = "Potato wedges size";
const SIZE_ONION = "Onion rings size";
const SIZE_RICE = "Mexican rice size";
const SIZE_PAP = "Pap size";
const SIZE_SALAD_CHICKEN = "Chicken salad size";
const SIZE_SALAD_GREEK = "Greek salad size";
const SIZE_SALAD_GARDEN = "Garden salad size";
const SIZE_COLESLAW = "Coleslaw size";

/** Zee Flavours, then the meal's buddy drink. */
const FLAME_GRILLED: ModifierRef[] = [
  { group: ZEE_FLAVOURS, required: true },
  { group: SOFT_DRINK, required: true, scope: "MEAL_ONLY" },
  { group: EXTRAS, required: false },
];

const MEAL_WITH_CHIPS_AND_BUDDY = "beeg chips and a buddy drink";

export const MOCHACHOS_MENU: MenuSeed = {
  modifierGroups: [
    single(ZEE_FLAVOURS, "Which of Zee Flavours would you like? 🌶️", [
      { name: "Lemon & Herb", description: "No heat at all", posCode: "ZF-LH" },
      { name: "Mild", description: "A gentle kick", posCode: "ZF-MLD" },
      { name: "Hot", description: "Proper peri-peri heat", posCode: "ZF-HOT" },
      { name: "Extra Hot", description: "Seriously hot", posCode: "ZF-XHOT" },
      { name: "Dynamite", description: "Our hottest, you have been warned", posCode: "ZF-DYN" },
    ]),

    single(SOFT_DRINK, "Which cold drink would you like?", SOFT_DRINK_OPTIONS),

    single(BURGER_PORTION, "Single or double?", [
      { name: "Single", posCode: "PRT-SGL" },
      { name: "Double", priceDeltaCents: R(20), posCode: "PRT-DBL" },
    ]),

    single(DIPZ, "Which dip would you like?", DIP_OPTIONS),

    single(MOCHACHOS_SAUCE, "Which sauce would you like?", [
      { name: "Tangy", posCode: "SCE-TNG" },
      { name: "Sweet & Sour", posCode: "SCE-SWS" },
      { name: "Peri Mince", posCode: "SCE-PRM" },
      { name: "Cheese Chilli", posCode: "SCE-CHC" },
      { name: "Sour Cream", posCode: "SCE-SRC" },
    ]),

    single(MAYO_CHOICE, "Mayo or peri-mayo?", [
      { name: "Mayo", posCode: "MYO-PLN" },
      { name: "Peri-Mayo", posCode: "MYO-PRI" },
    ]),

    multi(EXTRAS, "Any extras on that?", 5, [
      { name: "Slice of cheese", priceDeltaCents: R(10), posCode: "EX-CHS" },
      { name: "Slice of pineapple", priceDeltaCents: R(10), posCode: "EX-PIN" },
      { name: "Add feta", priceDeltaCents: R(12), posCode: "EX-FTA" },
      { name: "Extra dipz", priceDeltaCents: R(9.9), posCode: "EX-DIP" },
      { name: "Extra bun", priceDeltaCents: R(9.9), posCode: "EX-BUN" },
    ]),

    single(MEXICAN_FILLING, "Which filling would you like?", [
      { name: "Chicken", posCode: "FIL-CHK" },
      { name: "Rump Steak", priceDeltaCents: R(10), posCode: "FIL-RMP" },
    ]),

    single(NACHOS_TOPPING, "What would you like on your nachos?", [
      { name: "Cheese", posCode: "NCH-CHS" },
      { name: "Chicken", priceDeltaCents: R(20), posCode: "NCH-CHK" },
      { name: "Rump Steak", priceDeltaCents: R(30), posCode: "NCH-RMP" },
    ]),

    single(SCHWARMA_FILLING, "Which schwarma would you like?", [
      { name: "Chicken", posCode: "SCH-CHK" },
      { name: "Rump Steak", priceDeltaCents: R(10), posCode: "SCH-RMP" },
      { name: "Veggie", description: "Vegetarian", posCode: "SCH-VEG" },
    ]),

    single(FILLETS_SIDE, "Which side would you like with your fillets?", [
      { name: "Mexican Rice", posCode: "FSD-RCE" },
      { name: "Beeg Chips", posCode: "FSD-CHP" },
      { name: "Fresh Garden Salad", posCode: "FSD-SLD" },
    ]),

    single(FAMILY_CHIPS, "Chips or potato wedges?", [
      { name: "Beegest Chips", posCode: "FAM-CHP" },
      { name: "Beegest Wedges", posCode: "FAM-WDG" },
    ]),

    single(FAMILY_SALAD, "Coleslaw or garden salad?", [
      { name: "Beegest Coleslaw", posCode: "FAM-SLW" },
      { name: "Beegest Garden Salad", posCode: "FAM-SLD" },
    ]),

    single(BAMBINO_CHOICE, "Which Bambino meal would you like?", [
      { name: "Jose", description: "Mini chicken fillet burger", posCode: "BAM-JOS" },
      { name: "Pedro", description: "Mini beef burger", posCode: "BAM-PED" },
      { name: "Speedy", description: "4 battered chicken breast strips", posCode: "BAM-SPD" },
    ]),

    single(MILKSHAKE_FLAVOUR, "Which milkshake flavour?", [
      { name: "Chocolate", posCode: "MLK-CHO" },
      { name: "Strawberry", posCode: "MLK-STR" },
      { name: "Banana", posCode: "MLK-BAN" },
      { name: "Bubblegum", posCode: "MLK-BUB" },
      { name: "Lime", posCode: "MLK-LIM" },
    ]),

    single(FREEZO_FLAVOUR, "Which Freezo would you like?", [
      { name: "Coffee", posCode: "FRZ-COF" },
      { name: "Toffee Caramel", posCode: "FRZ-TOF" },
      { name: "White Chocolate", posCode: "FRZ-WHT" },
    ]),

    single(WATER_TYPE, "Still or sparkling?", [
      { name: "Still", posCode: "WTR-STL" },
      { name: "Sparkling", posCode: "WTR-SPK" },
    ]),

    single(APPLETISER_CHOICE, "Appletiser or Grapetiser?", [
      { name: "Appletiser", posCode: "APL-APP" },
      { name: "Grapetiser", posCode: "APL-GRP" },
    ]),

    sizes(CHURROS_SIZE, [
      { name: "Beeg", description: "3 churros", posCode: "CHU-3" },
      { name: "Beeger", description: "6 churros", priceDeltaCents: R(28), posCode: "CHU-6" },
    ]),

    multi(CHURROS_DIP, "Would you like a dip with your churros?", 2, [
      { name: "Chocolate Dip", priceDeltaCents: R(11.9), posCode: "CHU-DCH" },
      { name: "Caramel Dip", priceDeltaCents: R(11.9), posCode: "CHU-DCA" },
    ]),

    sizes(SIZE_CHIPS, [
      { name: "Beeg", posCode: "CHP-B" },
      { name: "Beeger", priceDeltaCents: R(10), posCode: "CHP-BR" },
      { name: "Beegest", priceDeltaCents: R(35), posCode: "CHP-BST" },
    ]),
    sizes(SIZE_LOADED, [
      { name: "Beeg", posCode: "LCH-B" },
      { name: "Beeger", priceDeltaCents: R(10), posCode: "LCH-BR" },
      { name: "Beegest", priceDeltaCents: R(35), posCode: "LCH-BST" },
    ]),
    sizes(SIZE_WEDGES, [
      { name: "Beeg", posCode: "WDG-B" },
      { name: "Beeger", priceDeltaCents: R(10), posCode: "WDG-BR" },
      { name: "Beegest", priceDeltaCents: R(35), posCode: "WDG-BST" },
    ]),
    sizes(SIZE_ONION, [
      { name: "Beeg", description: "6 rings", posCode: "ONR-6" },
      { name: "Beeger", description: "12 rings", priceDeltaCents: R(18), posCode: "ONR-12" },
      { name: "Beegest", description: "18 rings", priceDeltaCents: R(30), posCode: "ONR-18" },
    ]),
    sizes(SIZE_RICE, [
      { name: "Beeg", posCode: "RCE-B" },
      { name: "Beeger", priceDeltaCents: R(10), posCode: "RCE-BR" },
      { name: "Beegest", priceDeltaCents: R(20), posCode: "RCE-BST" },
    ]),
    sizes(SIZE_PAP, [
      { name: "Beeg", posCode: "PAP-B" },
      { name: "Beeger", priceDeltaCents: R(10), posCode: "PAP-BR" },
    ]),
    sizes(SIZE_SALAD_CHICKEN, [
      { name: "Beeg", posCode: "SLC-B" },
      { name: "Beegest", priceDeltaCents: R(35), posCode: "SLC-BST" },
    ]),
    sizes(SIZE_SALAD_GREEK, [
      { name: "Beeg", posCode: "SLG-B" },
      { name: "Beegest", priceDeltaCents: R(15), posCode: "SLG-BST" },
    ]),
    sizes(SIZE_SALAD_GARDEN, [
      { name: "Beeg", posCode: "SLD-B" },
      { name: "Beegest", priceDeltaCents: R(10), posCode: "SLD-BST" },
    ]),
    sizes(SIZE_COLESLAW, [
      { name: "Beeg", posCode: "SLW-B" },
      { name: "Beegest", priceDeltaCents: R(10), posCode: "SLW-BST" },
    ]),
  ],

  categories: [
    {
      name: "Pollo Pueblo",
      description: "Flame-grilled Mexican chicken",
      items: [
        {
          name: "1/4 Chicken",
          description: "Butterflied, flame-grilled and spiced with your choice of Zee Flavours",
          priceCents: R(49.9),
          posCode: "PP-QTR",
          mealUpgradeCents: R(46),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: FLAME_GRILLED,
        },
        {
          name: "1/2 Chicken",
          priceCents: R(94.9),
          posCode: "PP-HLF",
          mealUpgradeCents: R(45),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: FLAME_GRILLED,
        },
        { name: "Full Chicken", priceCents: R(179.9), posCode: "PP-FUL", modifiers: FLAME_GRILLED },
      ],
    },

    {
      name: "Burger El' Supremo",
      description: "Chicken, beef and gourmet burgers",
      items: [
        {
          name: "Chicken Burger",
          description: "Flame-grilled chicken fillet. Veggie option available",
          priceCents: R(59.9),
          posCode: "BG-CHK",
          mealUpgradeCents: R(40),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [{ group: BURGER_PORTION, required: true }, ...FLAME_GRILLED],
        },
        {
          name: "Chicken Cheese Burger",
          shortName: "Chicken Cheese Burger",
          priceCents: R(69.9),
          posCode: "BG-CHKC",
          mealUpgradeCents: R(40),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [{ group: BURGER_PORTION, required: true }, ...FLAME_GRILLED],
        },
        {
          name: "Chicken Cheese & Pine Burger",
          shortName: "Chicken Cheese & Pine",
          priceCents: R(79.9),
          posCode: "BG-CHKP",
          mealUpgradeCents: R(40),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [{ group: BURGER_PORTION, required: true }, ...FLAME_GRILLED],
        },
        {
          name: "Gourmet Chicken Burger",
          description: "Topped with feta, guacamole and sliced jalapeno",
          priceCents: R(74.9),
          posCode: "BG-CHKG",
          mealUpgradeCents: R(40),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [{ group: BURGER_PORTION, required: true }, ...FLAME_GRILLED],
        },
        {
          name: "Jalapeno Cheese Burger",
          description: "Chicken fillet with cheddar and sliced jalapeno",
          priceCents: R(69.9),
          posCode: "BG-CHKJ",
          mealUpgradeCents: R(40),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [{ group: BURGER_PORTION, required: true }, ...FLAME_GRILLED],
        },
        {
          name: "Beef Burger",
          description: "100% beef, 150g",
          priceCents: R(69.9),
          posCode: "BG-BEF",
          mealUpgradeCents: R(40),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [...FLAME_GRILLED],
        },
        {
          name: "Gourmet Beef Burger",
          description: "Topped with feta, guacamole and sliced jalapeno",
          priceCents: R(84.9),
          posCode: "BG-BEFG",
          mealUpgradeCents: R(40),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [...FLAME_GRILLED],
        },
        {
          name: "Beef Jalapeno Cheese Burger",
          shortName: "Beef Jalapeno Cheese",
          description: "Topped with cheddar and sliced jalapeno",
          priceCents: R(79.9),
          posCode: "BG-BEFJ",
          mealUpgradeCents: R(40),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [...FLAME_GRILLED],
        },
        {
          name: "Mexican Lamb Burger",
          description: "Juicy lamb patty on a Mochachos bun with lettuce, tomato and a sauce of choice",
          priceCents: R(69.9),
          posCode: "BG-LMB",
          mealUpgradeCents: R(40),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: MOCHACHOS_SAUCE, required: true },
            { group: SOFT_DRINK, required: true, scope: "MEAL_ONLY" },
            { group: EXTRAS, required: false },
          ],
        },
        {
          name: "Nacho Crunch Gourmet Burger",
          shortName: "Nacho Crunch Gourmet",
          description: "Chicken fillet coated in nachos and fried, with feta, guacamole, sour cream, salsa and jalapeno",
          priceCents: R(79.9),
          posCode: "BG-NCH",
          mealUpgradeCents: R(35),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: SOFT_DRINK, required: true, scope: "MEAL_ONLY" },
            { group: EXTRAS, required: false },
          ],
        },
        {
          name: "Chicken Strip and Cheese Burger",
          shortName: "Chicken Strip & Cheese",
          description: "Mochachos bun with lettuce, tomato, Mochachos whip, 5 chicken strips and a slice of cheese",
          priceCents: R(69.9),
          posCode: "BG-STRC",
          mealUpgradeCents: R(40),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [...FLAME_GRILLED],
        },
        {
          name: "Mexican Crumbed Burger",
          description: "Chicken breast fillet in bread crumbs and our secret herbs and spices, fried to perfection",
          priceCents: R(59.9),
          posCode: "BG-CRM",
          mealUpgradeCents: R(40),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [...FLAME_GRILLED],
        },
      ],
    },

    {
      name: "Combinacion",
      description: "Combos with chips and a buddy",
      items: [
        {
          name: "Chicken Burger, Beeg Chips & Buddy",
          shortName: "Chicken Burger Combo",
          priceCents: R(99.9),
          posCode: "CB-CHKB",
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: SOFT_DRINK, required: true },
            { group: EXTRAS, required: false },
          ],
        },
        {
          name: "1/4 Chicken, Beeg Chips & Buddy",
          shortName: "1/4 Chicken Combo",
          priceCents: R(95.9),
          posCode: "CB-QTRB",
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: SOFT_DRINK, required: true },
          ],
        },
        {
          name: "Chicken Schwarma, Beeg Chips & Buddy",
          shortName: "Schwarma Combo",
          priceCents: R(124.9),
          posCode: "CB-SCHB",
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: SOFT_DRINK, required: true },
          ],
        },
        {
          name: "Nacho Crunch Gourmet Burger, Beeg Chips & Buddy",
          shortName: "Nacho Crunch Combo",
          priceCents: R(114.9),
          posCode: "CB-NCHB",
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: SOFT_DRINK, required: true },
            { group: EXTRAS, required: false },
          ],
        },
        {
          name: "1/2 Chicken, Beeg Chips & Buddy",
          shortName: "1/2 Chicken Combo",
          priceCents: R(139.9),
          posCode: "CB-HLFB",
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: SOFT_DRINK, required: true },
          ],
        },
        {
          name: "Chicken Burrito, Beeg Chips & Buddy",
          shortName: "Burrito Combo",
          priceCents: R(119.9),
          posCode: "CB-BURB",
          modifiers: [{ group: SOFT_DRINK, required: true }],
        },
        {
          name: "4 Full BBQ Wings & Beeg Chips",
          shortName: "4 Wings & Chips",
          priceCents: R(89.9),
          posCode: "CB-WNG4",
        },
        {
          name: "8 Full BBQ Wings & Beeger Chips",
          shortName: "8 Wings & Chips",
          priceCents: R(169.9),
          posCode: "CB-WNG8",
        },
        {
          name: "1/4 Chicken & Beeg Chips",
          shortName: "1/4 Chicken & Chips",
          priceCents: R(72.9),
          posCode: "CB-QTRC",
          modifiers: [{ group: ZEE_FLAVOURS, required: true }],
        },
        {
          name: "2 Chicken Fillets & a Side",
          shortName: "2 Fillets & a Side",
          description: "Two flame-grilled chicken breast fillets with your choice of side",
          priceCents: R(84.9),
          posCode: "CB-FIL2",
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: FILLETS_SIDE, required: true },
          ],
        },
        {
          name: "1/4 Chicken, Pap & Mexican Sauce",
          shortName: "1/4 Chicken & Pap",
          priceCents: R(64.9),
          posCode: "CB-QTRP",
          modifiers: [{ group: ZEE_FLAVOURS, required: true }],
        },
        {
          name: "Amigo Combo",
          description: "Half chicken, beeger chips and 2 bunz",
          priceCents: R(139.9),
          posCode: "CB-AMG",
          modifiers: [{ group: ZEE_FLAVOURS, required: true }],
        },
      ],
    },

    {
      name: "Plato Ligero",
      description: "Lighter meals, wings and strips",
      items: [
        {
          name: "Toasted Mexican Chicken Mayo",
          shortName: "Toasted Chicken Mayo",
          description: "A toasted chicken breast sandwich with crisp lettuce and tomato",
          priceCents: R(49.9),
          posCode: "PL-TST",
          modifiers: [{ group: MAYO_CHOICE, required: true }],
        },
        {
          name: "4 Full BBQ Wings",
          priceCents: R(69.9),
          posCode: "PL-WNG4",
          mealUpgradeCents: R(20),
          mealDescription: "beeg chips",
        },
        {
          name: "Mexican Chicken Pieces with Rice",
          shortName: "Chicken Pieces & Rice",
          description: "Tender pieces of chicken breast sauteed with our secret spices on Mexican rice",
          priceCents: R(54.9),
          posCode: "PL-PCE",
        },
        {
          name: "Mexican Chicken Livers & Bun",
          shortName: "Chicken Livers & Bun",
          priceCents: R(44.9),
          posCode: "PL-LVR",
        },
        {
          name: "6 Chicken Strips, Chips & Dip",
          shortName: "6 Strips, Chips & Dip",
          description: "Fried chicken breast strips battered with our secret blend of herbs and spices",
          priceCents: R(79.9),
          posCode: "PL-STR6",
          modifiers: [{ group: DIPZ, required: true }],
        },
        {
          name: "3 Chicken Strips & Dip",
          priceCents: R(39.9),
          posCode: "PL-STR3",
          modifiers: [{ group: DIPZ, required: true }],
        },
        {
          name: "3 Mozzarella Sticks & Dip",
          shortName: "3 Mozzarella Sticks",
          priceCents: R(54.9),
          posCode: "PL-MOZ",
          modifiers: [{ group: DIPZ, required: true }],
        },
        {
          name: "5 Chilli Cheese Nuggets & Dip",
          shortName: "5 Chilli Cheese Nuggets",
          description: "Crispy, savoury bites with bell pepper, jalapeno and cheese",
          priceCents: R(54.9),
          posCode: "PL-NUG",
          modifiers: [{ group: DIPZ, required: true }],
        },
      ],
    },

    {
      name: "Mexican Meals",
      description: "Schwarmas, burritos, nachos and more",
      items: [
        {
          name: "Schwarma",
          description: "Pita stuffed with your choice of filling and fresh salad",
          priceCents: R(79.9),
          posCode: "MX-SCH",
          mealUpgradeCents: R(45),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [
            { group: SCHWARMA_FILLING, required: true },
            { group: ZEE_FLAVOURS, required: true },
            { group: SOFT_DRINK, required: true, scope: "MEAL_ONLY" },
          ],
        },
        {
          name: "Burrito",
          description: "Your choice of filling, sauteed onion and green pepper with cheddar and guacamole in a soft flour tortilla",
          priceCents: R(74.9),
          posCode: "MX-BUR",
          mealUpgradeCents: R(45),
          mealDescription: MEAL_WITH_CHIPS_AND_BUDDY,
          modifiers: [
            { group: MEXICAN_FILLING, required: true },
            { group: SOFT_DRINK, required: true, scope: "MEAL_ONLY" },
          ],
        },
        {
          name: "Quesadilla",
          description: "Two tortillas toasted with your choice of filling, sauteed onion, green pepper, cheddar and mayo",
          priceCents: R(109.9),
          posCode: "MX-QSD",
          modifiers: [{ group: MEXICAN_FILLING, required: true }],
        },
        {
          name: "Fajitas",
          description: "Two soft flour tortillas to wrap your filling, with Mexican rice, salad, cheddar, sour cream, salsa and guacamole",
          priceCents: R(129.9),
          posCode: "MX-FAJ",
          modifiers: [{ group: MEXICAN_FILLING, required: true }],
        },
        {
          name: "Chimichanga",
          description: "Homemade tortilla filled with shredded filling, salsa and cheddar, folded and deep fried, with sour cream and guacamole",
          priceCents: R(79.9),
          posCode: "MX-CHM",
          modifiers: [{ group: MEXICAN_FILLING, required: true }],
        },
        {
          name: "Enchilada",
          description: "Soft flour tortilla wrapped around your filling with onion and green pepper, topped with salsa and melted cheddar",
          priceCents: R(94.9),
          posCode: "MX-ENC",
          modifiers: [{ group: MEXICAN_FILLING, required: true }],
        },
        {
          name: "Nachos",
          description: "Crispy tortilla chips in salsa and melted cheddar with sour cream, guacamole and sliced jalapeno",
          priceCents: R(89.9),
          posCode: "MX-NCH",
          modifiers: [{ group: NACHOS_TOPPING, required: true }],
        },
      ],
    },

    {
      name: "Familia Fiesta",
      description: "Family meals to share",
      items: [
        {
          name: "Family Variety",
          description: "Half chicken, two chicken burgers and beegest chips or wedges",
          priceCents: R(249.9),
          posCode: "FF-VAR",
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: FAMILY_CHIPS, required: true },
          ],
        },
        {
          name: "Family Feast",
          description: "A full chicken with the beegest portion of chips or wedges and 4 fresh bunz",
          priceCents: R(259.9),
          posCode: "FF-FST",
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: FAMILY_CHIPS, required: true },
          ],
        },
        {
          name: "Family Fiesta",
          description: "A full chicken with beegest chips or wedges, beegest coleslaw or garden salad and 4 fresh bunz",
          priceCents: R(289.9),
          posCode: "FF-FIE",
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: FAMILY_CHIPS, required: true },
            { group: FAMILY_SALAD, required: true },
          ],
        },
        {
          name: "Family Share Meal",
          description: "Two chicken burgers, two kiddies chicken burgers, six chicken strips and dip, beegest chips",
          priceCents: R(299.9),
          posCode: "FF-SHR",
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: DIPZ, required: true },
          ],
        },
        {
          name: "Family Treat",
          description: "Two full chickens, two beegest chips or wedges, 8 bunz, beegest coleslaw or garden salad",
          priceCents: R(539.9),
          posCode: "FF-TRT",
          modifiers: [
            { group: ZEE_FLAVOURS, required: true },
            { group: FAMILY_CHIPS, required: true },
            { group: FAMILY_SALAD, required: true },
          ],
        },
      ],
    },

    {
      name: "Bambino Meal",
      description: "Kids meal with a free toy",
      items: [
        {
          name: "Bambino Meal",
          description: "Served with a portion of chips and a fruit juice, plus a free toy",
          priceCents: R(69.9),
          posCode: "BM-MEAL",
          modifiers: [{ group: BAMBINO_CHOICE, required: true }],
        },
      ],
    },

    {
      name: "Salads & Zee Sides",
      description: "Salads, chips, rice and sauces",
      items: [
        {
          name: "Grilled Chicken Salad",
          priceCents: R(54.9),
          posCode: "SL-CHK",
          modifiers: [
            { group: SIZE_SALAD_CHICKEN, required: true },
            { group: EXTRAS, required: false },
          ],
        },
        {
          name: "Greek Salad",
          description: "Vegetarian",
          priceCents: R(39.9),
          posCode: "SL-GRK",
          modifiers: [{ group: SIZE_SALAD_GREEK, required: true }],
        },
        {
          name: "Garden Salad",
          description: "Vegetarian",
          priceCents: R(29.9),
          posCode: "SL-GRD",
          modifiers: [{ group: SIZE_SALAD_GARDEN, required: true }],
        },
        {
          name: "Coleslaw",
          description: "Vegetarian",
          priceCents: R(29.9),
          posCode: "SL-SLW",
          modifiers: [{ group: SIZE_COLESLAW, required: true }],
        },
        { name: "Chips", priceCents: R(29.9), posCode: "SD-CHP", modifiers: [{ group: SIZE_CHIPS, required: true }] },
        {
          name: "Loaded Chips",
          description: "Mochachos chip spice, cheese sauce and jalapenos",
          priceCents: R(39.9),
          posCode: "SD-LCH",
          modifiers: [{ group: SIZE_LOADED, required: true }],
        },
        { name: "Potato Wedges", priceCents: R(29.9), posCode: "SD-WDG", modifiers: [{ group: SIZE_WEDGES, required: true }] },
        { name: "Onion Rings", priceCents: R(24.9), posCode: "SD-ONR", modifiers: [{ group: SIZE_ONION, required: true }] },
        { name: "Mexican Rice", priceCents: R(29.9), posCode: "SD-RCE", modifiers: [{ group: SIZE_RICE, required: true }] },
        { name: "Pap & Mexican Sauce", priceCents: R(26.9), posCode: "SD-PAP", modifiers: [{ group: SIZE_PAP, required: true }] },
        { name: "Mochachos Sauces", priceCents: R(35.9), posCode: "SD-SCE", modifiers: [{ group: MOCHACHOS_SAUCE, required: true }] },
        { name: "Dipz", priceCents: R(9.9), posCode: "SD-DIP", modifiers: [{ group: DIPZ, required: true }] },
        { name: "Bun", priceCents: R(9.9), posCode: "SD-BUN" },
      ],
    },

    {
      name: "Drinks & Desserts",
      description: "Cold drinks, shakes, freezos and churros",
      items: [
        { name: "Can", description: "330ml can", priceCents: R(24.9), posCode: "DK-CAN", modifiers: [{ group: SOFT_DRINK, required: true }] },
        { name: "Buddy", description: "440ml bottle", priceCents: R(26.9), posCode: "DK-BDY", modifiers: [{ group: SOFT_DRINK, required: true }] },
        { name: "1.5 Litre", priceCents: R(34.9), posCode: "DK-15L", modifiers: [{ group: SOFT_DRINK, required: true }] },
        { name: "Water", priceCents: R(24.9), posCode: "DK-WTR", modifiers: [{ group: WATER_TYPE, required: true }] },
        { name: "Appletiser / Grapetiser", priceCents: R(29.9), posCode: "DK-APL", modifiers: [{ group: APPLETISER_CHOICE, required: true }] },
        { name: "330ml Cappy", priceCents: R(29.9), posCode: "DK-CAP" },
        { name: "Lemon Ice Tea", description: "350ml, home made", priceCents: R(29.9), posCode: "QN-LMN" },
        { name: "Peach Ice Tea", description: "350ml, home made", priceCents: R(29.9), posCode: "QN-PCH" },
        { name: "Ginger Beer", description: "350ml, home made", priceCents: R(29.9), posCode: "QN-GNG" },
        { name: "Lemonade", description: "350ml, home made", priceCents: R(29.9), posCode: "QN-LMD" },
        { name: "Freezo", description: "350ml", priceCents: R(44.9), posCode: "FZ-350", modifiers: [{ group: FREEZO_FLAVOUR, required: true }] },
        { name: "Milkshake", description: "350ml", priceCents: R(36.9), posCode: "MS-350", modifiers: [{ group: MILKSHAKE_FLAVOUR, required: true }] },
        {
          name: "Churros",
          priceCents: R(36.9),
          posCode: "DS-CHU",
          modifiers: [
            { group: CHURROS_SIZE, required: true },
            { group: CHURROS_DIP, required: false },
          ],
        },
      ],
    },
  ],

  images: [
    { filePath: "menu/mochachos-menu-1.jpg", caption: "Mochachos menu (1 of 2) \u2014 burgers, chicken, combos and salads. Tap to zoom in." },
    { filePath: "menu/mochachos-menu-2.jpg", caption: "Mochachos menu (2 of 2) \u2014 Mexican meals, family meals, sides and desserts." },
    {
      filePath: "menu/Mochachos-RSA-Menu-2026.pdf",
      isDocument: true,
      fileName: "Mochachos-RSA-Menu-2026.pdf",
      mimeType: "application/pdf",
      caption: "Mochachos RSA menu 2026.",
    },
  ],

  faqs: [
    {
      question: "What are your hours?",
      answer:
        "You can order any time right now, including through the night. The usual shop hours are Monday to Thursday 10:00 to 21:00, Friday and Saturday 10:00 to 22:00, and Sunday 11:00 to 20:00, Johannesburg time.",
      keywords: [
        "hours",
        "what time do you open",
        "what time do you close",
        "when do you open",
        "when do you close",
        "opening hours",
        "trading hours",
        "are you open",
        "are you closed",
      ],
    },
    {
      question: "Where are you and where do I park?",
      answer:
        "We are at 17 Nelson Mandela Drive in the Potchefstroom CBD. There is street parking right outside, and the shop is on the main drag so it is easy to find.",
      keywords: ["address", "location", "directions", "parking", "find you", "where are you", "where you based", "nelson mandela"],
    },
    {
      question: "Do you deliver?",
      // Previous answer, kept so delivery can be switched back on:
      // "Yes. We deliver in Potchefstroom. The delivery amount is set by the shop and added to your total before you confirm. It can be free. Pay the driver when it arrives, or pay at the till if you collect from 17 Nelson Mandela Drive.",
      answer:
        "Not at the moment. Orders are collection from 17 Nelson Mandela Drive in the Potchefstroom CBD, and you pay at the till.",
      keywords: ["deliver", "delivery", "do you deliver", "drop off", "uber eats", "mr d", "bolt food"],
    },
    {
      question: "How do I pay?",
      answer:
        "You pay at the till when you collect — cash, card or SnapScan. There is no payment in the chat. Delivery is off for now.",
      keywords: ["pay", "payment", "how do i pay", "card", "cash", "snapscan", "eft", "speedpoint", "pay in the chat", "pay on whatsapp"],
    },
    {
      question: "How do I order on WhatsApp?",
      answer:
        "Type the whole order in one message if you like, for example hot quarter chicken meal with a Coke. Or tap through the menu. After each item you can type what to leave out, or an allergy. I only ask for what you left out. The kitchen gets it after you say yes. Collect from 17 Nelson Mandela Drive.",
      keywords: ["how do i order", "how does this work", "how to order", "how does ordering work"],
    },
    {
      question: "How hot are Zee Flavours?",
      answer:
        "Zee Flavours go Lemon & Herb (no heat), Mild (a gentle kick), Hot (proper peri-peri), Extra Hot (seriously hot) and then Dynamite, which is our hottest. If you are not sure, Mild or Hot is the safe bet.",
      keywords: ["spicy", "how hot", "how spicy", "peri peri", "extra hot", "dynamite", "zee flavours", "basting"],
    },
    {
      question: "Is there a vegetarian option?",
      answer:
        "Yes. The Veggie Schwarma, the Greek and Garden salads and the Cheese Nachos are vegetarian, and the Chicken Burger and Burrito both have a veggie option. Just say the word and I will swap it.",
      keywords: ["vegetarian", "veggie", "vegan", "meat free", "no meat"],
    },
    {
      question: "Can I order for later?",
      answer:
        "Every WhatsApp order goes straight to the kitchen for as soon as possible. If you need it at a particular time, say so and a staff member will set it up for you.",
      keywords: ["order for later", "pre order", "book a time", "specific time", "tomorrow"],
    },
    {
      question: "Do you cater for parties or big orders?",
      answer:
        "We do. The Familia Fiesta meals feed a crowd, and for anything bigger a staff member will put a quote together for you.",
      keywords: ["party", "catering", "function", "big order", "bulk order", "event"],
    },
    {
      question: "How long does an order take?",
      answer:
        "Once the kitchen accepts it, food usually takes about 20 minutes. They message you when they start, and again when it is ready. If they are busy they will send their own time. Ask \"how long is my order?\" after you've confirmed and I'll read that ticket.",
      keywords: ["how long", "how long does it take", "how long will it take", "prep time", "waiting time", "ready in", "eta"],
    },
    {
      question: "Can I cancel my order?",
      answer:
        "Yes, in this chat, before the kitchen starts and for 5 minutes after they accept it. Say cancel and I'll ask you to confirm. Once they are cooking, or the food is already made, a person at the shop has to cancel it.",
      keywords: ["cancel my order", "can i cancel", "cancellation", "kanselleer", "cancel it"],
    },
    {
      question: "Can I change my order?",
      answer:
        "Before you tap yes, just say the change, like make it mild or remove the chips. After the kitchen has started, say cancel if the whole order should stop, or ask for a person if only one item should change.",
      keywords: ["change my order", "edit my order", "amend my order", "wrong item", "made a mistake"],
    },
    {
      question: "How much is delivery?",
      answer:
        "Delivery is off for now. You collect from 17 Nelson Mandela Drive and pay at the till. There is no delivery price on a collection order.",
      keywords: ["delivery fee", "delivery price", "how much is delivery", "delivery cost", "cost to deliver", "is delivery free"],
    },
    {
      question: "What is in a meal?",
      answer:
        "On most chicken and burgers, a meal adds beeg chips and a buddy drink. The chat shows that add-on price before you confirm. If you don't want the meal, say on its own.",
      keywords: ["what is a meal", "whats in a meal", "what comes with a meal", "meal include", "what is included"],
    },
    {
      question: "Do you have kids meals?",
      answer:
        "Yes. The Bambino Meal comes with chips, a fruit juice and a free toy. Ask for a Bambino Meal and I'll add it.",
      keywords: ["kids", "kids meal", "kiddies", "bambino", "children", "child", "toy"],
    },
    {
      question: "What if I have an allergy?",
      answer:
        "After each item I ask what to leave out. Type it then, for example no tomato, no lettuce, or a nut allergy, and the kitchen sees it on that item. I don't keep a full allergen list, so ask for a person if the shop needs to confirm it before they start.",
      keywords: ["allergy", "allergic", "allergen", "nut allergy", "gluten", "dairy", "intolerance"],
    },
    {
      question: "What if my order is wrong?",
      answer:
        "Sorry. Say what is missing or wrong, and that you want a person. I'll hand the chat to the shop so they can fix it.",
      keywords: ["wrong order", "missing item", "forgot my", "not what i ordered", "incorrect order"],
    },
    {
      question: "Will you message me when it is ready?",
      answer:
        "Yes. You get a message when the kitchen accepts the order, and another when it is ready to collect. Your order number looks like MP-0004.",
      keywords: ["message me", "notify me", "let me know", "order number", "how will i know"],
    },
    {
      question: "Can I speak to someone?",
      answer:
        "Yes. Say you want to speak to someone and I'll pass this chat to the shop. They reply here.",
      keywords: ["speak to someone", "talk to someone", "real person", "call the shop", "phone number"],
    },
    {
      question: "Is there a minimum for delivery?",
      answer:
        "Delivery is off for now, so there is no delivery minimum. Collection orders do not have a minimum in this chat.",
      keywords: ["minimum", "minimum spend", "minimum order", "smallest order"],
    },
    {
      question: "Do you deliver outside Potchefstroom?",
      answer:
        "Delivery is off for now, including outside Potchefstroom. Collection is from 17 Nelson Mandela Drive.",
      keywords: [
        "deliver outside potchefstroom",
        "outside potchefstroom",
        "how far do you deliver",
        "delivery area",
        "delivery radius",
        "other towns",
        "klerksdorp",
      ],
    },
    {
      question: "Can I collect instead of delivery?",
      answer:
        "Yes. Every order is collection for now. You pick up at 17 Nelson Mandela Drive in the Potchefstroom CBD and pay at the till.",
      keywords: ["collect instead", "can i collect", "pick up", "pickup", "come fetch", "for collection"],
    },
    {
      question: "Can I order more than one item?",
      answer:
        "Yes. Type everything in one message, or tap Next item after each one. Each item keeps its own spice. Say all hot when every item that still needs a spice should be the same.",
      keywords: ["more than one", "multiple items", "several items", "two items", "whole order", "at the same time"],
    },
    {
      question: "Can each item have a different spice?",
      answer:
        "Yes. Put the spice with the item, for example quarter chicken hot and a chicken burger mild. The choices are Lemon & Herb, Mild, Hot, Extra Hot and Dynamite. Say all hot only when every item should match.",
      keywords: ["different spice", "different flavour", "own spice", "own flavour", "per item", "one hot one mild"],
    },
    {
      question: "Can I see the menu?",
      answer:
        "Yes. Say menu pictures and I will send both pages. Say menu pdf if you want the file. Or tap Browse the menu and pick from the list. A new order also gets the pictures once.",
      keywords: ["see the menu", "menu pictures", "menu pdf", "send the menu", "show me the menu", "picture of the menu"],
    },
    {
      question: "What drinks can I choose?",
      answer:
        "A meal's buddy drink is Coke, Coke Zero, Fanta Orange, Sprite, Creme Soda or Stoney Ginger Beer. Drinks can also be ordered on their own from the menu.",
      keywords: ["what drinks", "which drink", "buddy drink", "soft drinks", "what cool drinks", "which cool drink"],
    },
    {
      question: "What happens after I say yes?",
      answer:
        "The kitchen gets the order and you get a number like MP-0004. They message you when they start, and again when it is ready to collect or on the way. The usual time is about 20 minutes after they accept. If they are busy they send their own time.",
      keywords: ["after i say yes", "after i confirm", "what happens next", "once i confirm", "after i order"],
    },
  ],
};
