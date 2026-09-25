import Anthropic from "@anthropic-ai/sdk";

// Constructed defensively, not just gated on presence. A malformed
// ANTHROPIC_API_KEY (wrong value pasted into the env var — not merely a
// missing one) throws inside the SDK's own request-header setup, and since
// classify-email/parse-email/suggest-price all built their client eagerly at
// module scope, that throw happened at import time — which Next.js triggers
// during build-time page-data collection, taking down the entire deploy
// (every route, not just AI ones) over a bad value for one non-critical
// feature. Centralizing construction here with a try/catch means a broken
// key degrades to "AI unavailable" (same as an unset key) instead of that.
function buildClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  } catch (err) {
    console.error("Failed to construct Anthropic client — check ANTHROPIC_API_KEY", err);
    return null;
  }
}

export const anthropic = buildClient();
