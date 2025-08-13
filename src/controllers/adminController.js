const { serviceRole: supabaseServiceRole } = require('../utils/supabaseClient');

exports.getDashboardStats = async (req, res, next) => {
  try {
    // Total sales (sum of final_amount from completed/paid orders)
    const { data: salesData, error: salesError } = await supabaseServiceRole
      .from('orders')
      .select('final_amount')
      .in('payment_status', ['paid'])
      .in('status', ['delivered', 'shipped']);

    if (salesError) throw salesError;
    const totalSales = salesData.reduce((sum, order) => sum + order.final_amount, 0);

    // New users (count of profiles created recently, e.g., last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { count: newUsers, error: newUsersError } = await supabaseServiceRole
      .from('profiles')
      .select('id', { count: 'exact' })
      .gte('created_at', thirtyDaysAgo.toISOString());
    if (newUsersError) throw newUsersError;

    // Recent orders
    const { data: recentOrders, error: recentOrdersError } = await supabaseServiceRole
      .from('orders')
      .select('*, profiles(full_name)')
      .order('order_date', { ascending: false })
      .limit(10);
    if (recentOrdersError) throw recentOrdersError;

    res.json({
      success: true,
      data: {
        totalSales,
        newUsers,
        recentOrders,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.createProduct = async (req, res, next) => {
  try {
    const { name, slug, description, brand, isPublished, isFeatured, imageUrls, categoryIds, variants } = req.body;

    if (!variants || variants.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one product variant is required.' });
    }

    const { data: newProduct, error: productError } = await supabaseServiceRole
      .from('products')
      .insert({
        name, slug, description, brand,
        is_published: isPublished,
        is_featured: isFeatured,
      })
      .select()
      .single();

    if (productError) throw productError;

    // Insert product images
    if (imageUrls && imageUrls.length > 0) {
      const imagesToInsert = imageUrls.map(url => ({
        product_id: newProduct.id,
        image_url: url,
        is_thumbnail: false, // You might want to add logic for one thumbnail
      }));
      const { error: imagesError } = await supabaseServiceRole
        .from('product_images')
        .insert(imagesToInsert);
      if (imagesError) throw imagesError;
    }

    // Insert product categories
    if (categoryIds && categoryIds.length > 0) {
      const productCategoriesToInsert = categoryIds.map(categoryId => ({
        product_id: newProduct.id,
        category_id: categoryId,
      }));
      const { error: productCategoriesError } = await supabaseServiceRole
        .from('product_categories')
        .insert(productCategoriesToInsert);
      if (productCategoriesError) throw productCategoriesError;
    }

    // Insert product variants
    const variantsToInsert = variants.map(variant => ({
      product_id: newProduct.id,
      price: variant.price,
      stock_quantity: variant.stock_quantity,
      sku: variant.sku,
      image_url: variant.image_url,
      attributes: variant.attributes,
      discount_type: variant.discount_type || null,
      discount_value: variant.discount_value ?? null,
    }));

    const { data: newVariants, error: variantsError } = await supabaseServiceRole
      .from('product_variants')
      .insert(variantsToInsert)
      .select();

    if (variantsError) {
      // If variant creation fails, consider rolling back product creation
      await supabaseServiceRole.from('products').delete().eq('id', newProduct.id);
      throw variantsError;
    }

    res.status(201).json({ success: true, data: { ...newProduct, variants: newVariants } });
  } catch (err) {
    next(err);
  }
};

exports.updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, slug, description, brand, isPublished, isFeatured, imageUrls, categoryIds, variants, deletedVariantIds } = req.body;

    const { data: updatedProduct, error: productError } = await supabaseServiceRole
      .from('products')
      .update({
        name, slug, description, brand,
        is_published: isPublished,
        is_featured: isFeatured,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select();

    if (productError) {
      if (productError.code === 'PGRST116') return res.status(404).json({ success: false, message: 'Product not found.' });
      throw productError;
    }

    // Update product images (simple approach: delete all and re-insert)
    if (imageUrls !== undefined) {
      await supabaseServiceRole.from('product_images').delete().eq('product_id', id);
      if (imageUrls.length > 0) {
        const imagesToInsert = imageUrls.map(url => ({ product_id: id, image_url: url }));
        const { error: imagesError } = await supabaseServiceRole.from('product_images').insert(imagesToInsert);
        if (imagesError) throw imagesError;
      }
    }

    // Update product categories (simple approach: delete all and re-insert)
    if (categoryIds !== undefined) {
      await supabaseServiceRole.from('product_categories').delete().eq('product_id', id);
      if (categoryIds.length > 0) {
        const productCategoriesToInsert = categoryIds.map(categoryId => ({ product_id: id, category_id: categoryId }));
        const { error: productCategoriesError } = await supabaseServiceRole.from('product_categories').insert(productCategoriesToInsert);
        if (productCategoriesError) throw productCategoriesError;
      }
    }

    // Optional: Delete specific variants if requested
    if (Array.isArray(deletedVariantIds) && deletedVariantIds.length > 0) {
      const { error: deleteVariantsError } = await supabaseServiceRole
        .from('product_variants')
        .delete()
        .in('id', deletedVariantIds)
        .eq('product_id', id);
      if (deleteVariantsError) throw deleteVariantsError;
    }

    // Optional: Upsert variants if provided (update existing by id, insert new without id)
    if (Array.isArray(variants)) {
      const variantsToUpdate = variants.filter(v => v && v.id);
      const variantsToInsert = variants.filter(v => v && !v.id);

      // Updates
      for (const variant of variantsToUpdate) {
        const updatePayload = {
          price: variant.price,
          stock_quantity: variant.stock_quantity,
          sku: variant.sku,
          image_url: variant.image_url,
          attributes: variant.attributes,
          discount_type: variant.discount_type || null,
          discount_value: variant.discount_value ?? null,
          updated_at: new Date().toISOString(),
        };
        const { error: variantUpdateError } = await supabaseServiceRole
          .from('product_variants')
          .update(updatePayload)
          .eq('id', variant.id)
          .eq('product_id', id);
        if (variantUpdateError) throw variantUpdateError;
      }

      // Inserts
      if (variantsToInsert.length > 0) {
        const insertRows = variantsToInsert.map(variant => ({
          product_id: id,
          price: variant.price,
          stock_quantity: variant.stock_quantity,
          sku: variant.sku,
          image_url: variant.image_url,
          attributes: variant.attributes,
          discount_type: variant.discount_type || null,
          discount_value: variant.discount_value ?? null,
        }));
        const { error: variantInsertError } = await supabaseServiceRole
          .from('product_variants')
          .insert(insertRows);
        if (variantInsertError) throw variantInsertError;
      }
    }

    res.json({ success: true, data: updatedProduct[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from('products')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true, message: 'Product deleted successfully.' });
  } catch (err) {
    next(err);
  }
};

exports.featureProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from('products')
      .update({ is_featured: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'Product marked as featured.' });
  } catch (err) {
    next(err);
  }
};

exports.unfeatureProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from('products')
      .update({ is_featured: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'Product unfeatured.' });
  } catch (err) {
    next(err);
  }
};

exports.createCategory = async (req, res, next) => {
  try {
    const { name, slug, description, imageUrl, parentId, isActive } = req.body;
    const { data: newCategory, error } = await supabaseServiceRole
      .from('categories')
      .insert({
        name, slug, description,
        image_url: imageUrl,
        parent_id: parentId || null,
        is_active: isActive || false,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ success: true, data: newCategory });
  } catch (err) {
    next(err);
  }
};

exports.updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, slug, description, imageUrl, parentId, isActive } = req.body;
    const { data: updatedCategory, error } = await supabaseServiceRole
      .from('categories')
      .update({
        name, slug, description,
        image_url: imageUrl,
        parent_id: parentId || null,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ success: false, message: 'Category not found.' });
      throw error;
    }
    res.json({ success: true, data: updatedCategory[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from('categories')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'Category deleted successfully.' });
  } catch (err) {
    next(err);
  }
};

