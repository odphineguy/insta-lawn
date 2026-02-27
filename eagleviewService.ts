// ─── DesertVision AI — EagleView Imagery Service ──────────────────────
//
// Fetches high-resolution aerial imagery (~1.87cm GSD) from EagleView's
// Imagery API v3. Used as a premium upgrade over Google Maps Static API
// (~30cm GSD) for more accurate landscape zone segmentation.
//
// API Pattern:
//   1. OAuth2 token via client credentials
//   2. POST /imagery/v3/discovery/rank/location → get image URN
//   3. GET  /imagery/v3/images/{urn}/tiles/{z}/{x}/{y} → fetch tiles
//   4. Stitch tiles into a single image for Gemini analysis

import sharp from "sharp";

// ─── Config ──────────────────────────────────────────────────────────

interface EagleViewConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  baseUrl: string;        // sandbox or production
  defaultZoom: number;    // 19-20 ideal for property-level analysis
  tileFormat: string;
  tileQuality: number;
}

const SANDBOX_CONFIG: EagleViewConfig = {
  clientId: process.env.EAGLEVIEW_CLIENT_ID || "",
  clientSecret: process.env.EAGLEVIEW_CLIENT_SECRET || "",
  tokenUrl: "https://apicenter.eagleview.com/oauth2/v1/token",
  baseUrl: "https://sandbox.apis.eagleview.com",
  defaultZoom: 19,
  tileFormat: "IMAGE_FORMAT_JPEG",
  tileQuality: 90,
};

const PRODUCTION_CONFIG: EagleViewConfig = {
  ...SANDBOX_CONFIG,
  baseUrl: "https://apis.eagleview.com",
};

const config: EagleViewConfig =
  process.env.EAGLEVIEW_ENV === "production" ? PRODUCTION_CONFIG : SANDBOX_CONFIG;

// ─── Types ───────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface EagleViewImage {
  urn: string;
  calculated_gsd?: {
    value: number;
    units: string;
  };
  zoom_range?: {
    minimum_zoom_level: number;
    maximum_zoom_level: number;
  };
}

interface EagleViewCapture {
  capture: {
    urn: string;
    start_date: string;
    end_date: string;
    labels: string[];
  };
  obliques: {
    images: EagleViewImage[];
  } | null;
  orthos: {
    images: EagleViewImage[];
  } | null;
}

interface DiscoveryResponse {
  captures: EagleViewCapture[];
  next_capture_token?: string;
}

interface OrthomosaicSearchResponse {
  orthomosaics: { urn: string }[];
  page?: { next: string };
}

export interface EagleViewPropertyImage {
  imageData: string;        // base64-encoded JPEG
  mimeType: string;         // "image/jpeg"
  source: "eagleview";
  imageUrn: string;
  captureDate: string;
  gsdMeters: number;        // ground sample distance
  zoomLevel: number;
  tileCount: number;        // how many tiles were stitched
  coverageMeters: number;   // approximate width/height in meters
}

