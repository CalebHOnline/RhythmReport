// auth.js — Spotify OAuth 2.0 PKCE flow (no backend needed)

const CLIENT_ID = '45ab5393ba4443249f0266557fbda39c';
const REDIRECT_URI = 'https://squirmyding.github.io/RhythemReport-for-Spotify/';
const SCOPES = [
  'user-top-read',
  'user-read-private',
  'user-read-recently-played',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');
// ── PKCE Helpers ──────────────────────────────────────────────

async function generateCodeVerifier(length = 128) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => chars[b % chars.length]).join('');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Login ─────────────────────────────────────────────────────

async function login() {
  const verifier = await generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem('code_verifier', verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });

  window.location = `https://accounts.spotify.com/authorize?${params}`;
}

// ── Token Exchange ────────────────────────────────────────────

async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem('code_verifier');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) throw new Error('Token exchange failed');

  const data = await res.json();
  storeTokens(data);
  return data.access_token;
}

// ── Token Refresh ─────────────────────────────────────────────

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('spotify_refresh_token');
  if (!refreshToken) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) { logout(); return null; }

  const data = await res.json();
  storeTokens(data);
  return data.access_token;
}

// ── Token Storage ─────────────────────────────────────────────

function storeTokens(data) {
  localStorage.setItem('spotify_access_token', data.access_token);
  localStorage.setItem('spotify_token_expiry', Date.now() + data.expires_in * 1000);
  if (data.refresh_token) {
    localStorage.setItem('spotify_refresh_token', data.refresh_token);
  }
}

async function getValidToken() {
  const token = localStorage.getItem('spotify_access_token');
  const expiry = parseInt(localStorage.getItem('spotify_token_expiry') || '0', 10);

  if (token && Date.now() < expiry - 60000) return token; // still valid
  return await refreshAccessToken();
}

function logout() {
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_token_expiry');
  window.location.href = '/';
}

// ── Attach login button ───────────────────────────────────────

document.getElementById('login-btn')?.addEventListener('click', login);
document.getElementById('logout-btn')?.addEventListener('click', logout);