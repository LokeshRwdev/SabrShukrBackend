const { serviceRole: supabaseServiceRole } = require("../utils/supabaseClient");

const MEDIA_TYPES = new Set(["image", "video"]);
const STATUS_VALUES = new Set(["pending", "approved", "rejected"]);
const EXPIRY_TYPES = new Set(["auto", "manual"]);
const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;

const pickFirstDefined = (...values) =>
  values.find((value) => value !== undefined && value !== null);

const resolveExpiryType = (value) => {
  if (value === undefined || value === null) return "auto";
  const normalized = String(value).toLowerCase();
  return EXPIRY_TYPES.has(normalized) ? normalized : null;
};

const computeExpiresAt = (approvedAt, expiryType) => {
  if (expiryType === "manual") return null;
  return new Date(approvedAt.getTime() + TWENTY_FOUR_HOURS_IN_MS).toISOString();
};

exports.getStories = async (req, res, next) => {
  try {
    const statusParam = req.query.status
      ? String(req.query.status).toLowerCase()
      : null;

    let query = supabaseServiceRole
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
      .order("created_at", { ascending: false });

    if (statusParam) {
      if (!STATUS_VALUES.has(statusParam)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid status filter. Allowed values are pending, approved, or rejected.",
        });
      }
      query = query.eq("status", statusParam);
    }

    const { data: stories, error } = await query;
    if (error) throw error;

    res.json({
      success: true,
      data: stories ?? [],
    });
  } catch (err) {
    next(err);
  }
};

exports.createBrandStory = async (req, res, next) => {
  try {
    const productId = pickFirstDefined(
      req.body.productId,
      req.body.product_id
    );
    const mediaUrl = pickFirstDefined(req.body.mediaUrl, req.body.media_url);
    const mediaType = pickFirstDefined(
      req.body.mediaType,
      req.body.media_type
    );
    const caption = pickFirstDefined(req.body.caption, req.body.caption_text);
    const expiryType = resolveExpiryType(
      pickFirstDefined(req.body.expiryType, req.body.expiry_type)
    );

    if (!mediaUrl || !mediaType) {
      return res.status(400).json({
        success: false,
        message: "mediaUrl and mediaType are required.",
      });
    }

    if (!MEDIA_TYPES.has(mediaType)) {
      return res.status(400).json({
        success: false,
        message: "mediaType must be either 'image' or 'video'.",
      });
    }

    if (!expiryType) {
      return res.status(400).json({
        success: false,
        message: "expiryType must be either 'auto' or 'manual'.",
      });
    }

    const approvedAtDate = new Date();
    const nowIso = approvedAtDate.toISOString();
    const expiresAtValue = computeExpiresAt(approvedAtDate, expiryType);

    const { data: story, error } = await supabaseServiceRole
      .from("stories")
      .insert({
        user_id: null,
        product_id: productId || null,
        media_url: mediaUrl,
        media_type: mediaType,
        caption: caption || null,
        status: "approved",
        approved_at: nowIso,
        posted_by_brand: true,
        expires_at: expiresAtValue,
      })
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
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data: story,
      message: "Brand story created and published successfully.",
    });
  } catch (err) {
    next(err);
  }
};

exports.approveStory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const expiryType = resolveExpiryType(
      pickFirstDefined(req.body.expiryType, req.body.expiry_type)
    );

    if (!expiryType) {
      return res.status(400).json({
        success: false,
        message: "expiryType must be either 'auto' or 'manual'.",
      });
    }

    const { data: existingStory, error: fetchError } = await supabaseServiceRole
      .from("stories")
      .select("status")
      .eq("id", id)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "Story not found.",
        });
      }
      throw fetchError;
    }

    if (existingStory.status === "approved") {
      return res.status(200).json({
        success: true,
        message: "Story is already approved.",
      });
    }

    const approvedAtDate = new Date();
    const nowIso = approvedAtDate.toISOString();
    const expiresAtValue = computeExpiresAt(approvedAtDate, expiryType);

    const { data: story, error } = await supabaseServiceRole
      .from("stories")
      .update({
        status: "approved",
        approved_at: nowIso,
        expires_at: expiresAtValue,
      })
      .eq("id", id)
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
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: story,
      message: "Story approved successfully.",
    });
  } catch (err) {
    next(err);
  }
};

exports.rejectStory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: existingStory, error: fetchError } = await supabaseServiceRole
      .from("stories")
      .select("status")
      .eq("id", id)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "Story not found.",
        });
      }
      throw fetchError;
    }

    if (existingStory.status === "rejected") {
      return res.status(200).json({
        success: true,
        message: "Story is already rejected.",
      });
    }

    const { data: story, error } = await supabaseServiceRole
      .from("stories")
      .update({
        status: "rejected",
        approved_at: null,
      })
      .eq("id", id)
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
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: story,
      message: "Story rejected successfully.",
    });
  } catch (err) {
    next(err);
  }
};

exports.deleteStory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseServiceRole
      .from("stories")
      .delete()
      .eq("id", id)
      .select("id")
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "Story not found.",
        });
      }
      throw error;
    }

    res.json({
      success: true,
      data,
      message: "Story deleted successfully.",
    });
  } catch (err) {
    next(err);
  }
};
