const { put } = require('@vercel/blob');

/**
 * Upload buffer to Vercel Blob
 * @param {Object} params
 * @param {string} params.key - File path/name (e.g., "uploads/profile/2025-01-08/abc.webp")
 * @param {string} params.contentType - MIME type
 * @param {Buffer} params.buffer - File buffer
 * @returns {Promise<{url: string}>}
 */
async function uploadBufferToBlob({ key, contentType, buffer }) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  
  // Better validation
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not configured in environment variables');
  }

  if (!token.startsWith('vercel_blob_rw_')) {
    throw new Error('BLOB_READ_WRITE_TOKEN has invalid format. Should start with "vercel_blob_rw_"');
  }

  console.log('Using Blob token:', token.substring(0, 20) + '...' + token.slice(-4)); // Debug log

  try {
    const blob = await put(key, buffer, {
      access: 'public',
      contentType,
      token,
    });

    console.log('Upload successful:', blob.url);
    return { url: blob.url };
  } catch (error) {
    console.error('Vercel Blob upload failed:', {
      message: error.message,
      key,
      contentType,
      bufferSize: buffer.length,
      tokenPrefix: token.substring(0, 20) + '...'
    });
    throw new Error(`Blob upload failed: ${error.message}`);
  }
}

module.exports = { uploadBufferToBlob };