const { serviceRole: supabaseServiceRole } = require("../utils/supabaseClient");
const {
  checkServiceability,
  createOrder,
  generateAwb,
  schedulePickup,
  generateLabel,
} = require("../utils/shiprocketClient");

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

    const address = order.shipping_address || {};
    const customerName = address.name || order.profiles?.full_name || "Customer";
    const customerEmail = address.email || process.env.SHIPROCKET_FALLBACK_EMAIL || "order@sabrshukr.store";
    const customerPhone = address.phone_number || address.phone || order.profiles?.phone_number || process.env.SHIPROCKET_FALLBACK_PHONE || "9999999999";

    const orderItems = (order.order_items || []).map((it) => ({
      name: it.product_name || it.products?.name || `Item ${it.product_id || it.variant_id}`,
      sku: it.sku || it.product_variants?.sku || String(it.variant_id || it.product_id),
      units: toNumber(it.quantity, 1),
      selling_price: toNumber(it.price_at_purchase || it.unit_price || 0),
      discount: toNumber(order.discount_amount || 0),
      tax: 0,
      hsn: process.env.DEFAULT_HSN_CODE || undefined,
    }));

    const payload = {
      order_id: String(order.id),
      order_date: new Date(order.order_date || Date.now()).toISOString(),
      pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || "Primary",
      billing_customer_name: customerName,
      billing_last_name: "",
      billing_address: `${address.address_line1 || address.address || ""}`.slice(0, 150),
      billing_address_2: `${address.address_line2 || ""}`.slice(0, 150),
      billing_city: address.city || address.town || "",
      billing_pincode: String(address.pincode || address.postal_code || ""),
      billing_state: address.state || "",
      billing_country: address.country || "India",
      billing_email: customerEmail,
      billing_phone: String(customerPhone),
      shipping_is_billing: true,
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
      // Note: Add GST details if needed: seller_tin, etc.
    };

    const sr = await createOrder(payload);

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