/* POST /api/delete-asset

   Removes files from Cloudinary. Only an admin can call it, and it only
   touches the "opula/" folder, so even a stolen admin session cannot be used
   to wipe anything else in the account.

   Request:  { items: [{ public_id, resource_type: 'image' | 'video' }, ...] }
   Response: { results: [{ public_id, result }], failed: <count> }
   `result` is Cloudinary's own word: "ok" or "not found" (both mean the file
   is gone), anything else is an error and the caller should keep the row. */

const { HttpError, env, sign, cloudinaryBase, route } = require('./_lib');

const MAX_ITEMS = 200;
const PUBLIC_ID = /^opula\/[A-Za-z0-9_\-./]{1,180}$/;

async function destroy(item, cloud, apiKey, secret) {
  const params = {
    invalidate: 'true',
    public_id: item.public_id,
    timestamp: Math.floor(Date.now() / 1000),
  };
  const form = new URLSearchParams({
    ...params,
    api_key: apiKey,
    signature: sign(params, secret),
  });

  try {
    const res = await fetch(
      cloudinaryBase() + '/v1_1/' + cloud + '/' + item.resource_type + '/destroy',
      { method: 'POST', body: form }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { public_id: item.public_id, result: 'error' };
    return { public_id: item.public_id, result: data.result || 'error' };
  } catch (e) {
    return { public_id: item.public_id, result: 'error' };
  }
}

module.exports = route(async function (body) {
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'items must be a non-empty list.');
  }
  if (items.length > MAX_ITEMS) throw new HttpError(400, 'Too many items at once.');

  for (const it of items) {
    if (!it || (it.resource_type !== 'image' && it.resource_type !== 'video')
        || typeof it.public_id !== 'string' || !PUBLIC_ID.test(it.public_id)
        || it.public_id.includes('..')) {
      throw new HttpError(400, 'Invalid item.');
    }
  }

  const cloud = env('CLOUDINARY_CLOUD_NAME');
  const apiKey = env('CLOUDINARY_API_KEY');
  const secret = env('CLOUDINARY_API_SECRET');

  // A few at a time: kind to Cloudinary's rate limit, still quick for a
  // project with a few dozen files.
  const results = [];
  for (let i = 0; i < items.length; i += 5) {
    const batch = items.slice(i, i + 5);
    results.push(...(await Promise.all(batch.map((it) => destroy(it, cloud, apiKey, secret)))));
  }

  const failed = results.filter((r) => r.result !== 'ok' && r.result !== 'not found').length;
  return { results, failed };
});
