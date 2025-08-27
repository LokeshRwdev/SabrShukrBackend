const BASE_URL = "https://apiv2.shiprocket.in/v1/external";

let cachedAccessToken = null;
let tokenExpiryEpochMs = 0;

function getPickupPostcode() {
  return  process.env.STORE_PINCODE || "110020";
}

async function ensureAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiryEpochMs) {
    return cachedAccessToken;
  }

  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) {
    throw new Error("Shiprocket credentials are not configured in environment variables");
  }

  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to authenticate with Shiprocket: ${response.status} ${text}`);
  }

  const json = await response.json();
  // Shiprocket typically returns token and/or JWT with 24h validity
  cachedAccessToken = json.token || json.access_token || null;
  // Default to 23h to be safe if no expiry info provided
  const ttlMs = 23 * 60 * 60 * 1000;
  tokenExpiryEpochMs = Date.now() + ttlMs;

  if (!cachedAccessToken) {
    throw new Error("Shiprocket auth did not return a token");
  }
  return cachedAccessToken;
}

async function shiprocketRequest(path, options = {}) {
  const token = await ensureAccessToken();
  const url = path.startsWith("http") ? path : `${BASE_URL}/${path.replace(/^\/+/, "")}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };
  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    json = { raw: text };
  }
  if (!response.ok) {
    const reason = json?.message || json?.error || response.statusText;
    const err = new Error(`Shiprocket API error: ${response.status} ${reason}`);
    err.response = { status: response.status, body: json };
    throw err;
  }
  return json;
}

async function checkServiceability({ deliveryPostcode, totalWeightKg, isCod }) {
  const pickupPostcode = getPickupPostcode();
  const query = new URLSearchParams({
    pickup_postcode: String(pickupPostcode),
    delivery_postcode: String(deliveryPostcode),
    weight: String(totalWeightKg || 0.5),
    cod: isCod ? "1" : "0",
  }).toString();
  return shiprocketRequest(`courier/serviceability?${query}`, { method: "GET" });
}

async function createOrder(payload) {
  return shiprocketRequest("orders/create/adhoc", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function createReturnOrder(payload) {
  return shiprocketRequest("orders/create/return", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function generateAwb({ shipmentId, courierId }) {
  const body = courierId ? { shipment_id: shipmentId, courier_id: courierId } : { shipment_id: shipmentId };
  return shiprocketRequest("courier/assign/awb", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function schedulePickup({ shipmentIds, pickupDate }) {
  return shiprocketRequest("courier/pickup", {
    method: "POST",
    body: JSON.stringify({ shipment_id: shipmentIds, pickup_date: pickupDate }),
  });
}

async function generateLabel({ shipmentId }) {
  return shiprocketRequest("courier/generate/label", {
    method: "POST",
    body: JSON.stringify({ shipment_id: [shipmentId] }),
  });
}

module.exports = {
  ensureAccessToken,
  shiprocketRequest,
  checkServiceability,
  createOrder,
  createReturnOrder,
  generateAwb,
  schedulePickup,
  generateLabel,
};


