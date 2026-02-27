import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { LandscapeProposal, Season } from "./types";
import { getPropertyAerialImage, isEagleViewConfigured } from "./eagleviewService";
import { getPropertyData, isAssessorConfigured } from "./assessorService";

const PHX_LAT = 33.4484;
const PHX_LNG = -112.074;

// ─── Regional Multipliers (2026 Research) ────────────────────────────────
const REGIONAL_MULTIPLIERS: Record<string, number> = {
  Phoenix: 1.0,
  Mesa: 1.0,
  Tempe: 1.0,
  Chandler: 1.0,
  Gilbert: 1.05,
  "Queen Creek": 1.05,
  "North Phoenix": 1.15,
  Scottsdale: 1.2,
  "Paradise Valley": 1.2,
  "Fountain Hills": 1.2,
  Carefree: 1.2,
  "Cave Creek": 1.2,
  Glendale: 1.0,
  Peoria: 1.0,
  Surprise: 0.95,
  Goodyear: 0.95,
  Buckeye: 0.95,
};

function getRegionalMultiplier(city: string): number {
  return REGIONAL_MULTIPLIERS[city] ?? 1.0;
}

// ─── Current Season Helper ───────────────────────────────────────────────
function getCurrentSeason(): Season {
  const month = new Date().getMonth(); // 0-indexed
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "fall";
  return "winter";
}

// ─── Phoenix City Rebate Programs (2026) ─────────────────────────────────
const REBATE_PROGRAMS: Record<
  string,
  { city: string; perSqFt: number; maxRebate: number; notes: string }
> = {
  Scottsdale: {
    city: "Scottsdale",
    perSqFt: 2.0,
    maxRebate: 5000,
    notes: "Grass-to-xeriscape conversion. Recently doubled.",
  },
  Glendale: {
    city: "Glendale",
    perSqFt: 1.5,
    maxRebate: 3000,
    notes: "Xeriscape conversion rebate.",
  },
  Chandler: {
    city: "Chandler",
    perSqFt: 1.5,
    maxRebate: 2000,
    notes: "Also offers up to $3,000 for smart irrigation controller.",
  },
  Tempe: {
    city: "Tempe",
    perSqFt: 1.5,
    maxRebate: 2000,
    notes: "Up to $20,000 for commercial conversions.",
  },
  Mesa: {
    city: "Mesa",
    perSqFt: 1.0,
    maxRebate: 2000,
    notes: "G2X grass-to-xeriscape program, running 17+ years.",
  },
  Phoenix: {
    city: "Phoenix",
    perSqFt: 1.0,
    maxRebate: 1500,
    notes: "Residential Grass Incentives — new programs expanding.",
  },
  Gilbert: {
    city: "Gilbert",
    perSqFt: 1.0,
    maxRebate: 1500,
    notes: "Check Gilbert Water Conservation for current grass-to-xeriscape programs.",
  },
  Peoria: {
    city: "Peoria",
    perSqFt: 1.0,
    maxRebate: 1500,
    notes: "Water conservation rebate — verify current availability on city site.",
  },
};

// ─── Estimate rebate from city + grass area ──────────────────────────────
function estimateRebate(
  city: string,
  grassSqFt: number
): { eligible: boolean; estimatedRebate: number; program: string; notes: string } {
  const program = REBATE_PROGRAMS[city];
  if (!program || grassSqFt <= 0) {
    return {
      eligible: false,
      estimatedRebate: 0,
      program: "No matching rebate program found",
      notes: "Check local city website for current programs.",
    };
  }
  const raw = grassSqFt * program.perSqFt;
  const capped = Math.min(raw, program.maxRebate);
  return {
    eligible: true,
    estimatedRebate: capped,
    program: `${program.city} Grass-to-Xeriscape Rebate`,
    notes: program.notes,
  };
}

