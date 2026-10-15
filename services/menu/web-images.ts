/**
 * Photo map for the /order mini-site.
 *
 * Item and category photos are taken from the Mr D Mochachos Potchefstroom
 * CBD listing (img.mrdfood.com), stored under /public/order-food/mrd/.
 * Prices still come from our DB seed.
 */

export const ORDER_BRAND = {
  logo: "/order-food/brand-logo.png",
  mark: "/order-food/mrd/logo-mark.png",
  hero: "/order-food/mrd/hero-banner.jpg",
  zeeFlavours: "/order-food/zee-flavours.png",
  pattern: "/order-food/bg-pattern.jpg",
} as const;

const CATEGORY_IMAGES: Record<string, string> = {
  "Bambino Meal": "/order-food/mrd/jos-bambino-meal.jpg",
  "Burger El' Supremo": "/order-food/mrd/single-chicken-burger.jpg",
  "Combinacion": "/order-food/mrd/amigo-combo.jpg",
  "Drinks & Desserts": "/order-food/mrd/beeg-3-churros.png",
  "Ensaladas": "/order-food/mrd/grilled-chicken-salad.jpg",
  "Familia Fiesta": "/order-food/mrd/family-feast.jpg",
  "Mexican Meals": "/order-food/mrd/burrito.jpg",
  "Plato Ligero": "/order-food/mrd/six-chicken-strips-chips-dip.jpg",
  "Pollo Pueblo": "/order-food/mrd/1-4-villagechicken.jpg",
  "Promotions": "/order-food/mrd/2x-chicken-schwarma.jpg",
  "Salads & Zee Sides": "/order-food/mrd/chips.png",
  "Schwarmas": "/order-food/mrd/chicken-schwarma.jpg",
};

/** Exact menu-item name → Mr D product photo. */
const ITEM_IMAGES: Record<string, string> = {
  "1.5 Litre": "/order-food/mrd/1-5-litre.png",
  "1/2 Chicken": "/order-food/mrd/1-2-village-chicken.jpg",
  "1/2 Chicken, Beeg Chips & Buddy": "/order-food/mrd/1-2-chicken-beeg-chips-and-a-buddy.jpg",
  "1/4 Chicken": "/order-food/mrd/1-4-villagechicken.jpg",
  "1/4 Chicken & Beeg Chips": "/order-food/mrd/1-4-chicken-and-beeg-chips.jpg",
  "1/4 Chicken, Beeg Chips & Buddy": "/order-food/mrd/1-4-chicken-beeg-chips-and-a-buddy.jpg",
  "1/4 Chicken, Pap & Mexican Sauce": "/order-food/mrd/1-4-chicken-pap-and-mexican-sauce.png",
  "2 Chicken Fillets & a Side": "/order-food/mrd/2-chicken-fillets-and-a-side.jpg",
  "3 Chicken Strips & Dip": "/order-food/mrd/three-chicken-strips-and-a-dip.png",
  "3 Mozzarella Sticks & Dip": "/order-food/mrd/3-mozzarella-sticks-and-dip.png",
  "330ml Cappy": "/order-food/mrd/cappy-juice.png",
  "4 Full BBQ Wings": "/order-food/mrd/four-full-bbq-wings.png",
  "4 Full BBQ Wings & Beeg Chips": "/order-food/mrd/4-full-bbq-wings-and-beeg-chips.jpg",
  "5 Chilli Cheese Nuggets & Dip": "/order-food/mrd/5x-chilli-cheese-nuggets.jpg",
  "6 Chicken Strips, Chips & Dip": "/order-food/mrd/six-chicken-strips-chips-dip.jpg",
  "8 Full BBQ Wings & Beeger Chips": "/order-food/mrd/8-full-bbq-wings-and-beeger-chips.jpg",
  "Amigo Combo": "/order-food/mrd/amigo-combo.jpg",
  "Appletiser / Grapetiser": "/order-food/mrd/appletiser.png",
  "Bambino Meal": "/order-food/mrd/jos-bambino-meal.jpg",
  "Beef Burger": "/order-food/mrd/beef-burger.jpg",
  "Beef Jalapeno Cheese Burger": "/order-food/mrd/jalapeno-cheese-beef-burger.jpg",
  "Buddy": "/order-food/mrd/buddy.png",
  "Bun": "/order-food/mrd/bun.png",
  "Burrito": "/order-food/mrd/burrito.jpg",
  "Can": "/order-food/mrd/buddy.png",
  "Chicken Burger": "/order-food/mrd/single-chicken-burger.jpg",
  "Chicken Burger, Beeg Chips & Buddy": "/order-food/mrd/chicken-burger-beeg-chips-and-a-buddy.jpg",
  "Chicken Burrito, Beeg Chips & Buddy": "/order-food/mrd/chicken-burrito-beeg-chips-and-buddy.jpg",
  "Chicken Cheese & Pine Burger": "/order-food/mrd/single-chicken-cheese-and-pine-burger.png",
  "Chicken Cheese Burger": "/order-food/mrd/single-chicken-cheese-burger.png",
  "Chicken Schwarma, Beeg Chips & Buddy": "/order-food/mrd/schwarma-beeg-chips-and-a-buddy.jpg",
  "Chicken Strip and Cheese Burger": "/order-food/mrd/chicken-strip-and-cheese-burger.png",
  "Chimichanga": "/order-food/mrd/chimichanga.jpg",
  "Chips": "/order-food/mrd/chips.png",
  "Churros": "/order-food/mrd/beeg-3-churros.png",
  "Coleslaw": "/order-food/mrd/coleslaw.jpg",
  "Dipz": "/order-food/mrd/dipz.png",
  "Enchilada": "/order-food/mrd/chicken-enchilada.jpg",
  "Fajitas": "/order-food/mrd/fajitas.jpg",
  "Family Feast": "/order-food/mrd/family-feast.jpg",
  "Family Fiesta": "/order-food/mrd/family-fiesta.jpg",
  "Family Share Meal": "/order-food/mrd/family-share-meal.png",
  "Family Treat": "/order-food/mrd/family-share-meal.png",
  "Family Variety": "/order-food/mrd/family-variety.jpg",
  "Freezo": "/order-food/mrd/coffee-freezo-350ml.png",
  "Full Chicken": "/order-food/mrd/full-village-chicken.jpg",
  "Garden Salad": "/order-food/mrd/garden-salad.jpg",
  "Ginger Beer": "/order-food/mrd/ginger-beer.jpg",
  "Gourmet Beef Burger": "/order-food/mrd/gourmet-beef-burger.jpg",
  "Gourmet Chicken Burger": "/order-food/mrd/single-gourmet-chicken-burger.jpg",
  "Greek Salad": "/order-food/mrd/greek-salad.jpg",
  "Grilled Chicken Salad": "/order-food/mrd/grilled-chicken-salad.jpg",
  "Jalapeno Cheese Burger": "/order-food/mrd/single-jalapeno-cheese-burger.jpg",
  "Lemon Ice Tea": "/order-food/mrd/ice-tea-lemon.jpg",
  "Lemonade": "/order-food/mrd/lemonade.jpg",
  "Loaded Chips": "/order-food/mrd/loaded-chips.png",
  "Mexican Chicken Livers & Bun": "/order-food/mrd/mexican-chicken-livers-and-bun.jpg",
  "Mexican Chicken Pieces with Rice": "/order-food/mrd/mexican-chicken-pieces-with-rice.jpg",
  "Mexican Crumbed Burger": "/order-food/mrd/mexican-crumbed-burger.png",
  "Mexican Lamb Burger": "/order-food/mrd/mexican-lamb-burger.png",
  "Mexican Rice": "/order-food/mrd/mexican-rice.jpg",
  "Milkshake": "/order-food/mrd/chocolate-milkshake.jpg",
  "Mochachos Sauces": "/order-food/mrd/mochachos-sauce-250ml.png",
  "Nacho Crunch Gourmet Burger": "/order-food/mrd/nacho-crunch-gourmet-burger.png",
  "Nacho Crunch Gourmet Burger, Beeg Chips & Buddy": "/order-food/mrd/nacho-crunch-gourmet-burger.png",
  "Nachos": "/order-food/mrd/chicken-nachos.jpg",
  "Onion Rings": "/order-food/mrd/onion-rings.jpg",
  "Pap & Mexican Sauce": "/order-food/mrd/pap-and-mexican-sauce.png",
  "Peach Ice Tea": "/order-food/mrd/ice-tea-peach.jpg",
  "Potato Wedges": "/order-food/mrd/potato-wedges.jpg",
  "Quesadilla": "/order-food/mrd/quesadilla.jpg",
  "Schwarma": "/order-food/mrd/chicken-schwarma.jpg",
  "Toasted Mexican Chicken Mayo": "/order-food/mrd/toasted-mexican-chicken-mayo.jpg",
  "Water": "/order-food/mrd/still-water.png",
};

