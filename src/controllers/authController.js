const supabase = require("../utils/supabaseClient");
const { serviceRole: supabaseServiceRole } = require("../utils/supabaseClient");

exports.register = async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
    if (error) return next(error);

    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return next(error);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) return next(error);
    res.json({ success: true, message: "Successfully logged out" });
  } catch (err) {
    next(err);
  }
};

exports.socialLogin = async (req, res, next) => {
  try {
    const { provider } = req.body;
    // Supabase redirects the user, so no direct response here
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: process.env.FRONTEND_URL || "http://localhost:3000",
      },
    });
    if (error) return next(error);
    // For social login, Supabase typically handles the redirect. Frontend will then capture the session.
    // We are returning the auth data, which might contain a URL for the client to redirect to.
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.loginWithOtp = async (req, res, next) => {
  try {
    const { phone, otp, fullName, email } = req.body;
    // Supabase expects phone in E.164 format (e.g., +919876543210)
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token: otp,
      type: "sms",
    });
    if (error) return next(error);

    // If optional fields are provided, update respective tables
    try {
      const userId = data && data.user && data.user.id ? data.user.id : null;
      if (userId) {
        // Update auth.users.phone and profiles.phone_number if provided
        if (phone) {
          if (
            supabaseServiceRole &&
            supabaseServiceRole.auth &&
            supabaseServiceRole.auth.admin &&
            typeof supabaseServiceRole.auth.admin.updateUserById === "function"
          ) {
            await supabaseServiceRole.auth.admin.updateUserById(userId, {
              phone,
            });
          }
          await supabaseServiceRole
            .from("profiles")
            .upsert(
              {
                id: userId,
                phone_number: String(phone).trim(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: "id" }
            );
        }
        // Update profiles.full_name if provided
        if (fullName) {
          const upsertPayload = {
            id: userId,
            full_name: fullName,
            updated_at: new Date().toISOString(),
          };
          await supabaseServiceRole
            .from("profiles")
            .upsert(upsertPayload, { onConflict: "id" });
        }

        // Update auth.users.email if provided
        if (email) {
          // Use service role admin API for updating auth users
          if (
            supabaseServiceRole &&
            supabaseServiceRole.auth &&
            supabaseServiceRole.auth.admin &&
            typeof supabaseServiceRole.auth.admin.updateUserById === "function"
          ) {
            await supabaseServiceRole.auth.admin.updateUserById(userId, {
              email,
            });
          }
        }
      }
    } catch (silentErr) {
      // Do not fail login if post-login updates fail
      // Optionally log: console.error('Post-OTP update error', silentErr);
    }

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.sendOtp = async (req, res, next) => {
  try {
    const { phone } = req.body;
    // Supabase will send an OTP to this phone number
    const { data, error } = await supabase.auth.signInWithOtp({ phone });
    if (error) return next(error);
    res.json({ success: true, message: "OTP sent successfully", data });
  } catch (err) {
    next(err);
  }
};

exports.verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ success: false, message: "No token provided" });
    }
    const token = authHeader.split(" ")[1];
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired token" });
    }
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return res
        .status(400)
        .json({ success: false, message: "refreshToken is required" });
    }
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired refresh token" });
    }
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.checkPhoneExists = async (req, res, next) => {
  try {
    const phoneRaw = req.body?.phone;
    if (!phoneRaw) {
      return res
        .status(400)
        .json({ success: false, message: "phone is required" });
    }
    const phone = String(phoneRaw).trim();
    // Check profiles table for existing phone_number
    const { count, error } = await supabaseServiceRole
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("phone_number", phone);
    if (error) throw error;
    return res.json({ success: true, exists: (count || 0) > 0 });
  } catch (err) {
    next(err);
  }
};
