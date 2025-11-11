// src/routes/dealRoutes.js
const express = require("express");
const router = express.Router();
const dealController = require("../controllers/dealController");
const adminAuthMiddleware = require("../middlewares/adminAuthWithSupabase");

// Admin Endpoints (Supabase JWT)
router.post("/admin/deals", adminAuthMiddleware, dealController.createDeal);
router.get("/admin/deals", adminAuthMiddleware, dealController.getAllDeals);
router.put("/admin/deals/:id", adminAuthMiddleware, dealController.updateDeal);
router.delete("/admin/deals/:id", adminAuthMiddleware, dealController.deleteDeal);

// User Endpoint
router.get("/deal-of-the-day", dealController.getActiveDeal);

module.exports = router;
