/* ============================================================
   Waymate — Delhi Metro Blue Line reference data
   km = approximate distance from Dwarka Sector 21, used only
    for fare/time estimation. Not official DMRC data.
   br: "T" = trunk (Dwarka Sec 21 ↔ Yamuna Bank)
       "V" = Vaishali branch (after Yamuna Bank)
       "N" = Noida branch (after Yamuna Bank)
   ix = interchange lines
   ============================================================ */

const BLUE_LINE = [
  // ---- Trunk: Dwarka Sector 21 → Yamuna Bank ----
  { name: "Dwarka Sector 21",   km: 0.0,  br: "T", ix: ["Airport Exp"] },
  { name: "Dwarka Sector 8",    km: 1.6,  br: "T", ix: [] },
  { name: "Dwarka Sector 9",    km: 2.6,  br: "T", ix: [] },
  { name: "Dwarka Sector 10",   km: 3.7,  br: "T", ix: [] },
  { name: "Dwarka Sector 11",   km: 4.8,  br: "T", ix: [] },
  { name: "Dwarka Sector 12",   km: 5.9,  br: "T", ix: [] },
  { name: "Dwarka Sector 13",   km: 7.1,  br: "T", ix: [] },
  { name: "Dwarka Sector 14",   km: 8.2,  br: "T", ix: [] },
  { name: "Dwarka",             km: 9.6,  br: "T", ix: [] },
  { name: "Nawada",             km: 10.8, br: "T", ix: [] },
  { name: "Uttam Nagar West",   km: 12.0, br: "T", ix: [] },
  { name: "Uttam Nagar East",   km: 13.2, br: "T", ix: [] },
  { name: "Janakpuri West",     km: 14.5, br: "T", ix: ["Magenta"] },
  { name: "Janakpuri East",     km: 15.6, br: "T", ix: [] },
  { name: "Tilak Nagar",        km: 16.8, br: "T", ix: [] },
  { name: "Subhash Nagar",      km: 17.8, br: "T", ix: [] },
  { name: "Tagore Garden",      km: 18.9, br: "T", ix: [] },
  { name: "Rajouri Garden",     km: 20.2, br: "T", ix: ["Pink"] },
  { name: "Ramesh Nagar",       km: 21.3, br: "T", ix: [] },
  { name: "Moti Nagar",         km: 22.3, br: "T", ix: [] },
  { name: "Kirti Nagar",        km: 23.4, br: "T", ix: ["Green"] },
  { name: "Shadipur",           km: 24.5, br: "T", ix: [] },
  { name: "Patel Nagar",        km: 25.6, br: "T", ix: [] },
  { name: "Rajendra Place",     km: 26.6, br: "T", ix: [] },
  { name: "Karol Bagh",         km: 27.6, br: "T", ix: [] },
  { name: "Jhandewalan",        km: 28.6, br: "T", ix: [] },
  { name: "Ramakrishna Ashram Marg", km: 29.6, br: "T", ix: [] },
  { name: "Rajiv Chowk",        km: 30.6, br: "T", ix: ["Yellow"] },
  { name: "Barakhamba Road",    km: 31.6, br: "T", ix: [] },
  { name: "Mandi House",        km: 32.6, br: "T", ix: ["Violet"] },
  { name: "Pragati Maidan (Supreme Court)", km: 33.8, br: "T", ix: ["Magenta"] },
  { name: "Indraprastha",       km: 35.0, br: "T", ix: [] },
  { name: "Yamuna Bank",        km: 36.4, br: "T", ix: [] },

  // ---- Vaishali branch ----
  { name: "Laxmi Nagar",        km: 38.0, br: "V", ix: [] },
  { name: "Nirman Vihar",       km: 39.1, br: "V", ix: [] },
  { name: "Preet Vihar",        km: 40.2, br: "V", ix: [] },
  { name: "Karkarduma",         km: 41.4, br: "V", ix: ["Pink"] },
  { name: "Anand Vihar ISBT",   km: 42.7, br: "V", ix: ["Pink"] },
  { name: "Kaushambi",          km: 43.8, br: "V", ix: [] },
  { name: "Vaishali",           km: 45.0, br: "V", ix: [] },

  // ---- Noida branch ----
  { name: "Akshardham",         km: 38.2, br: "N", ix: [] },
  { name: "Mayur Vihar-I",      km: 39.8, br: "N", ix: [] },
  { name: "Mayur Vihar Ext.",   km: 41.2, br: "N", ix: [] },
  { name: "New Ashok Nagar",    km: 42.7, br: "N", ix: [] },
  { name: "Noida Sector 15",    km: 44.2, br: "N", ix: [] },
  { name: "Noida Sector 16",    km: 45.5, br: "N", ix: [] },
  { name: "Noida Sector 18",    km: 47.0, br: "N", ix: [] },
  { name: "Botanical Garden",   km: 48.3, br: "N", ix: ["Magenta"] },
  { name: "Golf Course",        km: 49.4, br: "N", ix: [] },
  { name: "Noida City Centre",  km: 50.6, br: "N", ix: [] },
];

/* DMRC-style fare slabs (token fare, approximate) */
function fareForKm(km) {
  if (km <= 2)  return 10;
  if (km <= 5)  return 20;
  if (km <= 12) return 30;
  if (km <= 21) return 40;
  if (km <= 32) return 50;
  return 60;
}