exports.getBanners = async (req, res, next) => {
  try {
    const { data: banners, error } = await supabaseServiceRole
      .from('banners')
      .select('*')
      .order('display_order', { ascending: true });
    if (error) throw error;
    res.json({ success: true, data: banners });
  } catch (err) {
    next(err);
  }
};

exports.createBanner = async (req, res, next) => {
  try {
    const { title, description, mediaUrl, mediaType, linkTo, displayOrder, isActive } = req.body;
    const { data: newBanner, error } = await supabaseServiceRole
      .from('banners')
      .insert({
        title, description,
        media_url: mediaUrl,
        media_type: mediaType,
        link_to: linkTo,
        display_order: displayOrder,
        is_active: isActive,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ success: true, data: newBanner });
  } catch (err) {
    next(err);
  }
};

exports.updateBanner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, mediaUrl, mediaType, linkTo, displayOrder, isActive } = req.body;
    const { data: updatedBanner, error } = await supabaseServiceRole
      .from('banners')
      .update({
        title, description,
        media_url: mediaUrl,
        media_type: mediaType,
        link_to: linkTo,
        display_order: displayOrder,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ success: false, message: 'Banner not found.' });
      throw error;
    }
    res.json({ success: true, data: updatedBanner[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteBanner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from('banners')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'Banner deleted successfully.' });
  } catch (err) {
    next(err);
  }
};

