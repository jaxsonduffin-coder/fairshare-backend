import { dbReady, db, id, persist, flushDb, resetDb } from "./lib/store";
import { Brand } from "./types";

// Demo brand directory. In production this would be a curated, continuously
// updated dataset (ideally with real contact/outreach permission on file) —
// these are illustrative example brands, not real contacts, for the
// prototype build. worksWithAthletes marks brands relevant to the college
// athlete NIL-matching feature.
export const demoBrands: Omit<Brand, "id">[] = [
  { name: "Verde Sports Nutrition", industry: "Sports Nutrition", contactEmail: "partnerships@verdesports.example.com", worksWithCreators: true, worksWithAthletes: true, typicalBudgetMin: 300, typicalBudgetMax: 2500, preferredNiches: ["sports", "fitness"], notes: "Runs a standing NIL micro-influencer program for college athletes." },
  { name: "Summit Outdoor Gear", industry: "Outdoor / Apparel", contactEmail: "creators@summitoutdoor.example.com", worksWithCreators: true, worksWithAthletes: true, typicalBudgetMin: 250, typicalBudgetMax: 3000, preferredNiches: ["sports", "fitness", "lifestyle"] },
  { name: "PulseFuel Energy Drinks", industry: "Beverage", contactEmail: "nil@pulsefuel.example.com", worksWithCreators: true, worksWithAthletes: true, typicalBudgetMin: 500, typicalBudgetMax: 5000, preferredNiches: ["sports", "fitness", "gaming"] },
  { name: "Brightline Bank", industry: "Fintech", contactEmail: "influencer@brightlinebank.example.com", worksWithCreators: true, worksWithAthletes: false, typicalBudgetMin: 1000, typicalBudgetMax: 8000, preferredNiches: ["finance", "lifestyle"] },
  { name: "Glow Theory Skincare", industry: "Beauty", contactEmail: "collabs@glowtheory.example.com", worksWithCreators: true, worksWithAthletes: false, typicalBudgetMin: 400, typicalBudgetMax: 4000, preferredNiches: ["beauty", "fashion", "lifestyle"] },
  { name: "Northbound Apparel", industry: "Fashion", contactEmail: "ambassadors@northboundapparel.example.com", worksWithCreators: true, worksWithAthletes: true, typicalBudgetMin: 200, typicalBudgetMax: 2000, preferredNiches: ["fashion", "lifestyle", "sports"] },
  { name: "StackByte Software", industry: "Tech / SaaS", contactEmail: "creators@stackbyte.example.com", worksWithCreators: true, worksWithAthletes: false, typicalBudgetMin: 800, typicalBudgetMax: 6000, preferredNiches: ["tech", "software", "gaming"] },
  { name: "Homestead Meal Co.", industry: "Food & Beverage", contactEmail: "partners@homesteadmeal.example.com", worksWithCreators: true, worksWithAthletes: true, typicalBudgetMin: 200, typicalBudgetMax: 1800, preferredNiches: ["food", "fitness", "family"] },
  { name: "Tandem Travel", industry: "Travel", contactEmail: "creator@tandemtravel.example.com", worksWithCreators: true, worksWithAthletes: false, typicalBudgetMin: 500, typicalBudgetMax: 5000, preferredNiches: ["travel", "lifestyle"] },
  { name: "PlayCore Gaming Gear", industry: "Gaming / Electronics", contactEmail: "sponsorships@playcoregear.example.com", worksWithCreators: true, worksWithAthletes: true, typicalBudgetMin: 300, typicalBudgetMax: 4000, preferredNiches: ["gaming", "tech"] },
];

export async function seed(): Promise<void> {
  await dbReady;
  await resetDb();
  demoBrands.forEach((b) => db.brands.push({ ...b, id: id() }));
  persist();
  await flushDb();
  // eslint-disable-next-line no-console
  console.log(`Seeded ${db.brands.length} demo brands.`);
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
