import "dotenv/config";
import express from "express";
import path from "path";
import { generateProposal } from "./geminiService";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.resolve(".")));

// ─── Generate Proposal API ───────────────────────────────────────────────
app.post("/api/generate", async (req, res) => {
  try {
    const { address, image, location } = req.body;

    if (!address || typeof address !== "string" || address.trim().length < 5) {
      res.status(400).json({ error: "Please provide a valid address." });
      return;
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
    res.json(proposal);
  } catch (err: any) {
    console.error("Generate error:", err.message || err);

    // Parse Gemini error messages for better user feedback
    const msg = String(err.message || err);
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      res.status(429).json({ error: "API rate limit reached. Please wait a moment and try again." });
    } else if (msg.includes("API key")) {
      res.status(401).json({ error: "Invalid API key. Check your .env file." });
    } else {
      res.status(500).json({ error: "Failed to generate estimate. Please try again." });
    }
  }
});

app.listen(PORT, () => {
  console.log(`InstaLawn Demo running at http://localhost:${PORT}/demo.html`);
  if (!process.env.API_KEY) {
    console.warn("WARNING: API_KEY not set. Create a .env file with API_KEY=your_key");
  }
});
