const { serviceRole: supabaseServiceRole } = require("../utils/supabaseClient");
const {
  checkServiceability,
  createOrder,
  createReturnOrder,
  generateAwb,
  schedulePickup,
  generateLabel,
} = require("../utils/shiprocketClient");

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizePhoneNumber(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  // Shiprocket expects a 10-digit Indian mobile number; take last 10 digits if longer
  return digits.slice(-10);
}

function sanitizePincode(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits;
}

async function getOrderWithItems(orderId) {
  const { data: order, error } = await supabaseServiceRole
    .from("orders")
    .select("*, order_items(*, product_variants(*)), profiles(full_name, phone_number)")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return order || null;
}

function computeParcelMetrics(order) {
  // Sum weights from product_variants if available; fallback to default weight
  const DEFAULT_ITEM_WEIGHT_KG = toNumber(process.env.DEFAULT_ITEM_WEIGHT_KG, 0.5);
  let totalWeightKg = 0;
  for (const item of order.order_items || []) {
    const variant = item.product_variants || item.product_variant || item.variant;
    const variantWeightKg = toNumber(variant?.weight_kg, DEFAULT_ITEM_WEIGHT_KG);
    totalWeightKg += variantWeightKg * toNumber(item.quantity, 1);
  }
  if (totalWeightKg <= 0) totalWeightKg = DEFAULT_ITEM_WEIGHT_KG;
  return { totalWeightKg };
}

exports.checkRates = async (req, res, next) => {
  try {
    const { orderId, deliveryPincode, isCod } = req.body;
    if (!orderId && !deliveryPincode) {
      return res.status(400).json({ success: false, message: "orderId or deliveryPincode is required" });
    }

    let pincode = String(deliveryPincode || "").trim();
    let totalWeightKg = toNumber(req.body.totalWeightKg);

    if (orderId) {
      const order = await getOrderWithItems(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found" });
      }
      pincode = pincode || String(order?.shipping_address?.pincode || order?.shipping_address?.postal_code || "");
      totalWeightKg = totalWeightKg || computeParcelMetrics(order).totalWeightKg;
    }

    if (!pincode) {
      return res.status(400).json({ success: false, message: "delivery pincode is required" });
    }

    const isCodFlag = Boolean(isCod);
    const resp = await checkServiceability({ deliveryPostcode: pincode, totalWeightKg, isCod: isCodFlag });
    return res.json({ success: true, data: resp });
  } catch (err) {
    next(err);
  }
};