// ─── Token Management ────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 5-min buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 300_000) {
    return cachedToken;
  }

  const credentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`
  ).toString("base64");

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error(
      `EagleView auth failed: ${response.status} ${await response.text()}`
    );
  }

  const data: TokenResponse = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  return cachedToken;
}

// ─── Slippy Map Tile Math ────────────────────────────────────────────

function latLngToTile(
  lat: number,
  lng: number,
  zoom: number
): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

function tileToLatLng(
  x: number,
  y: number,
  zoom: number
): { lat: number; lng: number } {
  const n = Math.pow(2, zoom);
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lng };
}

/** Approximate meters per pixel at a given latitude and zoom */
function metersPerPixel(lat: number, zoom: number): number {
  return (
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
  );
}

// ─── Discovery ───────────────────────────────────────────────────────

/**
 * Find the best ortho image URN for a property location.
 * Uses a small polygon (~150m × 150m) around the point.
 */
export async function discoverOrthoImage(
  latitude: number,
  longitude: number
): Promise<{
  imageUrn: string;
  captureDate: string;
  gsdMeters: number;
  maxZoom: number;
} | null> {
  const token = await getAccessToken();

  // Build a small bounding polygon (~0.0015° ≈ 150m at Phoenix latitude)
  const d = 0.00075;
  const polygon = `SRID=4326;POLYGON((${longitude - d} ${latitude - d},${longitude + d} ${latitude - d},${longitude + d} ${latitude + d},${longitude - d} ${latitude + d},${longitude - d} ${latitude - d}))`;

  const response = await fetch(
    `${config.baseUrl}/imagery/v3/discovery/rank/location`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        polygon: {
          ewkt: { value: polygon },
        },
        view: {
          orthos: {},
          max_images_per_view: 1,
        },
        response_props: {
          calculated_gsd: true,
          zoom_range: true,
        },
      }),
    }
  );

  if (!response.ok) {
    console.error(
      `EagleView discovery failed: ${response.status}`,
      await response.text()
    );
    return null;
  }

  const data: DiscoveryResponse = await response.json();

  for (const capture of data.captures || []) {
    const orthoImages = capture.orthos?.images || [];
    if (orthoImages.length > 0) {
      const img = orthoImages[0];
      return {
        imageUrn: img.urn,
        captureDate: capture.capture.start_date,
        gsdMeters: img.calculated_gsd?.value || 0.02,
        maxZoom: img.zoom_range?.maximum_zoom_level || 21,
      };
    }
  }

  // Fallback: search orthomosaics
  return discoverOrthomosaic(latitude, longitude);
}

/**
 * Fallback: search orthomosaic products covering the location.
 */
async function discoverOrthomosaic(
  latitude: number,
  longitude: number
): Promise<{
  imageUrn: string;
  captureDate: string;
  gsdMeters: number;
  maxZoom: number;
} | null> {
  const token = await getAccessToken();

  const d = 0.00075;
  const polygon = `SRID=4326;POLYGON((${longitude - d} ${latitude - d},${longitude + d} ${latitude - d},${longitude + d} ${latitude + d},${longitude - d} ${latitude + d},${longitude - d} ${latitude - d}))`;

  const response = await fetch(
    `${config.baseUrl}/imagery/v3/discovery/orthomosaics/search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        location: {
          area: {
            ewkt: { value: polygon },
          },
        },
        page: { size: 1 },
      }),
    }
  );

  if (!response.ok) return null;

  const data: OrthomosaicSearchResponse = await response.json();
  if (data.orthomosaics?.length > 0) {
    return {
      imageUrn: data.orthomosaics[0].urn,
      captureDate: "unknown",
      gsdMeters: 0.02,
      maxZoom: 21,
    };
  }

  return null;
}

// ─── Tile Fetching ───────────────────────────────────────────────────

