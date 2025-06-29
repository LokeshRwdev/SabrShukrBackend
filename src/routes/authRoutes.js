const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const validate = require('../middlewares/validate');
const { registerSchema, loginSchema, socialLoginSchema } = require('../validators/authSchemas');

// POST /api/auth/register
router.post('/register', validate(registerSchema), authController.register);

// POST /api/auth/login
router.post('/login', validate(loginSchema), authController.login);

// POST /api/auth/logout
router.post('/logout', authController.logout);

// POST /api/auth/social-login
router.post('/social-login', validate(socialLoginSchema), authController.socialLogin);

module.exports = router; 