exports.getWatchAndShopVideos = async (req, res, next) => {
  try {
    const { data: videos, error } = await supabaseServiceRole
      .from('watch_and_shop_videos')
      .select('*, products(name, slug)')
      .order('display_order', { ascending: true });
    if (error) throw error;
    res.json({ success: true, data: videos });
  } catch (err) {
    next(err);
  }
};

exports.createWatchAndShopVideo = async (req, res, next) => {
  try {
    const { title, videoUrl, thumbnailUrl, productId, displayOrder, isActive } = req.body;
    const { data: newVideo, error } = await supabaseServiceRole
      .from('watch_and_shop_videos')
      .insert({
        title,
        video_url: videoUrl,
        thumbnail_url: thumbnailUrl,
        product_id: productId || null,
        display_order: displayOrder,
        is_active: isActive,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ success: true, data: newVideo });
  } catch (err) {
    next(err);
  }
};

exports.updateWatchAndShopVideo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, videoUrl, thumbnailUrl, productId, displayOrder, isActive } = req.body;
    const { data: updatedVideo, error } = await supabaseServiceRole
      .from('watch_and_shop_videos')
      .update({
        title,
        video_url: videoUrl,
        thumbnail_url: thumbnailUrl,
        product_id: productId || null,
        display_order: displayOrder,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ success: false, message: 'Watch and shop video not found.' });
      throw error;
    }
    res.json({ success: true, data: updatedVideo[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteWatchAndShopVideo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from('watch_and_shop_videos')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'Watch and shop video deleted successfully.' });
  } catch (err) {
    next(err);
  }
};

exports.getUsers = async (req, res, next) => {
  try {
    const { data: users, error } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email:auth.users(email), role, is_blocked, created_at'); // Join with auth.users to get email
    if (error) throw error;
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
};

exports.blockUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from('profiles')
      .update({ is_blocked: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'User blocked successfully.' });
  } catch (err) {
    next(err);
  }
};

exports.unblockUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from('profiles')
      .update({ is_blocked: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'User unblocked successfully.' });
  } catch (err) {
    next(err);
  }
};

exports.getOrders = async (req, res, next) => {
  try {
    const { data: orders, error } = await supabaseServiceRole
      .from('orders')
      .select('*, profiles(full_name), order_items(*, products(name))')
      .order('order_date', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
};

exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data: updatedOrder, error } = await supabaseServiceRole
      .from('orders')
      .update({ status: status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ success: false, message: 'Order not found.' });
      throw error;
    }
    res.json({ success: true, data: updatedOrder[0] });
  } catch (err) {
    next(err);
  }
};

exports.getReviews = async (req, res, next) => {
  try {
    const { data: reviews, error } = await supabaseServiceRole
      .from('reviews')
      .select('*, products(name), profiles(full_name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: reviews });
  } catch (err) {
    next(err);
  }
};

exports.approveReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from('reviews')
      .update({ is_approved: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'Review approved successfully.' });
  } catch (err) {
    next(err);
  }
};

exports.deleteReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from('reviews')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'Review deleted successfully.' });
  } catch (err) {
    next(err);
  }
};

exports.getAllUsers = async (req, res, next) => {
  try {
    const { data, error } = await supabaseServiceRole
      .from('profiles')
      .select('full_name, phone_number, created_at');
    if (error) return res.status(500).json({ success: false, message: error.message });
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// Product Variant Management (New API)
exports.createProductVariant = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { price, stock_quantity, sku, image_url, attributes, discount_type, discount_value } = req.body;

    const { data: newVariant, error } = await supabaseServiceRole
      .from('product_variants')
      .insert({
        product_id: productId,
        price,
        stock_quantity,
        sku,
        image_url,
        attributes,
        discount_type: discount_type || null,
        discount_value: discount_value ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data: newVariant });
  } catch (err) {
    next(err);
  }
};

exports.updateProductVariant = async (req, res, next) => {
  try {
    const { variantId } = req.params;
    const { price, stock_quantity, sku, image_url, attributes, discount_type, discount_value } = req.body;

    const { data: updatedVariant, error } = await supabaseServiceRole
      .from('product_variants')
      .update({
        price,
        stock_quantity,
        sku,
        image_url,
        attributes,
        discount_type: discount_type || null,
        discount_value: discount_value ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', variantId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ success: false, message: 'Product variant not found.' });
      throw error;
    }
    res.json({ success: true, data: updatedVariant });
  } catch (err) {
    next(err);
  }
};

exports.deleteProductVariant = async (req, res, next) => {
  try {
    const { variantId } = req.params;
    const { error } = await supabaseServiceRole
      .from('product_variants')
      .delete()
      .eq('id', variantId);

    if (error) throw error;
    res.json({ success: true, message: 'Product variant deleted successfully.' });
  } catch (err) {
    next(err);
  }
}; 