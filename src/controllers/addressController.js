const { serviceRole: supabaseServiceRole } = require("../utils/supabaseClient");

exports.getAddresses = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { data: addresses, error } = await supabaseServiceRole
      .from("addresses")
      .select("*")
      .eq("user_id", userId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ success: true, data: addresses });
  } catch (err) {
    next(err);
  }
};

exports.addAddress = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { address_line_1, address_line_2, city, state, pincode, country, is_default, full_name, phone_number } =
      req.body;

    if (!address_line_1 || !city || !state || !pincode || !country || !full_name || !phone_number) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required address fields." });
    }

    if (is_default) {
      await supabaseServiceRole
        .from("addresses")
        .update({ is_default: false })
        .eq("user_id", userId)
        .eq("is_default", true);
    }

    const { data: newAddress, error } = await supabaseServiceRole
      .from("addresses")
      .insert({
        user_id: userId,
        address_line_1,
        address_line_2,
        city,
        state,
        pincode,
        country,
        is_default: is_default || false,
        full_name,
        phone_number,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, data: newAddress });
  } catch (err) {
    next(err);
  }
};

exports.updateAddress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const {
      address_line_1,
      address_line_2,
      city,
      state,
      pincode,
      country,
      is_default,
      full_name,
      phone_number,
    } = req.body;

    if (is_default) {
      await supabaseServiceRole
        .from("addresses")
        .update({ is_default: false })
        .eq("user_id", userId)
        .eq("is_default", true);
    }

    const { data: updatedAddress, error } = await supabaseServiceRole
      .from("addresses")
      .update({
        address_line_1,
        address_line_2,
        city,
        state,
        pincode,
        country,
        is_default: is_default || false,
        full_name,
        phone_number,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId)
      .select();

    if (error) {
      if (error.code === "PGRST116") {
        return res
          .status(404)
          .json({
            success: false,
            message: "Address not found or does not belong to user.",
          });
      }
      throw error;
    }
    res.json({ success: true, data: updatedAddress[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteAddress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { error } = await supabaseServiceRole
      .from("addresses")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      if (error.code === "PGRST116") {
        return res
          .status(404)
          .json({
            success: false,
            message: "Address not found or does not belong to user.",
          });
      }
      throw error;
    }

    res.json({ success: true, message: "Address deleted successfully." });
  } catch (err) {
    next(err);
  }
};
