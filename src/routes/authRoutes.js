const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const validate = require('../middlewares/validate');
const { registerSchema, loginSchema, socialLoginSchema, otpLoginSchema, sendOtpSchema } = require('../validators/authSchemas');
const { registerWithReferralSchema } = require('../validators/referralSchemas');

// POST /api/auth/register
router.post('/register', validate(registerWithReferralSchema), authController.register);

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

module.exports = router; 