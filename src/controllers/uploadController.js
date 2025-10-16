const crypto = require('crypto');
const sharp = require('sharp');
const { uploadBufferToBlob } = require('../utils/vercelBlobClient');

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

    let processedBuffer = file.buffer;
    let finalMimeType = file.mimetype;
    let fileExtension = (file.originalname.split('.').pop() || '').toLowerCase();

    // Process images with Sharp (optimized WebP conversion)
    if (isImage) {
      try {
        const maxWidth = parseInt(req.body.maxWidth || req.query.maxWidth || '1920');
        const maxHeight = parseInt(req.body.maxHeight || req.query.maxHeight || '1080');
        const quality = parseInt(req.body.quality || req.query.quality || '95');

        const sharpInstance = sharp(file.buffer)
          .resize(maxWidth, maxHeight, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .webp({ quality: Math.min(Math.max(quality, 10), 100) });

        processedBuffer = await sharpInstance.toBuffer();
        finalMimeType = 'image/webp';
        fileExtension = 'webp';

        console.log(`Image optimized: ${file.originalname} -> WebP (${processedBuffer.length} bytes)`);
      } catch (sharpError) {
        console.error('Sharp processing failed:', sharpError);
        processedBuffer = file.buffer;
        finalMimeType = file.mimetype;
      }
    }

    // Build key (path) for Vercel Blob
    const useCase = (req.body.useCase || 'general').toLowerCase();
    const prefix = req.body.keyPrefix || `uploads/${useCase}`;
    const datePath = new Date().toISOString().slice(0, 10);
    const uniqueId = crypto.randomUUID();
    const key = `${prefix}/${datePath}/${uniqueId}.${fileExtension}`;

    // Upload to Vercel Blob
    const { url } = await uploadBufferToBlob({
      key,
      contentType: finalMimeType,
      buffer: processedBuffer,
    });

    return res.status(201).json({ 
      success: true, 
      data: { 
        url,
        key,
        contentType: finalMimeType,
        size: processedBuffer.length,
        originalSize: file.size,
        optimized: isImage,
        format: isImage ? 'webp' : fileExtension,
        storage: 'vercel-blob'
      } 
    });
  } catch (err) {
    console.error('Upload error:', err);
    next(err);
  }
};