exports.createShiprocketOrder = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: "orderId is required" });

    const order = await getOrderWithItems(orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const { totalWeightKg } = computeParcelMetrics(order);

    // Allow overriding/missing shipping address via request body
    const addressOverride = req.body.address || req.body.shipping_address || null;
    const mergedAddress = {
      ...(order.shipping_address || {}),
      ...(addressOverride || {}),
    };

    const pincodeRaw = sanitizePincode(mergedAddress.pincode || mergedAddress.postal_code);
    const customerName = mergedAddress.name || order.profiles?.full_name || "Customer";
    const customerEmail = mergedAddress.email || process.env.SHIPROCKET_FALLBACK_EMAIL || "order@sabrshukr.store";
    const customerPhone = sanitizePhoneNumber(
      mergedAddress.phone_number || mergedAddress.phone || order.profiles?.phone_number || process.env.SHIPROCKET_FALLBACK_PHONE || "9999999999"
    );

    // Validate required address fields to avoid Shiprocket 400 errors
    const requiredFieldsMissing = [];
    if (!customerName) requiredFieldsMissing.push("name");
    if (!customerEmail) requiredFieldsMissing.push("email");
    if (!customerPhone || customerPhone.length !== 10) requiredFieldsMissing.push("phone");
    if (!mergedAddress.address_line1 && !mergedAddress.address) requiredFieldsMissing.push("address_line1");
    if (!mergedAddress.city && !mergedAddress.town) requiredFieldsMissing.push("city");
    if (!mergedAddress.state) requiredFieldsMissing.push("state");
    if (!pincodeRaw || pincodeRaw.length !== 6) requiredFieldsMissing.push("pincode");

    if (requiredFieldsMissing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing shipping address fields: ${requiredFieldsMissing.join(", ")}`,
      });
    }

    // If admin provided an override, persist it on the order for future operations
    if (addressOverride) {
      const newShippingAddress = {
        ...mergedAddress,
        pincode: pincodeRaw,
        postal_code: pincodeRaw,
        phone_number: customerPhone,
        phone: customerPhone,
      };
      await supabaseServiceRole
        .from("orders")
        .update({ shipping_address: newShippingAddress, updated_at: new Date().toISOString() })
        .eq("id", orderId);
    }

    const orderItems = (order.order_items || []).map((it) => ({
      name: it.product_name || it.products?.name || `Item ${it.product_id || it.variant_id}`,
      sku: it.sku || it.product_variants?.sku || String(it.variant_id || it.product_id),
      units: toNumber(it.quantity, 1),
      selling_price: toNumber(it.price_at_purchase || it.unit_price || 0),
      discount: toNumber(order.discount_amount || 0),
      tax: 0,
      hsn: process.env.DEFAULT_HSN_CODE || undefined,
    }));

    if (!orderItems || orderItems.length === 0) {
      return res.status(400).json({ success: false, message: "Order has no items to ship" });
    }

    const payload = {
      order_id: String(order.id),
      order_date: new Date(order.order_date || Date.now()).toISOString(),
      pickup_location: req.body.pickup_location || process.env.SHIPROCKET_PICKUP_LOCATION || "warehouse",
      comment: req.body.comment || undefined,
      reseller_name: process.env.RESELLER_NAME || undefined,
      company_name: process.env.COMPANY_NAME || process.env.STORE_NAME || undefined,
      billing_customer_name: customerName,
      billing_last_name: "",
      billing_address: `${mergedAddress.address_line1 || mergedAddress.address || ""}`.slice(0, 150),
      billing_address_2: `${mergedAddress.address_line2 || ""}`.slice(0, 150),
      billing_isd_code: "91",
      billing_city: mergedAddress.city || mergedAddress.town || "",
      billing_pincode: pincodeRaw,
      billing_state: mergedAddress.state || "",
      billing_country: mergedAddress.country || "India",
      billing_email: customerEmail,
      billing_phone: String(customerPhone),
      billing_alternate_phone: mergedAddress.alternate_phone ? sanitizePhoneNumber(mergedAddress.alternate_phone) : undefined,
      // Provide shipping fields and also set shipping_is_billing to 1 (API commonly expects 0/1)
      shipping_is_billing: 1,
      shipping_customer_name: customerName,
      shipping_last_name: "",
      shipping_address: `${mergedAddress.address_line1 || mergedAddress.address || ""}`.slice(0, 150),
      shipping_address_2: `${mergedAddress.address_line2 || ""}`.slice(0, 150),
      shipping_city: mergedAddress.city || mergedAddress.town || "",
      shipping_pincode: pincodeRaw,
      shipping_state: mergedAddress.state || "",
      shipping_country: mergedAddress.country || "India",
      shipping_isd_code: "91",
      shipping_email: customerEmail,
      shipping_phone: String(customerPhone),
      order_items: orderItems,
      payment_method: order.payment_method === "COD" ? "COD" : "Prepaid",
      shipping_charges: 0,
      giftwrap_charges: toNumber(order.gift_wrap_fee || 0),
      transaction_charges: 0,
      total_discount: toNumber(order.discount_amount || 0),
      sub_total: toNumber(order.final_amount || order.total_amount || 0),
      length: toNumber(process.env.DEFAULT_PARCEL_LENGTH_CM, 20),
      breadth: toNumber(process.env.DEFAULT_PARCEL_BREADTH_CM, 15),
      height: toNumber(process.env.DEFAULT_PARCEL_HEIGHT_CM, 10),
      weight: totalWeightKg,
      order_type: req.body.order_type || process.env.SHIPROCKET_ORDER_TYPE || undefined,
      customer_gstin: req.body.customer_gstin || undefined,
      invoice_number: req.body.invoice_number || undefined,
      ewaybill_no: req.body.ewaybill_no || undefined,
      // Note: Add GST details if needed: seller_tin, etc.
    };

    let sr;
    try {
      sr = await createOrder(payload);
    } catch (err) {
      // Surface Shiprocket error details to help diagnose address validation
      const debug = err?.response?.body || { message: err.message };
      return res.status(400).json({ success: false, message: err.message, shiprocketError: debug, payloadSent: process.env.NODE_ENV === "production" ? undefined : payload });
    }

    const shiprocketOrderId = sr.order_id || sr.orderid || sr.data?.order_id;
    const shipmentId = sr.shipment_id || sr.data?.shipment_id || (Array.isArray(sr.shipment_id) ? sr.shipment_id[0] : undefined);

    await supabaseServiceRole
      .from("orders")
      .update({ shiprocket_order_id: shiprocketOrderId, shipment_id: shipmentId, updated_at: new Date().toISOString() })
      .eq("id", orderId);

    return res.json({ success: true, data: { shiprocketOrderId, shipmentId, raw: sr } });
  } catch (err) {
    next(err);
  }
};

exports.generateAwbAndPickup = async (req, res, next) => {
  try {
    const { orderId, courierId, pickupDate } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: "orderId is required" });

    const order = await getOrderWithItems(orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    const shipmentId = order.shipment_id;
    if (!shipmentId) {
      return res.status(400).json({ success: false, message: "shipment_id missing on order. Create Shiprocket order first." });
    }

    const awbResp = await generateAwb({ shipmentId, courierId });

    const scheduledDate = pickupDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const pickupResp = await schedulePickup({ shipmentIds: [shipmentId], pickupDate: scheduledDate });

    await supabaseServiceRole
      .from("orders")
      .update({ awb_code: awbResp?.response?.data?.awb_code || awbResp?.awb_code || null, updated_at: new Date().toISOString() })
      .eq("id", orderId);

    return res.json({ success: true, data: { awb: awbResp, pickup: pickupResp } });
  } catch (err) {
    next(err);
  }
};

exports.generateLabel = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: "orderId is required" });

    const order = await getOrderWithItems(orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    const shipmentId = order.shipment_id;
    if (!shipmentId) {
      return res.status(400).json({ success: false, message: "shipment_id missing on order. Create Shiprocket order first." });
    }

    const labelResp = await generateLabel({ shipmentId });
    const labelUrl = labelResp?.label_url || labelResp?.data?.label_url || labelResp?.response?.data?.label_url;

    await supabaseServiceRole
      .from("orders")
      .update({ label_url: labelUrl || null, updated_at: new Date().toISOString() })
      .eq("id", orderId);

    return res.json({ success: true, data: { label_url: labelUrl, raw: labelResp } });
  } catch (err) {
    next(err);
  }
};

// Initiate Shiprocket return order
// POST /api/admin/shipping/create-return-order
exports.createShiprocketReturnOrder = async (req, res, next) => {
  try {
    const payload = req.body || {};
    // Ensure original internal order ID is provided to validate return window
    const originalOrderId = payload.originalOrderId || payload.orderId;
    if (!originalOrderId) {
      return res.status(400).json({ success: false, message: "originalOrderId (or orderId) is required to validate return eligibility" });
    }

    // Validate 7-day return policy window based on our internal order date
    const { data: originalOrder, error: fetchErr } = await supabaseServiceRole
      .from("orders")
      .select("id, user_id, order_date, updated_at")
      .eq("id", originalOrderId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!originalOrder) {
      return res.status(404).json({ success: false, message: "Original order not found" });
    }

    // Enforce ownership for non-admin users
    const isAdmin = req.user && req.user.role === 'admin';
    if (!isAdmin) {
      if (!req.user || originalOrder.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: "Forbidden: You can only initiate returns for your own orders." });
      }
    }

    const orderDateIso = originalOrder.order_date || originalOrder.updated_at;
    if (!orderDateIso) {
      return res.status(400).json({ success: false, message: "Original order has no date set; cannot validate return window" });
    }

    const orderDateMs = new Date(orderDateIso).getTime();
    const nowMs = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (nowMs - orderDateMs > sevenDaysMs) {
      return res.status(400).json({ success: false, message: "Return window expired. Returns are allowed within 7 days of order date." });
    }
    // Minimal validation for required keys
    const required = [
      'order_id','order_date','pickup_customer_name','pickup_address','pickup_city','pickup_state','pickup_country','pickup_pincode','pickup_email','pickup_phone',
      'shipping_customer_name','shipping_address','shipping_city','shipping_country','shipping_pincode','shipping_state','shipping_email','shipping_phone',
      'order_items','payment_method','sub_total','length','breadth','height','weight'
    ];
    const missing = required.filter(k => payload[k] === undefined || payload[k] === null || payload[k] === '');
    if (missing.length > 0) {
      return res.status(400).json({ success: false, message: `Missing required fields: ${missing.join(', ')}` });
    }

    // Remove internal-only fields before sending to Shiprocket
    const shiprocketPayload = { ...payload };
    delete shiprocketPayload.originalOrderId;
    delete shiprocketPayload.orderId; // internal reference; Shiprocket expects order_id

    const sr = await createReturnOrder(shiprocketPayload);
    return res.json({ success: true, data: sr });
  } catch (err) {
    if (err?.response) {
      return res.status(400).json({ success: false, message: err.message, shiprocketError: err.response.body });
    }
    next(err);
  }
};

exports.shiprocketTrackingWebhook = async (req, res, next) => {
  try {
    const payload = req.body || {};
    const shipmentId = payload?.shipment_id || payload?.id;
    const currentStatus = payload?.current_status || payload?.status;
    const awb = payload?.awb || payload?.awb_code;

    if (!shipmentId) {
      return res.status(400).json({ success: false, message: "shipment_id not provided" });
    }

    const statusMap = {
      "DELIVERED": "delivered",
      "IN TRANSIT": "shipped",
      "OUT FOR DELIVERY": "shipped",
      "PICKED UP": "shipped",
      "CANCELED": "cancelled",
      "RETURNED": "returned",
    };
    const mapped = statusMap[String(currentStatus || "").toUpperCase()] || null;

    const { data: orders } = await supabaseServiceRole
      .from("orders")
      .select("id")
      .eq("shipment_id", shipmentId)
      .limit(1);

    if (orders && orders.length > 0) {
      const orderId = orders[0].id;
      const updates = { updated_at: new Date().toISOString() };
      if (mapped) updates.status = mapped;
      if (awb) updates.awb_code = awb;
      await supabaseServiceRole.from("orders").update(updates).eq("id", orderId);
    }

    // TODO: trigger notifications if required
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};  