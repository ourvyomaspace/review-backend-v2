// netlify/functions/getReviews.js
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(request, context) {
  try {
    // Only allow GET
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        {
          status: 405,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get business_id from query params
    const url = new URL(request.url);
    const business_id = url.searchParams.get("business_id");
    const newReviewId = url.searchParams.get("newReviewId"); // For session-based ordering

    if (!business_id) {
      return new Response(
        JSON.stringify({ error: "business_id is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Fetch all approved reviews for this business
    // Order: pinned first, then by created_at desc
    const { data: reviews, error } = await supabase
      .from("reviews")
      .select("*")
      .eq("business_id", business_id)
      .eq("status", "approved")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase fetch error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // If newReviewId is provided, reorder to show it at top (session-based)
    // Session-based ordering: new review at top, then pinned reviews, then others
  let orderedReviews = reviews;
  if (newReviewId) {
    const newReviewIndex = reviews.findIndex(r => r.id === parseInt(newReviewId));
    if (newReviewIndex > -1) {
      const newReview = reviews[newReviewIndex];
      const remainingReviews = reviews.filter(r => r.id !== parseInt(newReviewId));
      
      // Separate pinned and unpinned reviews
      const pinnedReviews = remainingReviews.filter(r => r.pinned);
      const unpinnedReviews = remainingReviews.filter(r => !r.pinned);
      
      // Order: New review first, then pinned, then unpinned
      orderedReviews = [
        newReview,
        ...pinnedReviews,
        ...unpinnedReviews
      ];
    }
  }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        reviews: orderedReviews,
        count: orderedReviews.length
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
