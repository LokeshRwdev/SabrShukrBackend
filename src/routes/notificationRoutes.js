const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const validate = require('../middlewares/validate');
const adminAuthMiddleware = require('../middlewares/adminAuthWithSupabase');
const { getNotificationsByUserSchema, createNotificationSchema, sendOrderNotificationSchema } = require('../validators/notificationSchemas');

// Get all notifications for a user
router.get('/:userId', validate(getNotificationsByUserSchema), notificationController.getNotificationsByUser);

// Create a new notification (Admin Only - Supabase JWT)
router.post('/', adminAuthMiddleware, validate(createNotificationSchema), notificationController.createNotification);

// Send order email notification (Public endpoint - no auth required)
router.post('/send-order-email', validate(sendOrderNotificationSchema), notificationController.sendOrderNotification);

module.exports = router;