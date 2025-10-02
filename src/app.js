require("dotenv").config();
const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const swaggerDocument = YAML.load("./swagger.yaml");
const app = express();
const bodyParser = require("body-parser");
const path = require("path");

const allowedOrigins = [
  "http://localhost:8080",  
  "https://admin.sabrshukr.store",
  "https://sabrshukr.store",
  "http://localhost:5000",
  "https://sabrshukrbackend.onrender.com",
  "http://localhost:3000",
  "http://localhost:3001",
  'https://beta.sabrshukr.store'
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // Allow non-browser requests
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Refresh-Token", "Refresh-Token"],
    credentials: true,
  })
);

// Raw body parser for Razorpay webhook (must be above JSON parsers)
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

// Global parsers for other routes
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname)));

app.use(express.json());

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

const authRoutes = require("./routes/authRoutes");
app.use("/api/auth", authRoutes);

const homepageRoutes = require("./routes/homepageRoutes");
app.use("/api/homepage", homepageRoutes);

const productRoutes = require("./routes/productRoutes");
app.use("/api/products", productRoutes);
const categoryRoutes = require("./routes/categoryRoutes");
app.use("/api/categories", categoryRoutes);

const userRoutes = require("./routes/userRoutes");
app.use("/api/user", userRoutes);

const cartRoutes = require("./routes/cartRoutes");
app.use("/api/cart", cartRoutes);

const orderRoutes = require("./routes/orderRoutes");
app.use("/api/orders", orderRoutes);

const reviewRoutes = require("./routes/reviewRoutes");
app.use("/api/reviews", reviewRoutes);

const paymentRoutes = require("./routes/paymentRoutes");
app.use("/api/payment", paymentRoutes);

const adminRoutes = require("./routes/adminRoutes");
app.use("/api/admin", adminRoutes);

const couponRoutes = require("./routes/couponRoutes");
app.use("/api/coupons", couponRoutes);

const referralRoutes = require("./routes/referralRoutes");
app.use("/api/referrals", referralRoutes);

const notificationRoutes = require("./routes/notificationRoutes");
app.use("/api/notifications", notificationRoutes);

const affiliateRoutes = require("./routes/affiliateRoutes");
app.use("/api/affiliates", affiliateRoutes);

const wishlistRoutes = require("./routes/wishlistRoutes");
app.use("/api/user/wishlist", wishlistRoutes);
// Add Deal of the Day routes
const dealRoutes = require("./routes/dealRoutes");
app.use("/api", dealRoutes);

// Upload routes
const uploadRoutes = require("./routes/uploadRoutes");
app.use("/api/upload", uploadRoutes);

// Admin Shipping routes (Shiprocket)
const shippingRoutes = require("./routes/shippingRoutes");
app.use("/api/admin/shipping", shippingRoutes);

// Webhooks
const webhookRoutes = require("./routes/webhookRoutes");
app.use("/api/webhooks", webhookRoutes);

// Error handling middleware (to be implemented)
const errorHandler = require("./middlewares/errorHandler");
app.use(errorHandler);

const delhiveryRoutes = require('./routes/delhiveryRoutes');
app.use('/api', delhiveryRoutes);

module.exports = app;
