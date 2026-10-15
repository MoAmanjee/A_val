/**
 * Photo map for the /order mini-site.
 *
 * Category heroes come from mochachos.com/our-food (Elementor backgrounds).
 * Item photos come from the brand product set used on SA ordering pages
 * (RealTimeMall / same catalog art). Prices still come from our DB seed —
 * the site is only a reference for look and category structure.
 */

export const ORDER_BRAND = {
  logo: "/order-food/brand-logo.png",
  mark: "/order-food/brand-logo-mark.jpg",
  hero: "/order-food/hero-sa.jpg",
  zeeFlavours: "/order-food/zee-flavours.png",
  pattern: "/order-food/bg-pattern.jpg",
} as const;

const CATEGORY_IMAGES: Record<string, string> = {
  "Pollo Pueblo": "/order-food/cat-pollo-pueblo.jpg",
  "Burger El' Supremo": "/order-food/cat-burgers.jpg",
  Combinacion: "/order-food/cat-combinacion.jpg",
  "Plato Ligero": "/order-food/cat-plato-ligero.jpg",
  "Mexican Meals": "/order-food/cat-mexican.jpg",
  "Familia Fiesta": "/order-food/cat-familia.jpg",
  "Bambino Meal": "/order-food/cat-bambino.jpg",
  "Salads & Zee Sides": "/order-food/cat-sides.jpg",
  "Drinks & Desserts": "/order-food/cat-dessert.jpg",
  Promotions: "/order-food/hero-sa.jpg",
  Schwarmas: "/order-food/cat-schwarmas.jpg",
  Ensaladas: "/order-food/cat-ensaladas.jpg",
};

