// Vercel serverless function — reads an uploaded invoice with Claude and
// checks it against the booking/expense figures sent from the app.
// Requires the ANTHROPIC_API_KEY environment variable to be set in Vercel.

const ALLOWED_FILE_HOST = "https://cjrcjvsiemzfzncgugzh.supabase.co/storage/";
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

const MEDIA_TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ ok: false, error: "ANTHROPIC_API_KEY is not set in Vercel environment variables." });
  }

  try {
    const { fileUrl, fileName, context } = req.body || {};
    if (!fileUrl || !context) {
      return res.status(400).json({ ok: false, error: "Missing fileUrl or context." });
    }
    // Only ever fetch files from our own Supabase storage
    if (!fileUrl.startsWith(ALLOWED_FILE_HOST)) {
      return res.status(400).json({ ok: false, error: "File URL not allowed." });
    }
    const ext = (fileName || fileUrl).split(".").pop().toLowerCase().split("?")[0];
    const mediaType = MEDIA_TYPES[ext];
    if (!mediaType) {
      return res.status(400).json({ ok: false, error: `Can only read PDF or image files (got .${ext}). Word/Excel files can't be checked.` });
    }

    // Download the file server-side
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) {
      return res.status(400).json({ ok: false, error: "Couldn't download the file from storage." });
    }
    const buf = Buffer.from(await fileRes.arrayBuffer());
    if (buf.length > MAX_FILE_BYTES) {
      return res.status(400).json({ ok: false, error: "File is too large to check (over 8 MB)." });
    }
    const base64 = buf.toString("base64");

    const contentBlock = mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

    const prompt = `You are a bookkeeping assistant for a UK short-let property management company.
Read the attached supplier invoice/receipt and check it against the figures recorded in our system.

RECORDED FIGURES (what our system has):
${JSON.stringify(context, null, 2)}

Notes:
- UK suppliers often add 20% VAT on top of net figures. A recorded figure may correspond to an invoice line's net amount, its VAT-inclusive amount, or a sum of several lines.
- "cost" fields are what we pay suppliers; "charge" fields are what we bill clients — invoices should normally match COST figures.
- Treat amounts within £0.05 as equal.
- A "mistakes" figure means we knowingly absorb that much above the charge, so charge + mistakes may equal the invoice total.

Respond with STRICT JSON ONLY — no markdown fences, no commentary — in exactly this shape:
{
  "verdict": "match" | "mismatch" | "unclear",
  "supplier": "name on the invoice or null",
  "invoice_date": "date on the invoice or null",
  "invoice_total": 0.00,
  "lines": [{ "description": "...", "amount": 0.00 }],
  "matched_against": "plain-English note of which recorded figure(s) the total reconciles with, or null",
  "difference": 0.00,
  "explanation": "2-3 short sentences a non-accountant understands, naming exact amounts"
}`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: 1500,
        messages: [
          { role: "user", content: [contentBlock, { type: "text", text: prompt }] },
        ],
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      const msg = data?.error?.message || "AI request failed.";
      return res.status(502).json({ ok: false, error: msg });
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const clean = text.replace(/```json|```/g, "").trim();
    let result;
    try {
      result = JSON.parse(clean);
    } catch {
      return res.status(502).json({ ok: false, error: "AI reply couldn't be read — try again.", raw: clean.slice(0, 400) });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || "Unexpected error." });
  }
}
