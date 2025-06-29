const supabase = require('../utils/supabaseClient');

exports.getAddresses = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data: addresses, error } = await supabase
      .from('addresses')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data: addresses });
  } catch (err) {
    next(err);
  }
};

exports.addAddress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { addressLine1, addressLine2, city, state, pincode, country, isDefault } = req.body;

    if (isDefault) {
      // If the new address is set as default, unset previous defaults for this user
      await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', userId)
        .eq('is_default', true);
    }

    const { data: newAddress, error } = await supabase
      .from('addresses')
      .insert({
        user_id: userId,
        address_line_1: addressLine1,
        address_line_2: addressLine2,
        city,
        state,
        pincode,
        country,
        is_default: isDefault || false,
      })
      .select();

    if (error) throw error;
    res.status(201).json({ success: true, data: newAddress[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateAddress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { addressLine1, addressLine2, city, state, pincode, country, isDefault } = req.body;

    if (isDefault) {
      // If this address is set as default, unset previous defaults for this user
      await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', userId)
        .eq('is_default', true);
    }

    const { data: updatedAddress, error } = await supabase
      .from('addresses')
      .update({
        address_line_1: addressLine1,
        address_line_2: addressLine2,
        city,
        state,
        pincode,
        country,
        is_default: isDefault || false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select();

    if (error) {
      if (error.code === 'PGRST116') { // No rows found to update
        return res.status(404).json({ success: false, message: 'Address not found or does not belong to user.' });
      }
      throw error;
    }
    res.json({ success: true, data: updatedAddress[0] });
  } catch (err) {
    next(err);
  }
}; 