/** Exact menu-item name → product photo. */
const ITEM_IMAGES: Record<string, string> = {
  "1/4 Chicken": "/order-food/item-halch15.png",
  "1/2 Chicken": "/order-food/item-halch15.png",
  "Full Chicken": "/order-food/item-fllch21.png",
  "Chicken Burger": "/order-food/item-burgcb.png",
  "Chicken Cheese Burger": "/order-food/item-burgcb.png",
  "Chicken Cheese & Pine Burger": "/order-food/item-burgcb.png",
  "Gourmet Chicken Burger": "/order-food/item-burggc.png",
  "Jalapeno Cheese Burger": "/order-food/item-burgcjs.png",
  "Beef Burger": "/order-food/item-burgbs.png",
  "Gourmet Beef Burger": "/order-food/item-burgbg.png",
  "Beef Jalapeno Cheese Burger": "/order-food/item-burgbjs.png",
  "Mexican Lamb Burger": "/order-food/item-mexlamburg.png",
  "Nacho Crunch Gourmet Burger": "/order-food/item-burgncg.png",
  "Chicken Strip and Cheese Burger": "/order-food/item-burgcb.png",
  "Mexican Crumbed Burger": "/order-food/item-mexcrumburg.png",
  "Chicken Burger, Beeg Chips & Buddy": "/order-food/item-burgcb.png",
  "1/4 Chicken, Beeg Chips & Buddy": "/order-food/item-chick4c.png",
  "Chicken Schwarma, Beeg Chips & Buddy": "/order-food/cat-schwarmas.jpg",
  "Nacho Crunch Gourmet Burger, Beeg Chips & Buddy": "/order-food/item-burgncg.png",
  "1/2 Chicken, Beeg Chips & Buddy": "/order-food/item-chick2c.png",
  "Chicken Burrito, Beeg Chips & Buddy": "/order-food/item-chbur8.png",
  "4 Full BBQ Wings & Beeg Chips": "/order-food/item-chick4bw.png",
  "8 Full BBQ Wings & Beeger Chips": "/order-food/item-chick8bw.png",
  "1/4 Chicken & Beeg Chips": "/order-food/item-chick4b.png",
  "2 Chicken Fillets & a Side": "/order-food/item-chickfc.png",
  "1/4 Chicken, Pap & Mexican Sauce": "/order-food/item-chick4p.png",
  "Amigo Combo": "/order-food/item-amig1c.png",
  "Toasted Mexican Chicken Mayo": "/order-food/item-kidtsts.png",
  "4 Full BBQ Wings": "/order-food/item-fbbqw3.png",
  "Mexican Chicken Pieces with Rice": "/order-food/item-mgcsr9.png",
  "Mexican Chicken Livers & Bun": "/order-food/item-cklvr.png",
  "6 Chicken Strips, Chips & Dip": "/order-food/item-cscdp3.png",
  "3 Chicken Strips & Dip": "/order-food/item-cspdp7.png",
  "3 Mozzarella Sticks & Dip": "/order-food/item-mozstick.png",
  "5 Chilli Cheese Nuggets & Dip": "/order-food/item-cscdp5.png",
  Schwarma: "/order-food/cat-schwarmas.jpg",
  Burrito: "/order-food/item-chbur8.png",
  Quesadilla: "/order-food/item-ckques.png",
  Fajitas: "/order-food/item-fajit.png",
  Chimichanga: "/order-food/item-ckchim.png",
  Enchilada: "/order-food/item-chench.png",
  Nachos: "/order-food/item-csmach5.png",
  "Family Variety": "/order-food/item-famva.png",
  "Family Fiesta": "/order-food/item-famfi.png",
  "Family Feast": "/order-food/item-famfe.png",
  "Family Treat": "/order-food/item-famtr.png",
  "Family Share Meal": "/order-food/item-famsm.png",
  "Bambino Meal": "/order-food/item-bmjose.png",
  "Grilled Chicken Salad": "/order-food/item-grchsld3.png",
  "Greek Salad": "/order-food/item-grsld5.png",
  "Garden Salad": "/order-food/item-grdsld8.png",
  Coleslaw: "/order-food/item-colesml.png",
  Chips: "/order-food/cat-sides.jpg",
  "Loaded Chips": "/order-food/cat-sides.jpg",
  "Potato Wedges": "/order-food/cat-sides.jpg",
  "Onion Rings": "/order-food/cat-sides.jpg",
  "Mexican Rice": "/order-food/item-mgcsr9.png",
  Pap: "/order-food/cat-sides.jpg",
  Dipz: "/order-food/item-dips1.png",
  Buddy: "/order-food/item-budvari.png",
  Can: "/order-food/item-canvari.png",
  "1.5 Litre Soft Drink": "/order-food/item-ltronefive.png",
  Appletiser: "/order-food/item-appgrap.png",
  Water: "/order-food/item-hmqchr.png",
  Milkshake: "/order-food/item-mlkshk.png",
  Freezo: "/order-food/item-freezo.png",
  Churros: "/order-food/item-churr1.png",
  Coffee: "/order-food/item-coffee.png",
};

const FUZZY: Array<{ test: (name: string) => boolean; image: string }> = [
  { test: (n) => /schwarma/i.test(n), image: "/order-food/cat-schwarmas.jpg" },
  { test: (n) => /burrito/i.test(n), image: "/order-food/item-chbur8.png" },
  { test: (n) => /fajita/i.test(n), image: "/order-food/item-fajit.png" },
  { test: (n) => /wing/i.test(n), image: "/order-food/item-chick8bw.png" },
  { test: (n) => /chicken burger/i.test(n), image: "/order-food/item-burgcb.png" },
  { test: (n) => /beef burger/i.test(n), image: "/order-food/item-burgbs.png" },
  { test: (n) => /salad/i.test(n), image: "/order-food/cat-ensaladas.jpg" },
  { test: (n) => /chip/i.test(n), image: "/order-food/cat-sides.jpg" },
  { test: (n) => /chicken/i.test(n), image: "/order-food/cat-pollo-pueblo.jpg" },
  { test: (n) => /burger/i.test(n), image: "/order-food/cat-burgers.jpg" },
  { test: (n) => /milkshake|freezo|churro|dessert/i.test(n), image: "/order-food/cat-dessert.jpg" },
  { test: (n) => /drink|buddy|coke|fanta|sprite|water|cappy/i.test(n), image: "/order-food/item-budvari.png" },
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
