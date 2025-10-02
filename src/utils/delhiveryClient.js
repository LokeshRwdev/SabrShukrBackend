const axios = require("axios");

const BASE_URL =
  process.env.DELHIVERY_API_BASE_URL || "https://track.delhivery.com";
const TOKEN = (process.env.DELHIVERY_API_TOKEN || "").trim();

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  headers: {
    Authorization: `Token ${TOKEN}`,
    Accept: "application/json",
  },
});

// Create Order API
async function createDelhiveryOrder(payload) {
  // Delhivery expects: format=json and data=<JSON string>, sent as x-www-form-urlencoded
  const form = new URLSearchParams();
  form.append("format", "json");
  form.append("data", JSON.stringify(payload));

  const { data } = await client.post(
    "/api/cmu/create.json",
    form.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );
  return data;
}

module.exports = { createDelhiveryOrder };
