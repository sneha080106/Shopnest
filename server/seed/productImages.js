// Real product photos (Unsplash, free to use) for every seed product.
// The brands in the seed are fictional, so each photo shows the right KIND of item (headphones for
// headphones, a kettle for a kettle) rather than that exact brand. Keyed by product name so the
// seed list stays readable; tests fail if a product has no entry here.
//
// Each value is the bare Unsplash photo URL. Credits: https://unsplash.com/license (no attribution required).

const U = id => `https://images.unsplash.com/photo-${id}`;

const PHOTOS = {
  'Noizzy Over-Ear Wireless Headphones': U('1505740420928-5e560c06d30e'),
  'Pulseband Fitness Smartwatch': U('1557935728-e6d1eaabe558'),
  'BoomCore Portable Bluetooth Speaker': U('1518671678551-911467efe539'),
  'ClickPro Mechanical Keyboard': U('1742021856770-223f18e9f500'),
  'PixelWave 27" QHD Monitor': U('1590858078095-24c472408dfe'),
  'ChargeUp 20W PD Fast Charger': U('1624272673361-335d488ef9f7'),
  'VoltCell 10000mAh Power Bank': U('1613070541337-b40942ee6527'),
  'Veltra X12 5G Smartphone (128GB)': U('1759505017950-25e0733b9e68'),
  'Veltra Buds Air True Wireless Earbuds': U('1505236273191-1dce886b01e9'),
  'Orbisync Phone Case (Shockproof)': U('1598460196760-28bfa7884f27'),
  'ClearView Tempered Glass Screen Protector (Pack of 2)': U('1567428486597-8c5328fd3816'),
  "Fieldwear Men's Cotton Casual Shirt": U('1608681299041-cc19878f79f1'),
  "Northline Women's Kurta (Cotton Blend)": U('1743229995753-69be4b438204'),
  "Denimarc Men's Slim Fit Jeans": U('1515459961680-58264ee27219'),
  'AeroStep Running Shoes': U('1675625500632-2d276bd51920'),
  'Trailhead Unisex Backpack (25L)': U('1622560480605-d83c853bc5c3'),
  'Solstice Polarized Sunglasses': U('1610136649349-0f646f318053'),
  'Chronotime Analog Watch (Men)': U('1623998021450-85c29c644e0d'),
  'BrewMate Automatic Drip Coffee Maker': U('1705233244114-7625c14b2e74'),
  'Heatwell Electric Kettle (1.5L)': U('1594026126778-2196083a0300'),
  'Skylight Study Lamp (LED, Adjustable)': U('1507473885765-e6ed057f782c'),
  'PureFlow Stainless Steel Water Bottle (1L)': U('1664714628878-9d2aa898b9e3'),
  'HomeCraft Non-Stick Cookware Set (3-piece)': U('1556910602-38f53e68e15d'),
  'CozyKnit Cotton Bedsheet Set (Queen, 144 TC)': U('1639690222445-595b0794bbd4'),
  'Nature Aloe Vera Face Wash (150ml)': U('1739131285874-8d545cffef95'),
  'Glowlab Vitamin C Serum (30ml)': U('1747303969063-3b90bcb3942e'),
  'Silkstrand Argan Hair Oil (200ml)': U('1699373383871-4ca5636948c1'),
  'Mattelux Matte Lipstick (Shade: Terracotta)': U('1618510069246-21f564373621'),
  'Sunveil Sunscreen SPF 50 PA+++ (50g)': U('1698906821280-34072d3ac1be'),
  'The Silent Ledger (Fiction Paperback)': U('1504817281472-f56fda3040a5'),
  'Atomic Focus: A Practical Guide to Deep Work': U('1618365908648-e71bd5716cba'),
  'Notecraft Ruled Notebook Set (Pack of 3)': U('1444730558009-b7f0368e1264'),
  'Journeys of the Deccan (Travel Non-fiction)': U('1736117705769-8486f24ed58a'),
  'FlexGrip Yoga Mat (6mm)': U('1646239646963-b0b9be56d6b5'),
  'IronCore Adjustable Dumbbell Set (10kg)': U('1603077492579-39ff927823db'),
  'CourtSide Badminton Racket (Carbon Fiber)': U('1721760886982-3c643f05813d'),
  'HydroFit Sports Water Bottle (750ml)': U('1729585124216-5f7cb275ad6d'),
  'CompuNova AirBook 14 (i5, 16GB, 512GB SSD)': U('1484651890318-ca4110437e20'),
  'CompuNova EliteBook 15 (Ryzen 7, 16GB, 1TB SSD)': U('1504608245011-62d9758c1bb9'),
  'CarryTech Laptop Sleeve (15.6")': U('1763034179057-acad3a072568'),
  'ErgoDesk Laptop Stand (Aluminium)': U('1652198144911-4f204ccf35e6')
};

// Sized, compressed delivery URL (Unsplash resizes on the fly). 800px square-ish covers the
// product card and the detail page.
function photoUrl(base, width = 800) {
  return `${base}?auto=format&fit=crop&w=${width}&q=80`;
}

function imagesFor(name) {
  const base = PHOTOS[name];
  if (!base) throw new Error(`No product photo configured for "${name}" in seed/productImages.js`);
  return [photoUrl(base)];
}

module.exports = { PHOTOS, photoUrl, imagesFor };
