const crypto = require('crypto');
const { uploadBufferToS3 } = require('../utils/s3Client');

// POST /api/upload
// Accepts multipart/form-data with field name "file"
exports.uploadMedia = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const file = req.file;
    const isAllowed = /^image\//.test(file.mimetype) || /^video\//.test(file.mimetype);
    if (!isAllowed) {
      return res.status(400).json({ success: false, message: 'Only images or videos are allowed' });
    }

    // Determine bucket and prefix based on use case or explicit bucket
    const useCase = (req.body.useCase || 'profile').toLowerCase();
    const bucket = req.body.bucket ||
      (useCase === 'profile' ? (process.env.AWS_S3_BUCKET_PROFILE || process.env.AWS_S3_BUCKET) :
      useCase === 'review' ? (process.env.AWS_S3_BUCKET_REVIEW || process.env.AWS_S3_BUCKET) :
      useCase === 'product' ? (process.env.AWS_S3_BUCKET_PRODUCT || process.env.AWS_S3_BUCKET) :
      process.env.AWS_S3_BUCKET) || 'dummy-bucket-name';

    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    const prefix = req.body.keyPrefix || `uploads/${useCase}`;
    const key = `${prefix}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${ext || 'bin'}`;

    await uploadBufferToS3({
      bucket,
      key,
      contentType: file.mimetype,
      buffer: file.buffer,
    });

    // Build public URL using specific base-per-bucket if provided
    const publicBase = req.body.publicBase ||
      (bucket === (process.env.AWS_S3_BUCKET_PROFILE) && process.env.AWS_S3_PUBLIC_BASE_URL_PROFILE) ||
      (bucket === (process.env.AWS_S3_BUCKET_REVIEW) && process.env.AWS_S3_PUBLIC_BASE_URL_REVIEW) ||
      (bucket === (process.env.AWS_S3_BUCKET_PRODUCT) && process.env.AWS_S3_PUBLIC_BASE_URL_PRODUCT) ||
      process.env.AWS_S3_PUBLIC_BASE_URL || 'https://dummy-bucket.s3.amazonaws.com';
    const url = `${publicBase}/${key}`;

    return res.status(201).json({ success: true, data: { url, key, bucket, contentType: file.mimetype, size: file.size } });
  } catch (err) {
    next(err);
  }
};


