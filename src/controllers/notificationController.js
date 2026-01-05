// Notification Controller
const { serviceRole: supabaseServiceRole } = require("../utils/supabaseClient");
const { sendEmail } = require("../utils/bervo");
const jwt = require("jsonwebtoken");

function extractEmailFromAuth(req) {
  try {
    const header = req.headers?.authorization || req.headers?.Authorization;
    if (!header || !header.startsWith("Bearer ")) return null;
    const token = header.slice(7);

    // Verify with our custom JWT_SECRET
    if (process.env.JWT_SECRET) {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      return payload?.email || null;
    }
    // Fallback: decode without verify
    const decoded = jwt.decode(token);
    return decoded?.email || null;
  } catch (error) {
    console.error('Error extracting email from auth token:', error.message);
    return null;
  }
}

// GET /api/notifications/:userId
exports.getNotificationsByUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    // RLS policies on the 'notifications' table should ensure users only see their own notifications
    // Admins will see all notifications due to their RLS policy.
    const { data: notifications, error } = await supabaseServiceRole
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return res
        .status(500)
        .json({ message: "Failed to fetch notifications." });
    }
    return res.status(200).json({ notifications });
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications (Admin Only)
exports.createNotification = async (req, res, next) => {
  try {
    const { userId, title, message, link_to } = req.body;

    // Use service role client if inserting for a user different from the current authenticated user
    // or if the RLS policy for insert prevents direct user inserts.
    const { data, error } = await supabaseServiceRole
      .from("notifications")
      .insert({
        user_id: userId,
        title,
        message,
        link_to,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating notification:", error);
      return res
        .status(500)
        .json({ message: "Failed to create notification." });
    }
    return res.status(201).json({
      message: "Notification created successfully.",
      notification: data,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications/send-order-email
// Body: { orderId: number, ...optional details... }
exports.sendOrderNotification = async (req, res, next) => {
  try {
    const {
      orderId,
      customerName,
      orderItems,
      subtotal,
      shipping,
      taxes,
      total,
    } = req.body || {};

    // Validation
    if (orderId == null || orderId === "") {
      return res.status(400).json({
        success: false,
        message: "orderId is required",
      });
    }

    // Fetch the order to get the user_id
    const { data: order, error: orderError } = await supabaseServiceRole
      .from("orders")
      .select("user_id")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      console.error("Error fetching order:", orderError);
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Fetch the customer email from profiles table
    const { data: profile, error: profileError } = await supabaseServiceRole
      .from("profiles")
      .select("email")
      .eq("id", order.user_id)
      .single();

    if (profileError || !profile || !profile.email) {
      console.error("Error fetching customer email:", profileError);
      return res.status(404).json({
        success: false,
        message: "Customer email not found",
      });
    }

    const resolvedEmail = profile.email;
    console.log(`Sending order notification to: ${resolvedEmail} for order #${orderId}`);

    const subject = `Your Order #${orderId} Confirmation`;
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Confirmation</title>
        <style>
          body { margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
          .header { display: flex; justify-content: space-between; align-items: center; padding: 20px; border-bottom: 1px solid #e0e0e0; }
          .logo { font-size: 24px; font-weight: bold; color: #333; }
          .order-id { color: #888; font-size: 14px; }
          .content { padding: 30px 20px; }
          .greeting { font-size: 24px; font-weight: 600; color: #333; margin-bottom: 20px; }
          .message { color: #555; line-height: 1.6; margin-bottom: 20px; }
          .cta-section { text-align: center; margin: 30px 0; }
          .btn-primary { background-color: #ffd700; color: #333; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: 600; display: inline-block; margin-right: 10px; }
          .btn-secondary { color: #ffd700; text-decoration: none; }
          .order-summary { margin-top: 40px; }
          .section-title { font-size: 18px; font-weight: 600; color: #333; margin-bottom: 20px; }
          .order-item { display: flex; align-items: center; padding: 15px 0; border-bottom: 1px solid #f0f0f0; }
          .item-image { width: 60px; height: 60px; background-color: #f5f5f5; border-radius: 5px; margin-right: 15px; }
          .item-details { flex: 1; }
          .item-name { font-weight: 500; color: #333; margin-bottom: 5px; }
          .item-price { color: #666; font-weight: 600; }
          .summary-row { display: flex; justify-content: space-between; padding: 8px 0; }
          .summary-total { display: flex; justify-content: space-between; padding: 15px 0; border-top: 2px solid #e0e0e0; font-size: 18px; font-weight: 600; }
          .footer { padding: 20px; color: #888; font-size: 12px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <!-- Header -->
          <div class="header">
            <div class="logo">
              <img src="https://sabrshukr.s3.eu-north-1.amazonaws.com/S%26Sfinal.png" alt="SabrShukr" style="height: 40px;">  
            </div>
            <div class="order-id">ORDER #${orderId}</div>
          </div>

          <!-- Content -->
          <div class="content">
            <div class="greeting">Hi ${customerName || "Valued Customer"}</div>
            
            <div class="message">
              Thank you so much for ordering from us! As a young wellness startup, every single order truly means the world to us
            </div>
            
            <div class="message">
              We’ll notify you as soon as your order is shipped. Meanwhile, here’s your order summary
            </div>
            
            <div class="message">
              We can’t wait for you to receive your SabrShukr product — something created with love, calmness, and care.
            </div>

            <!-- CTA Buttons -->
            <div class="cta-section">
              <a href="https://sabrshukr.store/account/orders/${orderId}" class="btn-primary">View your order</a>
              <span style="margin: 0 10px; color: #888;">or</span>
              <a href="https://sabrshukr.store" class="btn-secondary">Visit our store</a>
            </div>

            <!-- Order Summary -->
            <div class="order-summary">
              <div class="section-title">Order summary</div>
              
              ${
                orderItems && orderItems.length > 0
                  ? orderItems
                      .map(
                        (item) => `
                <div class="order-item">
                  <div class="item-image" style="background-image: url('${
                    item.image ||
                    "https://via.placeholder.com/60x60/f5f5f5/ccc?text=IMG"
                  }'); background-size: cover; background-position: center;"></div>
                  <div class="item-details">
                    <div class="item-name">${item.name} × ${item.quantity}</div>
                  </div>
                  <div class="item-price">₹ ${item.price}</div>
                </div>
              `
                      )
                      .join("")
                  : `
                <div class="order-item">
                  <div class="item-image"></div>
                  <div class="item-details">
                    <div class="item-name">Order #${orderId}</div>
                  </div>
                  <div class="item-price">₹ ${total || "0.00"}</div>
                </div>
              `
              }

              <div style="margin-top: 20px;">
                <div class="summary-row">
                  <span>Subtotal</span>
                  <span>₹ ${subtotal || "0.00"}</span>
                </div>
                <div class="summary-row">
                  <span>Shipping</span>
                  <span>₹ ${shipping || "0.00"}</span>
                </div>
                <div class="summary-row">
                  <span>Taxes</span>
                  <span>₹ ${taxes || "0.00"}</span>
                </div>
                <div class="summary-total">
                  <span>Total</span>
                  <span>₹ ${total || "0.00"}</span>
                </div>
              </div>
            </div>

            <div class="message" style="margin-top: 30px;">
              Please do not reply to this email. For any query, contact us on 
              <a href="mailto:support@sabrshukr.store" style="color: #007bff;">support@sabrshukr.store</a>
            </div>
            <div style="margin-top: 20px; color: #666;">
              With Gratitude,
            </div>
            
            <div style="margin-top: 20px; color: #666;">
              Team SabrShukr
            </div>
          </div>

          <!-- Footer -->
          <div class="footer">
            <p>© 2025 SabrShukr. All rights reserved.</p>
            <p>This email was sent to ${resolvedEmail}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Use Brevo to send email
    const response = await sendEmail(
      resolvedEmail,
      customerName || "Valued Customer",
      subject,
      htmlContent
    );

    return res.status(200).json({
      success: true,
      data: {
        messageId: response.messageId,
        service: "brevo",
      },
    });
  } catch (err) {
    console.error("Error sending order notification:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send order confirmation email. Please try again later.",
    });
  }
};
