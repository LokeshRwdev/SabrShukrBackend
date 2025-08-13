const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  } : undefined,
});

async function uploadBufferToS3({ bucket, key, contentType, buffer }) {
  const baseParams = {
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  };

  const useAcl = (process.env.AWS_S3_USE_ACL || '').toLowerCase() === 'true';

  try {
    const params = useAcl ? { ...baseParams, ACL: 'public-read' } : baseParams;
    const command = new PutObjectCommand(params);
    await s3.send(command);
  } catch (err) {
    const message = String(err && (err.name || err.code || err.message) || '');
    const aclNotAllowed = /does not allow ACLs|AccessControlListNotSupported|InvalidRequest/i.test(message);
    if (useAcl && aclNotAllowed) {
      // Retry without ACL for buckets with Object Ownership: Bucket owner enforced
      const retryCommand = new PutObjectCommand(baseParams);
      await s3.send(retryCommand);
      return;
    }
    throw err;
  }
}

module.exports = { s3, uploadBufferToS3 };