const FUZZY: Array<{ test: (name: string) => boolean; image: string }> = [
  { test: (n) => /schwarma/i.test(n), image: "/order-food/mrd/chicken-schwarma.jpg" },
  { test: (n) => /burrito/i.test(n), image: "/order-food/mrd/burrito.jpg" },
  { test: (n) => /fajita/i.test(n), image: "/order-food/mrd/fajitas.jpg" },
  { test: (n) => /nacho/i.test(n), image: "/order-food/mrd/chicken-nachos.jpg" },
  { test: (n) => /wing/i.test(n), image: "/order-food/mrd/four-full-bbq-wings.png" },
  { test: (n) => /chicken burger/i.test(n), image: "/order-food/mrd/single-chicken-burger.jpg" },
  { test: (n) => /beef burger/i.test(n), image: "/order-food/mrd/beef-burger.jpg" },
  { test: (n) => /salad/i.test(n), image: "/order-food/mrd/grilled-chicken-salad.jpg" },
  { test: (n) => /chip/i.test(n), image: "/order-food/mrd/chips.png" },
  { test: (n) => /milkshake|freezo|churro|dessert/i.test(n), image: "/order-food/mrd/chocolate-milkshake.jpg" },
  { test: (n) => /chicken/i.test(n), image: "/order-food/mrd/1-4-villagechicken.jpg" },
  { test: (n) => /burger/i.test(n), image: "/order-food/mrd/single-chicken-burger.jpg" },
  { test: (n) => /drink|buddy|coke|fanta|sprite|water|cappy/i.test(n), image: "/order-food/mrd/buddy.png" },
];

export function categoryImage(name: string): string {
  return CATEGORY_IMAGES[name] ?? ORDER_BRAND.hero;
}

export function itemImage(name: string, categoryName?: string): string {
  if (ITEM_IMAGES[name]) return ITEM_IMAGES[name];
  for (const rule of FUZZY) {
    if (rule.test(name)) return rule.image;
  }
  if (categoryName) return categoryImage(categoryName);
  return ORDER_BRAND.hero;
}
