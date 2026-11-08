/*
 * Service worker: downloads images the page cannot read because of CORS
 * (e.g. web-search images on images.openai.com). Only hosts listed in
 * manifest host_permissions are fetched, and only for messages coming from
 * our own content script on chatgpt.com. No cookies or tokens are sent.
 */
'use strict';

const ALLOWED_HOSTS = ['images.openai.com'];
const MAX_BYTES = 15 * 1024 * 1024;

function allowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.includes(u.hostname);
  } catch (_) {
    return false;
  }
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'cge:fetch-image') return false;
  const fromChatGPT = sender.id === chrome.runtime.id && sender.url && /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(sender.url);
  if (!fromChatGPT || !allowed(msg.url)) {
    sendResponse({ ok: false, error: 'host not allowed' });
    return false;
  }
  (async () => {
    try {
      const res = await fetch(msg.url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const type = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0];
      if (!type.startsWith('image/')) throw new Error('not an image: ' + type);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) throw new Error('image too large');
      sendResponse({ ok: true, mime: type, base64: toBase64(buf) });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // async response
});
