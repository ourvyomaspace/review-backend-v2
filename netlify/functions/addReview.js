// netlify/functions/addReview.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client using environment variables
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// ✅ CORRECTED: Use stable v1 API with proper model name
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent";

// Helper to safely parse JSON
function safeJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ✅ CORRECTED: Use default export with new handler signature
export default async function handler(request, context) {
  try {
    // Only allow POST
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        {
          status: 405,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Parse body (from Framer)
    const body = await request.json();
    const { business_id, reviewer_name, phone, content } = body;

    if (!business_id || !reviewer_name || !phone || !content) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Optional: verify secret header
    const secret = request.headers.get("x-webhook-secret");
    if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
      return new Response(
        JSON.stringify({ error: "Invalid webhook secret" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 1️⃣ Call Gemini API
    const prompt = `
You are a strict JSON-only classifier.
Analyze this review and respond ONLY with a valid JSON object in this format:
{
 "safety_score": number, // between 0 (safe) and 1 (unsafe)
 "sentiment_score": number, // between -1 (negative) and 1 (positive)
 "action": "allow" | "flag" | "block"
}
Review: """${content}"""
`;

    console.log("Prompt sent to Gemini:", prompt);

    const geminiResponse = await fetch(
      `${GEMINI_ENDPOINT}?key=${process.env.GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      }
    );

    const geminiData = await geminiResponse.json();
    
    // Check for API errors
    if (geminiData.error) {
      console.error("Gemini API error:", geminiData.error);
      return new Response(
        JSON.stringify({ error: `Gemini API error: ${geminiData.error.message}` }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const modelText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    console.log("Gemini raw output:", JSON.stringify(geminiData, null, 2));

    const result = safeJSON(modelText) || {};
    const safety = result.safety_score ?? 0;
    const sentiment = result.sentiment_score ?? 0;
    const action = result.action ?? "flag";

    // 2️⃣ Determine status
    let status = "pending";
    if (action === "allow" && safety < 0.3) status = "approved";
    else if (action === "block" || safety >= 0.7) status = "flagged";

    // 3️⃣ Insert into Supabase
    const { error: insertError } = await supabase.from("reviews").insert([
      {
        business_id,
        reviewer_name,
        phone,
        content,
        status,
        sentiment_score: sentiment,
        is_positive: sentiment > 0,
      },
    ]);

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return new Response(
        JSON.stringify({ error: insertError.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 4️⃣ Return success
    return new Response(
      JSON.stringify({
        ok: true,
        message: "Review received successfully.",
        status,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Server error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