// ─── Geocoding (for EagleView lat/lng lookup) ───────────────────────
async function geocodeAddress(
  address: string
): Promise<{ latitude: number; longitude: number } | null> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status === "OK" && data.results?.length > 0) {
      const loc = data.results[0].geometry.location;
      return { latitude: loc.lat, longitude: loc.lng };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Build the analysis prompt ───────────────────────────────────────────
function buildPrompt(
  address: string,
  siteData: string,
  regionalMultiplier: number,
  season: Season
): string {
  return `
You are an expert desert landscape estimator with 20+ years of experience in the Greater Phoenix metro area. You specialize in xeriscape design, desert-adapted plant selection, and accurate job costing for Sonoran Desert conditions.

SITE CONTEXT FROM MAPS:
${siteData}

CLIENT ADDRESS: ${address}

REGIONAL PRICING MULTIPLIER: ${regionalMultiplier}×
Apply this multiplier to ALL line-item pricing below. This accounts for area-specific labor/material cost differences across the Phoenix metro.
- 1.0× = Central Phoenix / Mesa / Tempe / Chandler (baseline)
- 1.05× = Gilbert / Queen Creek (growing, more new builds)
- 1.15× = North Phoenix
- 1.20× = Scottsdale / Paradise Valley / Fountain Hills / Carefree (premium)
- 0.95× = Outlying (Surprise, Goodyear, Buckeye — distance offset)

CURRENT SEASON: ${season}
Seasonality notes:
- Spring (Mar–May): Peak season for installs & cleanups; higher demand, longer lead times.
- Summer (Jun–Aug): Mostly maintenance & irrigation repairs; limited install windows due to heat.
- Fall (Sep–Nov): Second install peak; excellent time for new landscapes & turf.
- Winter (Dec–Feb): Slower; design work, planning, and price competition increase.
Factor season into lead-time expectations and recommendations, not direct pricing.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK 1 — AERIAL IMAGE ANALYSIS (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If an aerial or drone image is provided, carefully analyze it and identify ALL of the following:

STRUCTURES & HARDSCAPE (exclude from renovation area):
- Building footprint / roofline
- Swimming pool and pool deck
- Concrete patio, covered patio, ramada, pergola
- Driveway and walkways
- Existing block walls or fencing

EXISTING LANDSCAPE FEATURES (note condition):
- Decomposed granite (color and condition)
- River rock, flagstone, or decorative boulders
- Existing trees (species if identifiable — Palo Verde, Mesquite, Ironwood, Palm)
- Shrubs, ground cover, cacti
- Grass / turf areas (measure separately for rebate calculation)
- Bare soil or weedy areas
- Artificial turf

INFRASTRUCTURE:
- Visible irrigation lines or valve boxes
- Landscape lighting
- Drainage channels or French drains
- Curbing or edging

AREA CALCULATIONS:
- totalLotSqFt: Estimate total lot area from the image
- buildingFootprintSqFt: Area covered by the structure
- poolAndDeckSqFt: Pool + surrounding deck (0 if no pool)
- drivewayAndWalksSqFt: Concrete/paver drives and paths
- patioSqFt: Covered or open patio areas
- existingGrassSqFt: Current turf/grass area (important for rebate)
- renovatableAreaSqFt: ONLY the area available for landscape work
  (totalLotSqFt minus building, pool, driveway, patio)

If NO image is provided, estimate conservatively based on the address, neighborhood vintage, and typical lot sizes for the area. Flag this clearly in visualObservations.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK 2 — GENERATE LINE-ITEM PROPOSAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generate a detailed renovation proposal for the RENOVATABLE AREA ONLY.
Do NOT include work for pools, existing concrete, or the building footprint.
REMEMBER: Apply the ${regionalMultiplier}× regional multiplier to all prices below.

Use current 2026 Greater Phoenix contractor pricing (BASE rates before multiplier):

SITE PREPARATION:
- Turf/weed removal & haul-off: $1.25–$1.75/sq ft
- Caliche remediation (if suspected): $3.00–$5.00/sq ft
- Grading and compaction: $0.50–$0.75/sq ft
- Pre-emergent herbicide application: $0.15–$0.25/sq ft

HARDSCAPE & GROUND COVER:
- 3/4" Decomposed Granite (screened, installed 2" depth): $140–$180/ton
  → Coverage: ~80 sq ft per ton at 2" depth
- River Rock (1"–3"): $180–$250/ton
- Flagstone pathways/patios: $15–$30/sq ft installed
- Paver patios/walkways: $15–$35/sq ft installed
- Retaining walls: $25–$45/sq ft
- Decorative boulders (surface select): $300–$450/ton
- Concrete curbing/edging: $5–$8/linear ft

ARTIFICIAL TURF:
- Budget synthetic turf (installed): $5–$10/sq ft
- Standard residential turf (installed): $8–$14/sq ft
- Premium pet-friendly / cooling-tech turf (installed): $15–$20/sq ft

IRRIGATION:
- Drip system renovation (valve, filter, poly tubing, emitters): $1,800–$2,800 lump sum
- Full sprinkler system installation: $2,100–$3,000 per system
- Smart Wi-Fi irrigation controller (Rachio/Weathermatic): $250–$400 installed
- Per-zone add-on: $350–$500/zone

DESERT TREES (installed with warranty):
- 24" Box Palo Verde (Museum or Desert): $550–$750 each
- 24" Box Mesquite (Chilean or Velvet): $500–$700 each
- 15 Gallon Ironwood: $350–$500 each
- 15 Gallon Desert Willow: $250–$400 each

TREE SERVICES:
- Tree trimming (medium): $200–$900+ per tree
- Tree removal (large): $300–$2,000+ per tree (size, access, risk)
- Stump grinding: $100–$400 per stump

DESERT PLANTS & CACTI:
- 15 Gallon Agave (various species): $100–$150 each
- 5 Gallon accent shrubs (Texas Sage, Red Yucca, Ruellia): $35–$55 each
- 1 Gallon ground cover (Lantana, Damianita, Blackfoot Daisy): $8–$14 each
- Barrel Cactus (10–15"): $75–$125 each
- Saguaro (4–6 ft, permitted): $500–$1,200 each

WATER FEATURES:
- Ponds & fountains: $2,400–$11,000+ per feature

LIGHTING:
- Low-voltage LED landscape lighting kit (transformer + 6–8 fixtures): $1,000–$2,000
- Full landscape lighting system (12+ fixtures, path + accent + uplights): $2,000–$8,000

FINISHING:
- Weed barrier fabric: $0.35–$0.50/sq ft

LABOR:
- General labor: included in line-item pricing above
- Design consultation (if full redesign): $500–$1,500

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK 3 — REBATE ELIGIBILITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If existing grass/turf was identified, note the square footage.
The system will calculate rebate eligibility automatically.
In your recommendations, mention that a city rebate may apply for grass removal.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK 4 — EXPERT RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Provide 3–5 actionable recommendations specific to THIS property:
- Soil/caliche concerns based on neighborhood
- Monsoon drainage considerations
- Heat-reflective material choices
- Water-saving strategies
- Plant placement for shade optimization
- Maintenance schedule for Phoenix climate
- Season-specific advice (current season: ${season})

OUTPUT: Return ONLY a valid JSON object matching the schema provided.
Do NOT wrap in markdown code fences.
`;
}

// ─── Main proposal generator ─────────────────────────────────────────────
export const generateProposal = async (
  address: string,
  imageContentInput?: { data: string; mimeType: string },
  location?: { latitude: number; longitude: number }
): Promise<LandscapeProposal> => {
  let imageContent = imageContentInput;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });

  // ── Step 1: Pull site context via Gemini + Google Maps ─────────────────
  const siteContextResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Analyze this Greater Phoenix address for landscaping:
      Address: ${address}
      
      Provide:
      1. Which city/municipality is this in? (Phoenix, Scottsdale, Tempe, Mesa, Chandler, Glendale, Gilbert, Peoria, Surprise, Goodyear, Buckeye, Queen Creek, Cave Creek, Carefree, Fountain Hills, Paradise Valley, etc.)
      2. Typical lot size for this neighborhood and era of construction
      3. Soil conditions — is caliche common in this area?
      4. HOA presence likely? Any known landscape restrictions?
      5. Neighborhood character — older established, new subdivision, custom homes?
      6. Estimated front yard vs back yard split
      7. Distance from nearest nursery/material supplier`,
    config: {
      tools: [{ googleMaps: {} }],
      toolConfig: {
        retrievalConfig: {
          latLng: {
            latitude: location?.latitude || PHX_LAT,
            longitude: location?.longitude || PHX_LNG,
          },
        },
      },
    },
  });

  const siteData =
    siteContextResponse.text ||
    "Standard Phoenix lot details assumed. Unable to retrieve specific site context.";

  // Extract city for rebate + multiplier lookup
  const cityMatch = siteData.match(
    /\b(Scottsdale|Paradise Valley|Fountain Hills|Carefree|Cave Creek|Queen Creek|North Phoenix|Glendale|Chandler|Tempe|Mesa|Phoenix|Gilbert|Peoria|Surprise|Goodyear|Buckeye)\b/i
  );
  const detectedCity = cityMatch ? cityMatch[1] : "Phoenix";
  const regionalMultiplier = getRegionalMultiplier(detectedCity);
  const season = getCurrentSeason();

  // ── Step 1.5: Auto-acquire EagleView aerial imagery if none provided ──
  let imageSource: "user-uploaded" | "eagleview" | "none" = imageContent
    ? "user-uploaded"
    : "none";

  if (!imageContent && isEagleViewConfigured()) {
    console.log("No user image — attempting EagleView aerial imagery...");
    const coords = location || (await geocodeAddress(address));
    if (coords) {
      try {
        const evImage = await getPropertyAerialImage(
          coords.latitude,
          coords.longitude
        );
        if (evImage) {
          imageContent = {
            data: evImage.imageData,
            mimeType: evImage.mimeType,
          };
          imageSource = "eagleview";
          console.log(
            `EagleView: ${evImage.tileCount} tiles, ${evImage.coverageMeters}m coverage`
          );
        }
      } catch (e) {
        console.warn("EagleView failed, continuing without:", e);
      }
    }
  }

  // ── Step 1.7: Fetch real parcel data from Maricopa County Assessor ────
  let parcelContext = "";
  if (isAssessorConfigured()) {
    try {
      const parcel = await getPropertyData(address);
      if (parcel) {
        const lines = [
          "VERIFIED COUNTY PARCEL DATA (Maricopa County Assessor — use these as ground truth):",
          `  APN: ${parcel.apn}`,
        ];
        if (parcel.lotSizeSqFt) lines.push(`  Lot Size: ${parcel.lotSizeSqFt.toLocaleString()} sq ft`);
        if (parcel.buildingSqFt) lines.push(`  Building Footprint: ${parcel.buildingSqFt.toLocaleString()} sq ft`);
        if (parcel.yearBuilt) lines.push(`  Year Built: ${parcel.yearBuilt}`);
        if (parcel.poolOnSite !== null) lines.push(`  Pool: ${parcel.poolOnSite ? "Yes" : "No"}`);
        if (parcel.stories) lines.push(`  Stories: ${parcel.stories}`);
        if (parcel.constructionType) lines.push(`  Construction: ${parcel.constructionType}`);
        if (parcel.subdivision) lines.push(`  Subdivision: ${parcel.subdivision}`);
        if (parcel.zoningCode) lines.push(`  Zoning: ${parcel.zoningCode}`);
        if (parcel.landUse) lines.push(`  Land Use: ${parcel.landUse}`);
        lines.push("Use these verified measurements instead of estimating. Calculate renovatableAreaSqFt = lotSizeSqFt - buildingSqFt - poolAndDeckSqFt - drivewayAndWalksSqFt - patioSqFt.");
        parcelContext = lines.join("\n");
        console.log(`Assessor: parcel ${parcel.apn} — lot ${parcel.lotSizeSqFt} sqft, built ${parcel.yearBuilt}`);
      }
    } catch (e) {
      console.warn("Assessor lookup failed, continuing without:", e);
    }
  }

  // ── Step 2: Build prompt and send with image ───────────────────────────
  let prompt = buildPrompt(address, siteData, regionalMultiplier, season);

  // Inject verified parcel data into the prompt
  if (parcelContext) {
    prompt += `\n\n${parcelContext}`;
  }

  const parts: any[] = [{ text: prompt }];

  if (imageContent) {
    parts.push({
      inlineData: {
        data: imageContent.data,
        mimeType: imageContent.mimeType,
      },
    });

    if (imageSource === "eagleview") {
      parts.push({
        text: "\n\nNOTE: The attached image is high-resolution EagleView aerial imagery (~2cm GSD). Use it for precise area measurements.",
      });
    }
  }

  const result: GenerateContentResponse = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          clientName: { type: "string" },
          address: { type: "string" },

          // ── Area breakdown ──
          totalLotSqFt: { type: "number" },
          buildingFootprintSqFt: { type: "number" },
          poolAndDeckSqFt: { type: "number" },
          drivewayAndWalksSqFt: { type: "number" },
          patioSqFt: { type: "number" },
          existingGrassSqFt: { type: "number" },
          renovatableAreaSqFt: { type: "number" },

          // ── Existing features found ──
          existingFeatures: {
            type: "array",
            items: { type: "string" },
          },

          // ── Line items ──
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string" },
                description: { type: "string" },
                quantity: { type: "number" },
                unit: { type: "string" },
                unitPrice: { type: "number" },
                totalPrice: { type: "number" },
              },
              required: [
                "category",
                "description",
                "quantity",
                "unit",
                "unitPrice",
                "totalPrice",
              ],
            },
          },

          totalEstimate: { type: "number" },
          recommendations: {
            type: "array",
            items: { type: "string" },
          },
          visualObservations: { type: "string" },
          imageAnalyzed: { type: "boolean" },
          confidenceLevel: { type: "string" },
        },
        required: [
          "clientName",
          "address",
          "totalLotSqFt",
          "renovatableAreaSqFt",
          "existingFeatures",
          "items",
          "totalEstimate",
          "recommendations",
          "visualObservations",
          "imageAnalyzed",
          "confidenceLevel",
        ],
      },
    },
  });

  // ── Step 3: Parse and enrich with rebate + regional data ───────────────
  try {
    const jsonStr = result.text.trim();
    const proposal = JSON.parse(jsonStr) as LandscapeProposal;

    // Override confidence level based on image source
    if (imageSource === "eagleview") {
      proposal.confidenceLevel = "high";
    } else if (imageSource === "none" && proposal.confidenceLevel === "high") {
      proposal.confidenceLevel = "medium";
    }

    // Attach regional & seasonal context
    proposal.regionalMultiplier = regionalMultiplier;
    proposal.season = season;

    // Calculate rebate eligibility
    const grassArea = proposal.existingGrassSqFt || 0;
    const rebate = estimateRebate(detectedCity, grassArea);

    proposal.rebateInfo = {
      city: detectedCity,
      eligible: rebate.eligible,
      estimatedRebate: rebate.estimatedRebate,
      program: rebate.program,
      notes: rebate.notes,
      existingGrassSqFt: grassArea,
    };

    // Add rebate to recommendations if eligible
    if (rebate.eligible && rebate.estimatedRebate > 0) {
      proposal.recommendations.push(
        `💰 ${detectedCity} Rebate: You may qualify for up to $${rebate.estimatedRebate.toLocaleString()} through the ${rebate.program}. This could reduce your net cost to ~$${(proposal.totalEstimate - rebate.estimatedRebate).toLocaleString()}.`
      );
    }

    // Add net cost after rebate
    proposal.netEstimateAfterRebate =
      proposal.totalEstimate - (rebate.estimatedRebate || 0);

    return proposal;
  } catch (e) {
    console.error("Failed to parse proposal JSON:", e);
    throw new Error(
      "The AI generated an invalid proposal format. Please try again."
    );
  }
};
