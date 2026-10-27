// Getting a picture from somebody's camera roll into the avatars bucket.
//
// Two jobs, and the first is the one that matters: whatever is chosen is
// re-encoded here, in the browser, to a 256px square WebP before anything
// leaves the machine. That is not only about bandwidth. A re-encode through
// a canvas drops every byte that was not pixels - EXIF, GPS coordinates, the
// camera's serial number - so a photo taken at home does not arrive on a
// public page carrying where home is.
import { supabase } from './supabase.js';
import { AVATAR_SIZE, avatarPath, checkAvatarFile } from '../../shared/profileFields.mjs';

const BUCKET = 'avatars';

// Centre-cropped to a square, then scaled. Cropping rather than squashing:
// every place this is drawn is a circle, and a squashed face in a circle
// looks like a mistake the player made rather than one the page made.
function squareCanvas(image) {
  const side = Math.min(image.width, image.height);
  const sx = (image.width - side) / 2;
  const sy = (image.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  // The browser's own smoothing, asked for explicitly: scaling a 4000px
  // photo to 256 without it is visibly gritty.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return canvas;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image couldn't be read. Try a different one."));
    };
    img.src = url;
  });
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("That image couldn't be processed."))),
      'image/webp',
      0.9
    );
  });
}

// Returns a 256px square WebP blob, or throws with a sentence a player can
// read. Exported on its own so the form can show a preview of exactly what
// it is about to upload, rather than of the original.
export async function squareWebp(file) {
  const complaint = checkAvatarFile(file);
  if (complaint) throw new Error(complaint);
  const image = await loadImage(file);
  return toBlob(squareCanvas(image));
}

// Uploads and returns the public URL to store on the profile row.
//
// `upsert` because the path is fixed per account - `<id>/avatar.webp` - so a
// new picture replaces the old one rather than piling up a folder of them,
// and there is nothing left behind to clean up later.
//
// The cache-buster on the returned URL is the point of the timestamp: the
// path has not changed, so every browser and CDN that has seen the old
// picture would go on showing it.
export async function uploadAvatar(userId, file) {
  if (!supabase) throw new Error('Pictures need a connection.');
  const path = avatarPath(userId);
  if (!path) throw new Error('Sign in to change your picture.');

  const blob = await squareWebp(file);
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/webp', upsert: true, cacheControl: '3600' });
  if (upErr) throw new Error(friendly(upErr));

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function removeAvatar(userId) {
  if (!supabase) return;
  const path = avatarPath(userId);
  if (!path) return;
  // A failure here is not worth stopping for: the profile row is about to
  // forget the URL either way, and an orphaned file in a public bucket that
  // nothing links to is tidier than a picture the player asked to remove and
  // can still see.
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
}

// Storage errors arrive as HTTP words. These are the ones a player can
// actually hit; anything else keeps its own message rather than being
// flattened into a vague one.
function friendly(err) {
  const message = String(err?.message || '');
  if (/row-level security|not authorized|403/i.test(message)) {
    return 'Only your own account can change this picture.';
  }
  if (/payload too large|413/i.test(message)) return 'That image is too large.';
  if (/bucket not found/i.test(message)) return 'Picture uploads are not set up on this server yet.';
  return message || "That picture couldn't be saved.";
}
