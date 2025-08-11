const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const validate = require('../middlewares/validate');
const { uploadSchema } = require('../validators/uploadSchemas');
const auth = require('../middlewares/auth');
const uploadController = require('../controllers/uploadController');

// Allow any authenticated user to upload media
router.post('/', auth, upload.single('file'), validate(uploadSchema), uploadController.uploadMedia);

module.exports = router;


