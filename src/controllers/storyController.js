const { serviceRole: supabaseServiceRole } = require("../utils/supabaseClient");

const MEDIA_TYPES = new Set(["image", "video"]);

const pickFirstDefined = (...values) =>
  values.find((value) => value !== undefined && value !== null);

const buildSupabaseClientWithAuth = (token) =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

const verifyUserPurchase = async (client, userId, productId) => {
  const { count, error } = await client
    .from("order_items")
    // Reuse the review verification logic: ensure an order exists for this user/product
    .select("*, orders!inner(*)", { count: "exact", head: true })
    .eq("product_id", productId)
    .eq("orders.user_id", userId);

  if (error) throw error;
  return count > 0;
};

exports.getPublicStories = async (req, res, next) => {
  try {
    const nowIso = new Date().toISOString();

    const { data: stories, error } = await supabaseServiceRole
      .from("stories")
      .select(
        `
          id,
          user_id,
          product_id,
          media_url,
          media_type,
          caption,
          status,
          posted_by_brand,
          created_at,
          approved_at,
          expires_at,
          profiles:profiles(
            full_name,
            profile_picture_url
          ),
          products:products(
            id,
            name,
            slug
          )
        `
      )
      .eq("status", "approved")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("approved_at", { ascending: false, nullsFirst: false });

    if (error) throw error;

    res.json({
      success: true,
      data: stories ?? [],
    });
  } catch (err) {
    next(err);
  }
};

exports.submitStory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const token = req.headers["authorization"]?.split(" ")[1];
    const supabaseServiceRole = buildSupabaseClientWithAuth(token);

    const productId = pickFirstDefined(req.body.productId, req.body.product_id);
    const mediaUrl = pickFirstDefined(req.body.mediaUrl, req.body.media_url);
    const mediaType = pickFirstDefined(req.body.mediaType, req.body.media_type);
    const caption = pickFirstDefined(req.body.caption, req.body.caption_text);

    if (!productId || !mediaUrl || !mediaType) {
      return res.status(400).json({
        success: false,
        message: "productId, mediaUrl, and mediaType are required.",
      });
    }

    if (!MEDIA_TYPES.has(mediaType)) {
      return res.status(400).json({
        success: false,
        message: "mediaType must be either 'image' or 'video'.",
      });
    }

    const hasPurchased = await verifyUserPurchase(
      supabaseServiceRole,
      userId,
      productId
    );

    if (!hasPurchased) {
      return res.status(403).json({
        success: false,
        message: "You can only submit stories for products you have purchased.",
      });
    }

    const { data: insertedStory, error: insertError } = await supabaseServiceRole
      .from("stories")
      .insert({
        user_id: userId,
        product_id: productId,
        media_url: mediaUrl,
        media_type: mediaType,
        caption: caption || null,
        status: "pending",
        posted_by_brand: false,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    res.status(201).json({
      success: true,
      data: insertedStory,
      message: "Story submitted successfully and is pending approval.",
    });
  } catch (err) {
    next(err);
  }
};

exports.getMyStories = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const token = req.headers["authorization"]?.split(" ")[1];
    const supabaseServiceRole = buildSupabaseClientWithAuth(token);

    const { data: stories, error } = await supabaseServiceRole
      .from("stories")
      .select(
        `
          id,
          product_id,
          media_url,
          media_type,
          caption,
          status,
          posted_by_brand,
          created_at,
          approved_at,
          expires_at,
          products:products(
            id,
            name,
            slug
          )
        `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: stories ?? [],
    });
  } catch (err) {
    next(err);
  }
};
