// ─── DesertVision AI — Maricopa County Assessor Service ───────────────
//
// Fetches real parcel data (lot size, building footprint, year built)
// from the Maricopa County Assessor's official REST API.
// Replaces AI-estimated lot dimensions with ground-truth county records.
//
// API Docs: https://mcassessor.maricopa.gov/file/home/MC-Assessor-API-Documentation.pdf
// Auth: Requires API token via AUTHORIZATION header (request at Contact Us → "API Question/Token")
//
// Flow:
//   1. GET /search/property/?q={address} → find APN (Assessor Parcel Number)
//   2. GET /parcel/{apn}/propertyinfo    → lot size, land use
//   3. GET /parcel/{apn}/residential-details → building sqft, year built, pool, etc.

const BASE_URL = "https://mcassessor.maricopa.gov";

// ─── Types ───────────────────────────────────────────────────────────

interface SearchResult {
  apn: string;
  address: string;
  city: string;
  zip: string;
  parcelType: string;
}

export interface ParcelData {
  apn: string;
  address: string;
  city: string;

  // Area measurements (from county records — ground truth)
  lotSizeSqFt: number | null;
  buildingSqFt: number | null;
  yearBuilt: number | null;

  // Extras that help the AI
  poolOnSite: boolean | null;
  garageSpaces: number | null;
  stories: number | null;
  constructionType: string | null;
  subdivision: string | null;
  zoningCode: string | null;
  landUse: string | null;
}

// ─── Config ──────────────────────────────────────────────────────────

function getToken(): string | null {
  return process.env.MARICOPA_API_TOKEN || null;
}

export function isAssessorConfigured(): boolean {
  return !!getToken();
}

// ─── API Helpers ─────────────────────────────────────────────────────

async function assessorFetch(path: string): Promise<any | null> {
  const token = getToken();
  if (!token) return null;

  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: token,
      "user-agent": "",
    },
  });

  if (!response.ok) {
    console.warn(`Assessor API ${path}: ${response.status}`);
    return null;
  }

  return response.json();
}

// ─── Search by Address ──────────────────────────────────────────────

async function searchProperty(address: string): Promise<SearchResult | null> {
  const data = await assessorFetch(
    `/search/property/?q=${encodeURIComponent(address)}`
  );

  if (!data) return null;

  // The search returns grouped results; pull the first real property match
  const properties = data?.RealProperty || data?.realProperty || [];
  if (Array.isArray(properties) && properties.length > 0) {
    const first = properties[0];
    return {
      apn: first.APN || first.apn || first.Apn || "",
      address:
        first.Address || first.address || first.FullAddress || address,
      city: first.City || first.city || "",
      zip: first.Zip || first.zip || "",
      parcelType: first.ParcelType || first.parcelType || "Residential",
    };
  }

  // Try flat array response
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    return {
      apn: first.APN || first.apn || "",
      address: first.Address || first.address || address,
      city: first.City || first.city || "",
      zip: first.Zip || first.zip || "",
      parcelType: first.ParcelType || first.parcelType || "Residential",
    };
  }

  return null;
}

// ─── Fetch Parcel Details ───────────────────────────────────────────

async function fetchPropertyInfo(apn: string): Promise<Record<string, any> | null> {
  return assessorFetch(`/parcel/${apn}/propertyinfo`);
}

async function fetchResidentialDetails(apn: string): Promise<Record<string, any> | null> {
  return assessorFetch(`/parcel/${apn}/residential-details`);
}

// ─── Safe field extractors ──────────────────────────────────────────

function findField(obj: Record<string, any>, ...keys: string[]): any {
  for (const key of keys) {
    // Check exact key
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    // Check case-insensitive
    const lower = key.toLowerCase();
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === lower && obj[k] !== undefined && obj[k] !== null) {
        return obj[k];
      }
    }
  }
  return null;
}

function toNumber(val: any): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function toBool(val: any): boolean | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    return ["yes", "y", "true", "1"].includes(val.toLowerCase());
  }
  return !!val;
}

// ─── Main Export: Get Property Data by Address ──────────────────────

/**
 * Look up a Phoenix-area property by address and return real parcel data
 * from Maricopa County records. Returns null if the API is not configured
 * or the property isn't found.
 *
 * Usage in geminiService.ts:
 *   const parcel = await getPropertyData("8421 E Desert View Dr, Scottsdale, AZ");
 *   if (parcel) {
 *     // Inject parcel.lotSizeSqFt, parcel.buildingSqFt, parcel.yearBuilt
 *     // into the Gemini prompt as ground-truth data
 *   }
 */
export async function getPropertyData(
  address: string
): Promise<ParcelData | null> {
  if (!isAssessorConfigured()) return null;

  try {
    // Step 1: Search for the property to get APN
    const searchResult = await searchProperty(address);
    if (!searchResult?.apn) {
      console.warn("Assessor: no parcel found for address:", address);
      return null;
    }

    const apn = searchResult.apn;
    console.log(`Assessor: found APN ${apn} for "${address}"`);

    // Step 2: Fetch property info + residential details in parallel
    const [propInfo, resDetails] = await Promise.all([
      fetchPropertyInfo(apn),
      fetchResidentialDetails(apn),
    ]);

    // Merge both responses for field extraction
    const merged = { ...propInfo, ...resDetails };

    return {
      apn,
      address: searchResult.address,
      city: searchResult.city,

      lotSizeSqFt: toNumber(
        findField(merged, "LotSizeSqFt", "LotSize", "LotArea", "AcresSqFt", "TotalLandArea")
      ),
      buildingSqFt: toNumber(
        findField(merged, "BuildingSqFt", "LivingArea", "TotalLivingArea", "GrossArea", "TotalBuildingArea")
      ),
      yearBuilt: toNumber(
        findField(merged, "YearBuilt", "YrBuilt", "BuiltYear")
      ),

      poolOnSite: toBool(
        findField(merged, "Pool", "PoolOnSite", "HasPool")
      ),
      garageSpaces: toNumber(
        findField(merged, "GarageSpaces", "Garage", "GarageCars")
      ),
      stories: toNumber(
        findField(merged, "Stories", "NumberOfStories", "NumStories")
      ),
      constructionType: findField(merged, "ConstructionType", "Construction", "WallType") as string | null,
      subdivision: findField(merged, "Subdivision", "SubdivisionName") as string | null,
      zoningCode: findField(merged, "Zoning", "ZoningCode", "ZoneCode") as string | null,
      landUse: findField(merged, "LandUse", "LandUseCode", "UseCode") as string | null,
    };
  } catch (e) {
    console.warn("Assessor lookup failed:", e);
    return null;
  }
}
