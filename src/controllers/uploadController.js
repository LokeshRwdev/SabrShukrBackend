const crypto = require('crypto');
const sharp = require('sharp');
const { uploadBufferToS3 } = require('../utils/s3Client');

// POST /api/upload
// Accepts multipart/form-data with field name "file"
exports.uploadMedia = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const file = req.file;
    const isImage = /^image\//.test(file.mimetype);
    const isVideo = /^video\//.test(file.mimetype);
    
    if (!isImage && !isVideo) {
      return res.status(400).json({ success: false, message: 'Only images or videos are allowed' });
    }

    // Determine bucket and prefix based on use case or explicit bucket
    const useCase = (req.body.useCase || 'profile').toLowerCase();
    const bucket = req.body.bucket ||
      (useCase === 'profile' ? (process.env.AWS_S3_BUCKET_PROFILE || process.env.AWS_S3_BUCKET) :
      useCase === 'review' ? (process.env.AWS_S3_BUCKET_REVIEW || process.env.AWS_S3_BUCKET) :
      useCase === 'product' ? (process.env.AWS_S3_BUCKET_PRODUCT || process.env.AWS_S3_BUCKET) :
      process.env.AWS_S3_BUCKET) || 'dummy-bucket-name';

    let processedBuffer = file.buffer;
    let finalMimeType = file.mimetype;
    let fileExtension = (file.originalname.split('.').pop() || '').toLowerCase();

    // Process images with Sharp
    if (isImage) {
      try {
        // Get image dimensions from query params or use defaults
        const maxWidth = parseInt(req.body.maxWidth || req.query.maxWidth || '1920');
        const maxHeight = parseInt(req.body.maxHeight || req.query.maxHeight || '1080');
        const quality = parseInt(req.body.quality || req.query.quality || '70');

        // Process image with Sharp
        const sharpInstance = sharp(file.buffer)
          .resize(maxWidth, maxHeight, {
            fit: 'inside', // Maintain aspect ratio, fit within bounds
            withoutEnlargement: true // Don't upscale small images
          })
          .webp({ quality: Math.min(Math.max(quality, 10), 100) }); // Ensure quality is between 10-100

        processedBuffer = await sharpInstance.toBuffer();
        finalMimeType = 'image/webp';
        fileExtension = 'webp';

        console.log(`Image optimized: ${file.originalname} -> WebP (${processedBuffer.length} bytes)`);
      } catch (sharpError) {
        console.error('Sharp processing failed:', sharpError);
        // Fallback to original if Sharp fails
        processedBuffer = file.buffer;
        finalMimeType = file.mimetype;
      }
    }

    const prefix = req.body.keyPrefix || `uploads/${useCase}`;
    const key = `${prefix}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${fileExtension}`;

    await uploadBufferToS3({
      bucket,
      key,
      contentType: finalMimeType,
      buffer: processedBuffer,
    });

    // Build public URL using specific base-per-bucket if provided
    const publicBase = req.body.publicBase ||
      (bucket === (process.env.AWS_S3_BUCKET_PROFILE) && process.env.AWS_S3_PUBLIC_BASE_URL_PROFILE) ||
      (bucket === (process.env.AWS_S3_BUCKET_REVIEW) && process.env.AWS_S3_PUBLIC_BASE_URL_REVIEW) ||
      (bucket === (process.env.AWS_S3_BUCKET_PRODUCT) && process.env.AWS_S3_PUBLIC_BASE_URL_PRODUCT) ||
      process.env.AWS_S3_PUBLIC_BASE_URL || 'https://dummy-bucket.s3.amazonaws.com';
    const url = `${publicBase}/${key}`;

    return res.status(201).json({ 
      success: true, 
      data: { 
        url, 
        key, 
        bucket, 
        contentType: finalMimeType, 
        size: processedBuffer.length,
        originalSize: file.size,
        optimized: isImage,
        format: isImage ? 'webp' : fileExtension
      } 
    });
  } catch (err) {
    next(err);
  }
};


