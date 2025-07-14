// src/routes/dealRoutes.js
const express = require("express");
const router = express.Router();
const dealController = require("../controllers/dealController");
const isAdmin = require("../middlewares/adminAuth");

// Admin Endpoints
router.post("/admin/deals", isAdmin, dealController.createDeal);
router.get("/admin/deals", isAdmin, dealController.getAllDeals);
router.put("/admin/deals/:id", isAdmin, dealController.updateDeal);
router.delete("/admin/deals/:id", isAdmin, dealController.deleteDeal);

// User Endpoint
router.get("/deal-of-the-day", dealController.getActiveDeal);

module.exports = router;
