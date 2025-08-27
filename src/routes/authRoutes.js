const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const validate = require('../middlewares/validate');
const { registerSchema, loginSchema, socialLoginSchema, otpLoginSchema, sendOtpSchema, refreshTokenSchema } = require('../validators/authSchemas');

// POST /api/auth/register
router.post('/register', validate(registerSchema), authController.register);

// POST /api/auth/login
router.post('/login', validate(loginSchema), authController.login);

// POST /api/auth/logout
router.post('/logout', authController.logout);

// POST /api/auth/social-login
router.post('/social-login', validate(socialLoginSchema), authController.socialLogin);

// POST /api/auth/loginwithOtp
router.post('/loginwithOtp', validate(otpLoginSchema), authController.loginWithOtp);

// POST /api/auth/sendOtp
router.post('/sendOtp', validate(sendOtpSchema), authController.sendOtp);

// GET /api/auth/verify-token
router.get('/verify-token', authController.verifyToken);

// POST /api/auth/refresh-token
router.post(
  '/refresh-token',
  (req, _res, next) => {
    // Allow refresh token via headers as well
    if (!req.body) req.body = {};
    if (!req.body.refreshToken) {
      const headerToken = req.headers['x-refresh-token'] || req.headers['refresh-token'];
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : undefined;
      req.body.refreshToken = headerToken || bearerToken || req.body.refreshToken;
    }
    next();
  },
  validate(refreshTokenSchema),
  authController.refreshToken
);

// POST /api/auth/check-phone-exists
router.post('/check-phone-exists', authController.checkPhoneExists);

module.exports = router; 