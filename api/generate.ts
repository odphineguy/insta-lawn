import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateProposal } from "../geminiService";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { address, image, location } = req.body;

    if (!address || typeof address !== "string" || address.trim().length < 5) {
      return res.status(400).json({ error: "Please provide a valid address." });
    }

    console.log(`Generating proposal for: ${address.trim()}`);

    const imageContent = image
      ? { data: image.data, mimeType: image.mimeType }
      : undefined;

    const loc =
      location?.latitude && location?.longitude
        ? { latitude: Number(location.latitude), longitude: Number(location.longitude) }
        : undefined;

    const proposal = await generateProposal(address.trim(), imageContent, loc);
    console.log(`Proposal generated: ${proposal.items?.length} line items, total ${proposal.totalEstimate}`);
    return res.json(proposal);
  } catch (err: any) {
    console.error("Generate error:", err.message || err);

    const msg = String(err.message || err);
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      return res.status(429).json({ error: "API rate limit reached. Please wait a moment and try again." });
    } else if (msg.includes("API key")) {
      return res.status(401).json({ error: "Invalid API key. Check your environment variables." });
    } else {
      return res.status(500).json({ error: "Failed to generate estimate. Please try again." });
    }
  }
}
