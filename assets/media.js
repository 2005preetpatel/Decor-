/* Builds optimised Cloudinary addresses from a media row.

   Rows keep the file's public_id, not a finished URL, so sizes and formats are
   decided here and can change later without touching the database.

     images   f_auto,q_auto   the best format the visitor's browser supports
                              (AVIF / WebP / JPEG) at automatic quality
              c_limit,w_N     never upscaled, never wider than needed
     videos   f_auto:video    MP4 or WebM, whichever the browser prefers
              q_auto          automatic bitrate
              poster          a still frame 10% in (never the black first frame)

   If no cloud name is configured, or a row has no public_id, the stored
   address is used as is. */

(function () {
  'use strict';

  const cfg = window.OPULA_CONFIG || {};
  const cloud = cfg.cloudName;

  function base(type) {
    return 'https://res.cloudinary.com/' + encodeURIComponent(cloud) + '/' + type + '/upload/';
  }
  // public_id may contain "/" (folders) and must stay readable.
  function pid(m) { return String(m.public_id).split('/').map(encodeURIComponent).join('/'); }
  function usable(m) { return !!(cloud && m && m.public_id); }

  function imageUrl(m, w) {
    if (!usable(m)) return m && (m.type === 'video' ? (m.thumb_url || '') : m.url) || '';
    if (m.type === 'video') return posterUrl(m, w);
    return base('image') + 'f_auto,q_auto,c_limit,w_' + w + '/' + pid(m);
  }

  function posterUrl(m, w) {
    if (!usable(m)) return m && m.thumb_url || '';
    return base('video') + 'so_10p,f_auto,q_auto,c_limit,w_' + w + '/' + pid(m) + '.jpg';
  }

  function videoUrl(m, w) {
    if (!usable(m)) return m && m.url || '';
    return base('video') + 'f_auto:video,q_auto,c_limit,w_' + (w || 1280) + '/' + pid(m);
  }

  function srcset(m, widths) {
    if (!usable(m)) return '';
    return widths.map(function (w) { return imageUrl(m, w) + ' ' + w + 'w'; }).join(', ');
  }

  window.OpulaMedia = {
    imageUrl: imageUrl,
    posterUrl: posterUrl,
    videoUrl: videoUrl,
    srcset: srcset,
    usable: usable,
  };
})();
