const supabase = require("../utils/supabaseClient");
const { serviceRole: supabaseServiceRole } = require("../utils/supabaseClient");
const jwt = require("jsonwebtoken");
const axios = require("axios");

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

    if (!phone || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: "Phone number and OTP are required" 
      });
    }


    // Step 1: Verify OTP with Otify
    const verifyPayload = {
      to: phone,
      otp: otp
    };

    const verifyResponse = await axios.post(
      `${process.env.OTIFY_BASE_URL}/v1/verifyuserotp?api_key=${process.env.OTIFY_API_KEY}`,
      verifyPayload
    );

    if (!verifyResponse.data || verifyResponse.data.success === false) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid OTP" 
      });
    }

    // Step 2: Find or Create User in profiles table
    let { data: user, error: queryError } = await supabaseServiceRole
      .from("profiles")
      .select("*")
      .eq("phone_number", phone)
      .single();

    // If user doesn't exist, create new user (signup)
    if (queryError && queryError.code === 'PGRST116') {
      const newUserData = {
        phone_number: phone,
        full_name: fullName || null,
        email: email || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data: newUser, error: insertError } = await supabaseServiceRole
        .from("profiles")
        .insert(newUserData)
        .select()
        .single();

      if (insertError) throw insertError;
      user = newUser;
    } else if (queryError) {
      throw queryError;
    } else {
      // User exists - update optional fields if provided
      const updates = {};
      if (fullName) updates.full_name = fullName;
      if (email) updates.email = email;
      
      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        const { data: updatedUser, error: updateError } = await supabaseServiceRole
          .from("profiles")
          .update(updates)
          .eq("id", user.id)
          .select()
          .single();
        
        if (!updateError) user = updatedUser;
      }
    }

    // Step 3: Generate Custom JWTs
    const accessTokenExpiry = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days from now
    
    const accessToken = jwt.sign(
      { 
        sub: user.id, 
        role: 'authenticated',
        email: user.email,
        phone: user.phone_number,
        full_name: user.full_name,
        exp: accessTokenExpiry
      },
      process.env.JWT_SECRET
    );

    const refreshTokenExpiry = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90 days from now
    
    const refreshToken = jwt.sign(
      { 
        sub: user.id,
        exp: refreshTokenExpiry
      },
      process.env.REFRESH_TOKEN_SECRET
    );

    // Step 4: Build Supabase-compatible session object
    const sessionData = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 2592000, // 30 days in seconds (30 * 24 * 60 * 60)
      token_type: "bearer",
      user: {
        id: user.id,
        phone: user.phone_number,
        email: user.email,
        full_name: user.full_name,
        profile_picture_url: user.profile_picture_url,
        role: user.role || 'user',
        is_blocked: user.is_blocked || false,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    };

    // Step 5: Return response mimicking Supabase format
    // In authController.js - loginWithOtp and refreshToken endpoints

    // After generating tokens, set httpOnly cookie
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'strict',
      maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days in milliseconds
      path: '/api/auth/refresh-token' // Only send cookie to refresh endpoint
    });

    // Return only access token in response body
    res.json({ 
      success: true, 
      data: {
        session: {
          access_token: accessToken,
          expires_in: 2592000,
          token_type: "bearer"
        },
        user: sessionData.user
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.sendOtp = async (req, res, next) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: "Phone number is required" 
      });
    }

    // Call Otify service to send OTP
    const otifyPayload = {
      to: phone,
      sender_id: process.env.OTIFY_SENDER_ID,
      template_id: process.env.OTIFY_TEMPLATE_ID
    };

    const otifyResponse = await axios.post(
      `${process.env.OTIFY_BASE_URL}/v1/createuserotp?api_key=${process.env.OTIFY_API_KEY}`,
      otifyPayload
    );

    if (!otifyResponse.data || otifyResponse.data.success === false) {
      return res.status(500).json({ 
        success: false, 
        message: "Failed to send OTP" 
      });
    }

    res.json({ 
      success: true, 
      message: "OTP sent successfully"
    });
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

// In authController.js - refreshToken endpoint

exports.refreshToken = async (req, res, next) => {
  try {
    // Get refresh token from httpOnly cookie instead of body
    const refreshToken = req.cookies.refresh_token;
    
    if (!refreshToken) {
      return res.status(400).json({ 
        success: false, 
        message: "No refresh token provided" 
      });
    }

    // Verify the refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    } catch (error) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired refresh token" });
    }

    // Fetch user from profiles table
    const { data: user, error } = await supabaseServiceRole
      .from("profiles")
      .select("*")
      .eq("id", decoded.sub)
      .single();

    if (error || !user) {
      return res
        .status(401)
        .json({ success: false, message: "User not found" });
    }

    // Check if user is blocked
    if (user.is_blocked) {
      return res
        .status(403)
        .json({ success: false, message: "User account is blocked" });
    }

    // Generate new access token
    const accessTokenExpiry = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days
    
    const newAccessToken = jwt.sign(
      { 
        sub: user.id, 
        role: user.role || 'authenticated',
        email: user.email,
        phone: user.phone_number,
        full_name: user.full_name,
        exp: accessTokenExpiry
      },
      process.env.JWT_SECRET
    );

    // Generate new refresh token
    const refreshTokenExpiry = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90 days
    
    const newRefreshToken = jwt.sign(
      { 
        sub: user.id,
        exp: refreshTokenExpiry
      },
      process.env.REFRESH_TOKEN_SECRET
    );

    // Build session object
    const sessionData = {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      expires_in: 2592000, // 30 days in seconds (30 * 24 * 60 * 60)
      token_type: "bearer",
      user: {
        id: user.id,
        phone: user.phone_number,
        email: user.email,
        full_name: user.full_name,
        profile_picture_url: user.profile_picture_url,
        role: user.role || 'user',
        is_blocked: user.is_blocked || false,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    };

    // In authController.js - loginWithOtp and refreshToken endpoints

    // After generating tokens, set httpOnly cookie
    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'strict',
      maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days in milliseconds
      path: '/api/auth/refresh-token' // Only send cookie to refresh endpoint
    });

    // Return only new access token
    return res.json({ 
      success: true, 
      data: {
        session: {
          access_token: newAccessToken,
          expires_in: 2592000,
          token_type: "bearer"
        },
        user: sessionData.user
      }
    });
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
