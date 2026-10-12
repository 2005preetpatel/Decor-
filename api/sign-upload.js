/* POST /api/sign-upload

   The admin page asks here before every upload. If the caller is a signed-in
   admin, this answers with a short-lived signature that lets THAT browser send
   ONE file straight to Cloudinary, into one folder, in allowed formats only.
   The file itself never passes through this server (so there is no size limit
   from the host), and the API secret never leaves it.

   Request:  { resource_type: 'image' | 'video', folder: 'project-slug' }
   Response: { upload_url, api_key, timestamp, signature, folder,
               allowed_formats, cloud_name } */

const { HttpError, env, sign, cloudinaryBase, route } = require('./_lib');

const FORMATS = {
  image: 'jpg,jpeg,png,webp,avif,gif,heic,heif',
  video: 'mp4,mov,webm,m4v',
};

module.exports = route(async function (body) {
  const type = body.resource_type;
  if (type !== 'image' && type !== 'video') {
    throw new HttpError(400, 'resource_type must be "image" or "video".');
  }

  const slug = String(body.folder || '');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    throw new HttpError(400, 'Invalid folder.');
  }

  const cloud = env('CLOUDINARY_CLOUD_NAME');
  const apiKey = env('CLOUDINARY_API_KEY');
  const secret = env('CLOUDINARY_API_SECRET');

  const params = {
    allowed_formats: FORMATS[type],
    folder: 'opula/' + slug,
    timestamp: Math.floor(Date.now() / 1000),
  };

  return {
    cloud_name: cloud,
    api_key: apiKey,
    upload_url: cloudinaryBase() + '/v1_1/' + cloud + '/' + type + '/upload',
    signature: sign(params, secret),
    ...params,
  };
});