/** Fetch a single 256×256 tile as a Buffer */
async function fetchTile(
  imageUrn: string,
  z: number,
  x: number,
  y: number
): Promise<Buffer | null> {
  const token = await getAccessToken();

  const url =
    `${config.baseUrl}/imagery/v3/images/${encodeURIComponent(imageUrn)}` +
    `/tiles/${z}/${x}/${y}` +
    `?format=${config.tileFormat}&quality=${config.tileQuality}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    console.warn(`EagleView tile ${z}/${x}/${y} failed: ${response.status}`);
    return null;
  }

  return Buffer.from(await response.arrayBuffer());
}

// ─── Image Stitching ─────────────────────────────────────────────────

/**
 * Fetch a grid of tiles around a lat/lng and stitch into a single image.
 *
 * @param imageUrn  - from discovery
 * @param latitude  - property center
 * @param longitude - property center
 * @param zoom      - tile zoom level (19 = ~0.3m/px, 20 = ~0.15m/px)
 * @param gridSize  - NxN grid of tiles (3 = 768×768px, 4 = 1024×1024px)
 * @returns base64-encoded JPEG of stitched image
 */
export async function fetchPropertyImage(
  imageUrn: string,
  latitude: number,
  longitude: number,
  zoom: number = config.defaultZoom,
  gridSize: number = 3
): Promise<Buffer | null> {
  const center = latLngToTile(latitude, longitude, zoom);
  const half = Math.floor(gridSize / 2);

  // Fetch all tiles in parallel
  const tilePromises: Promise<{ x: number; y: number; data: Buffer | null }>[] =
    [];

  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const tx = center.x + dx;
      const ty = center.y + dy;
      tilePromises.push(
        fetchTile(imageUrn, zoom, tx, ty).then((data) => ({
          x: dx + half,
          y: dy + half,
          data,
        }))
      );
    }
  }

  const tiles = await Promise.all(tilePromises);
  const validTiles = tiles.filter((t) => t.data !== null);

  if (validTiles.length === 0) {
    console.error("EagleView: no valid tiles returned");
    return null;
  }

  // Stitch tiles using sharp (or return single tile if 1×1)
  if (gridSize === 1 && validTiles.length === 1) {
    return validTiles[0].data;
  }

  const tileSize = 256;
  const outputSize = gridSize * tileSize;

  const composite = validTiles
    .filter((t) => t.data)
    .map((t) => ({
      input: t.data as Buffer,
      left: t.x * tileSize,
      top: t.y * tileSize,
    }));

  try {
    const stitched = await sharp({
      create: {
        width: outputSize,
        height: outputSize,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite(composite)
      .jpeg({ quality: 92 })
      .toBuffer();

    return stitched;
  } catch (e) {
    console.error("EagleView tile stitching failed:", e);
    const centerTile = tiles.find((t) => t.x === half && t.y === half);
    return centerTile?.data || null;
  }
}

// ─── Main Export: Get Property Aerial Image ──────────────────────────

/**
 * Complete flow: discover imagery → fetch tiles → stitch → return base64.
 * This is the main function called by geminiService.generateProposal().
 *
 * Returns an image suitable for passing to Gemini as:
 *   { data: result.imageData, mimeType: result.mimeType }
 */
export async function getPropertyAerialImage(
  latitude: number,
  longitude: number,
  options: {
    zoom?: number;
    gridSize?: number; // 3 = 768px, 4 = 1024px, 5 = 1280px
  } = {}
): Promise<EagleViewPropertyImage | null> {
  const zoom = options.zoom || config.defaultZoom;
  const gridSize = options.gridSize || 4; // 1024×1024 default

  // Step 1: Discover best ortho image
  const discovery = await discoverOrthoImage(latitude, longitude);
  if (!discovery) {
    console.warn(
      `EagleView: no imagery available at ${latitude}, ${longitude}`
    );
    return null;
  }

  // Clamp zoom to available range
  const effectiveZoom = Math.min(zoom, discovery.maxZoom);

  // Step 2: Fetch and stitch tiles
  const imageBuffer = await fetchPropertyImage(
    discovery.imageUrn,
    latitude,
    longitude,
    effectiveZoom,
    gridSize
  );

  if (!imageBuffer) return null;

  // Step 3: Calculate coverage
  const mpp = metersPerPixel(latitude, effectiveZoom);
  const coverageMeters = mpp * gridSize * 256;

  return {
    imageData: imageBuffer.toString("base64"),
    mimeType: "image/jpeg",
    source: "eagleview",
    imageUrn: discovery.imageUrn,
    captureDate: discovery.captureDate,
    gsdMeters: discovery.gsdMeters,
    zoomLevel: effectiveZoom,
    tileCount: gridSize * gridSize,
    coverageMeters: Math.round(coverageMeters),
  };
}

// ─── Utility: Check if EagleView is configured ───────────────────────

export function isEagleViewConfigured(): boolean {
  return !!(config.clientId && config.clientSecret);
}

// ─── Utility: Coverage check ─────────────────────────────────────────

/**
 * Quick check if EagleView has imagery at a location.
 * Useful for deciding whether to fall back to Google Maps Static.
 */
export async function hasImageryAt(
  latitude: number,
  longitude: number
): Promise<boolean> {
  try {
    const result = await discoverOrthoImage(latitude, longitude);
    return result !== null;
  } catch {
    return false;
  }
}
