const crypto = require('crypto');

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dp95lvewl';
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const CLOUDINARY_UPLOAD_FOLDER = process.env.CLOUDINARY_UPLOAD_FOLDER || 'face-attendance';

function getCloudinaryConfig() {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return null;
  }

  return {
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    apiSecret: CLOUDINARY_API_SECRET,
  };
}

function getCloudinaryStatus() {
  return {
    cloudName: CLOUDINARY_CLOUD_NAME,
    folder: CLOUDINARY_UPLOAD_FOLDER,
    enabled: Boolean(getCloudinaryConfig()),
  };
}

function signCloudinaryParams(params, apiSecret) {
  const signatureBase = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  return crypto.createHash('sha1').update(`${signatureBase}${apiSecret}`).digest('hex');
}

async function uploadImageToCloudinary(image, folder, publicId) {
  const config = getCloudinaryConfig();

  if (!config) {
    throw new Error('Cloudinary credentials are not configured.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signedParams = {
    folder,
    overwrite: 'true',
    public_id: publicId,
    timestamp,
  };
  const signature = signCloudinaryParams(signedParams, config.apiSecret);
  const formData = new FormData();
  formData.append('file', image);
  formData.append('api_key', config.apiKey);
  formData.append('timestamp', String(timestamp));
  formData.append('signature', signature);
  formData.append('folder', folder);
  formData.append('public_id', publicId);
  formData.append('overwrite', 'true');

  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error?.message || `Cloudinary upload failed with status ${response.status}`);
  }

  return {
    publicId: payload.public_id,
    secureUrl: payload.secure_url,
    width: payload.width || null,
    height: payload.height || null,
  };
}

async function uploadImagesToCloudinary(images, folder, publicIdPrefix = '') {
  if (!getCloudinaryConfig()) {
    return {
      enabled: false,
      images: [],
      message: 'Cloudinary upload skipped. Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET at runtime.',
    };
  }

  const uploads = await Promise.all(
    images.map((image, index) => {
      const suffix = String(index).padStart(3, '0');
      const publicId = publicIdPrefix ? `${publicIdPrefix}_${suffix}` : suffix;
      return uploadImageToCloudinary(image, folder, publicId);
    })
  );

  return {
    enabled: true,
    images: uploads,
    message: 'Cloudinary upload completed.',
  };
}

module.exports = {
  CLOUDINARY_UPLOAD_FOLDER,
  getCloudinaryConfig,
  getCloudinaryStatus,
  uploadImagesToCloudinary,
};
