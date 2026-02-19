// app.js — Spotify Stats Dashboard

// ── State ─────────────────────────────────────────────────────
let currentTab = 'tracks';
let currentRange = 'short_term';
let nowPlayingInterval = null;
let cachedStatsData = null; // cache for share card

// ── Spotify API ───────────────────────────────────────────────

async function spotifyFetch(url, options = {}) {
  const token = await getValidToken();
  if (!token) { logout(); return null; }

  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });

  if (res.status === 401) { logout(); return null; }
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Spotify API error: ${res.status}`);
  return res.json();
}

async function spotifyPut(url) {
  const token = await getValidToken();
  if (!token) return;
  await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
}

async function spotifyPost(url) {
  const token = await getValidToken();
  if (!token) return;
  await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
}

async function getTopTracks(timeRange, limit = 20) {
  const data = await spotifyFetch(
    `https://api.spotify.com/v1/me/top/tracks?limit=${limit}&time_range=${timeRange}`
  );
  return data?.items || [];
}

async function getTopArtists(timeRange, limit = 20) {
  const data = await spotifyFetch(
    `https://api.spotify.com/v1/me/top/artists?limit=${limit}&time_range=${timeRange}`
  );
  return data?.items || [];
}

async function getUserProfile() {
  return await spotifyFetch('https://api.spotify.com/v1/me');
}

// ── Render ────────────────────────────────────────────────────

function renderTracks(tracks) {
  const grid = document.getElementById('grid');
  grid.innerHTML = tracks.map((track, i) => {
    const image = track.album.images[0]?.url || '';
    const artists = track.artists.map(a => a.name).join(', ');
    return `
      <div class="card" style="animation-delay:${i * 0.035}s">
        <div class="card-image-wrap">
          <img src="${image}" alt="${escapeHtml(track.name)}" loading="lazy"/>
          <span class="card-rank">#${i + 1}</span>
        </div>
        <div class="card-body">
          <div class="card-name">${escapeHtml(track.name)}</div>
          <div class="card-sub">${escapeHtml(artists)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderArtists(artists) {
  const grid = document.getElementById('grid');
  grid.innerHTML = artists.map((artist, i) => {
    const image = artist.images[0]?.url || '';
    const genres = (artist.genres || []).slice(0, 2).join(', ') || 'artist';
    return `
      <div class="card" style="animation-delay:${i * 0.035}s">
        <div class="card-image-wrap">
          <img src="${image}" alt="${escapeHtml(artist.name)}" loading="lazy"/>
          <span class="card-rank">#${i + 1}</span>
        </div>
        <div class="card-body">
          <div class="card-name">${escapeHtml(artist.name)}</div>
          <div class="card-sub">${escapeHtml(genres)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Load & Refresh ────────────────────────────────────────────

async function loadData() {
  const loading = document.getElementById('loading');
  const grid = document.getElementById('grid');

  loading.classList.remove('hidden');
  grid.innerHTML = '';

  try {
    if (currentTab === 'tracks') {
      const tracks = await getTopTracks(currentRange);
      renderTracks(tracks);
    } else {
      const artists = await getTopArtists(currentRange);
      renderArtists(artists);
    }
  } catch (err) {
    grid.innerHTML = `<p style="color:#666; grid-column:1/-1;">Something went wrong. Please try again.</p>`;
    console.error(err);
  } finally {
    loading.classList.add('hidden');
  }
}

// ── Controls ──────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    loadData();
  });
});

document.querySelectorAll('.range').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRange = btn.dataset.range;
    loadData();
  });
});

// ── Page Navigation (with transitions) ───────────────────────

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
  const page = document.getElementById(pageId);
  if (page) {
    // Re-trigger animation
    page.style.animation = 'none';
    page.offsetHeight; // force reflow
    page.style.animation = '';
    page.classList.add('active-page');
  }
}

// ── Init ──────────────────────────────────────────────────────

async function init() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');

  if (code) {
    try {
      await exchangeCodeForToken(code);
      window.history.replaceState({}, document.title, '/');
    } catch (err) {
      console.error('Auth error:', err);
      showLogin();
      return;
    }
  }

  const token = await getValidToken();
  if (token) {
    showDashboard();
  } else {
    showLogin();
  }
}

async function showDashboard() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');

  try {
    const profile = await getUserProfile();
    if (profile) {
      document.getElementById('user-name').textContent = profile.display_name || '';
    }
  } catch (_) {}

  loadData();
  startNowPlaying();
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
}

init();


// ══════════════════════════════════════════════════════════════
// NOW PLAYING
// ══════════════════════════════════════════════════════════════

async function fetchPlaybackState() {
  try {
    const data = await spotifyFetch('https://api.spotify.com/v1/me/player');
    return data;
  } catch {
    return null;
  }
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function updateNowPlaying(state) {
  const bar = document.getElementById('now-playing');

  if (!state || !state.item) {
    bar.classList.add('hidden');
    document.getElementById('dashboard').classList.remove('has-player');
    return;
  }

  bar.classList.remove('hidden');
  document.getElementById('dashboard').classList.add('has-player');

  const track = state.item;
  const img = track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || '';
  const artists = track.artists?.map(a => a.name).join(', ') || '';

  document.getElementById('np-art').src = img;
  document.getElementById('np-track').textContent = track.name;
  document.getElementById('np-artist').textContent = artists;

  // Progress
  const progress = state.progress_ms || 0;
  const duration = track.duration_ms || 1;
  const pct = (progress / duration) * 100;
  document.getElementById('np-progress-fill').style.width = `${pct}%`;
  document.getElementById('np-time-current').textContent = formatTime(progress);
  document.getElementById('np-time-total').textContent = formatTime(duration);

  // Play/Pause icons
  const isPlaying = state.is_playing;
  document.getElementById('np-play-icon').classList.toggle('hidden', isPlaying);
  document.getElementById('np-pause-icon').classList.toggle('hidden', !isPlaying);

  // Device
  const device = state.device?.name || '';
  document.getElementById('np-device').textContent = device ? `Playing on ${device}` : '';
}

function startNowPlaying() {
  // Poll every 3 seconds
  const poll = async () => {
    const state = await fetchPlaybackState();
    updateNowPlaying(state);
  };
  poll();
  nowPlayingInterval = setInterval(poll, 3000);
}

// Playback controls
document.getElementById('np-toggle')?.addEventListener('click', async () => {
  const state = await fetchPlaybackState();
  if (!state) return;
  if (state.is_playing) {
    await spotifyPut('https://api.spotify.com/v1/me/player/pause');
  } else {
    await spotifyPut('https://api.spotify.com/v1/me/player/play');
  }
  // Immediate UI feedback
  setTimeout(async () => updateNowPlaying(await fetchPlaybackState()), 300);
});

document.getElementById('np-prev')?.addEventListener('click', async () => {
  await spotifyPost('https://api.spotify.com/v1/me/player/previous');
  setTimeout(async () => updateNowPlaying(await fetchPlaybackState()), 500);
});

document.getElementById('np-next')?.addEventListener('click', async () => {
  await spotifyPost('https://api.spotify.com/v1/me/player/next');
  setTimeout(async () => updateNowPlaying(await fetchPlaybackState()), 500);
});

// Click on progress bar to seek
document.getElementById('np-progress-bar')?.addEventListener('click', async (e) => {
  const bar = e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const state = await fetchPlaybackState();
  if (!state?.item) return;
  const seekMs = Math.floor(pct * state.item.duration_ms);
  await spotifyPut(`https://api.spotify.com/v1/me/player/seek?position_ms=${seekMs}`);
  setTimeout(async () => updateNowPlaying(await fetchPlaybackState()), 300);
});


// ══════════════════════════════════════════════════════════════
// STATS PAGE
// ══════════════════════════════════════════════════════════════

async function getRecentlyPlayed() {
  const data = await spotifyFetch(
    'https://api.spotify.com/v1/me/player/recently-played?limit=50'
  );
  return data?.items || [];
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function renderDecadeBreakdown(tracks) {
  const decades = {};
  tracks.forEach(t => {
    const year = parseInt(t.album.release_date?.substring(0, 4));
    if (!year) return;
    const decade = Math.floor(year / 10) * 10;
    decades[`${decade}s`] = (decades[`${decade}s`] || 0) + 1;
  });

  const sorted = Object.entries(decades).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  if (sorted.length === 0) {
    document.getElementById('decade-breakdown').innerHTML = '<p style="color:var(--muted);font-size:0.85rem">No data available.</p>';
    return;
  }

  const total = sorted.reduce((s, [, c]) => s + c, 0);
  const max = Math.max(...sorted.map(([, c]) => c));

  document.getElementById('decade-breakdown').innerHTML = `
    <div class="decade-chart">
      ${sorted.map(([decade, count]) => `
        <div class="decade-col">
          <div class="decade-bar-wrap">
            <div class="decade-bar" style="height: ${Math.round((count / max) * 100)}%"></div>
          </div>
          <div class="decade-label">${decade}</div>
          <div class="decade-pct">${Math.round((count / total) * 100)}%</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderTopAlbums(tracks) {
  const albumMap = {};
  tracks.forEach(t => {
    const album = t.album;
    if (!albumMap[album.id]) {
      albumMap[album.id] = {
        name: album.name,
        artist: t.artists.map(a => a.name).join(', '),
        img: album.images[1]?.url || album.images[0]?.url || '',
        count: 0
      };
    }
    albumMap[album.id].count++;
  });

  const sorted = Object.values(albumMap).sort((a, b) => b.count - a.count).slice(0, 5);
  if (sorted.length === 0) {
    document.getElementById('top-albums').innerHTML = '<p style="color:var(--muted);font-size:0.85rem">No data available.</p>';
    return;
  }

  document.getElementById('top-albums').innerHTML = sorted.map((album, i) => `
    <div class="album-item" style="animation-delay:${i * 0.04}s">
      <span class="album-rank">${i + 1}</span>
      <img class="album-img" src="${album.img}" alt="${escapeHtml(album.name)}" loading="lazy"/>
      <div class="album-info">
        <div class="album-name">${escapeHtml(album.name)}</div>
        <div class="album-artist">${escapeHtml(album.artist)}</div>
      </div>
      <span class="album-count">${album.count} track${album.count > 1 ? 's' : ''}</span>
    </div>
  `).join('');
}

async function renderNewReleases(topArtists) {
  const el = document.getElementById('new-releases');
  
  // Get albums from top 15 artists (to limit API calls)
  const artistIds = topArtists.slice(0, 15).map(a => a.id);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3); // last 3 months

  let releases = [];

  try {
    const fetches = artistIds.map(id =>
      spotifyFetch(`https://api.spotify.com/v1/artists/${id}/albums?include_groups=album,single&limit=5&market=from_token`)
    );
    const results = await Promise.all(fetches);

    results.forEach(data => {
      if (!data?.items) return;
      data.items.forEach(album => {
        const releaseDate = new Date(album.release_date);
        if (releaseDate >= cutoff) {
          releases.push({
            name: album.name,
            artist: album.artists.map(a => a.name).join(', '),
            img: album.images[1]?.url || album.images[0]?.url || '',
            date: album.release_date,
            type: album.album_type,
            url: album.external_urls?.spotify || '#',
          });
        }
      });
    });
  } catch (err) {
    console.warn('New releases fetch error:', err);
  }

  // Deduplicate by name+artist and sort by date
  const seen = new Set();
  releases = releases.filter(r => {
    const key = `${r.name}::${r.artist}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);

  if (releases.length === 0) {
    el.innerHTML = '<p style="color:var(--muted);font-size:0.85rem">No new releases from your top artists in the last 3 months.</p>';
    return;
  }

  el.innerHTML = releases.map((r, i) => {
    const dateStr = new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const typeLabel = r.type === 'single' ? 'Single' : 'Album';
    return `
      <a href="${r.url}" target="_blank" rel="noopener" class="release-item" style="animation-delay:${i * 0.04}s">
        <img class="release-img" src="${r.img}" alt="${escapeHtml(r.name)}" loading="lazy"/>
        <div class="release-info">
          <div class="release-name">${escapeHtml(r.name)}</div>
          <div class="release-artist">${escapeHtml(r.artist)}</div>
        </div>
        <div class="release-meta">
          <span class="release-type">${typeLabel}</span>
          <span class="release-date">${dateStr}</span>
        </div>
      </a>
    `;
  }).join('');
}

function renderRecentlyPlayed(items) {
  document.getElementById('recent-list').innerHTML = items.map((item, i) => {
    const track = item.track;
    const img = track.album.images[1]?.url || track.album.images[0]?.url || '';
    const artists = track.artists.map(a => a.name).join(', ');
    return `
      <div class="recent-item" style="animation-delay:${i * 0.02}s">
        <span class="recent-num">${i + 1}</span>
        <img class="recent-img" src="${img}" alt="${escapeHtml(track.name)}" loading="lazy"/>
        <div class="recent-info">
          <div class="recent-name">${escapeHtml(track.name)}</div>
          <div class="recent-artist">${escapeHtml(artists)}</div>
        </div>
        <span class="recent-time">${timeAgo(item.played_at)}</span>
      </div>
    `;
  }).join('');
}

async function loadStatsPage() {
  const loadingMsg = '<p style="color:var(--muted);font-size:0.85rem">Loading...</p>';
  document.getElementById('new-releases').innerHTML = loadingMsg;
  document.getElementById('decade-breakdown').innerHTML = loadingMsg;
  document.getElementById('top-albums').innerHTML = loadingMsg;
  document.getElementById('recent-list').innerHTML = loadingMsg;

  try {
    const [topTracks, topArtists] = await Promise.all([
      getTopTracks('long_term', 50),
      getTopArtists('long_term', 50),
    ]);

    // Cache for share card
    cachedStatsData = { topTracks, topArtists };

    renderDecadeBreakdown(topTracks);
    renderTopAlbums(topTracks);

    // New releases fetches individual artists, so run separately
    renderNewReleases(topArtists);
  } catch (err) {
    console.error('Stats error:', err);
  }

  try {
    const recentItems = await getRecentlyPlayed();
    renderRecentlyPlayed(recentItems);
  } catch (err) {
    document.getElementById('recent-list').innerHTML =
      '<p style="color:var(--muted);font-size:0.85rem">Recently played is unavailable.</p>';
  }
}

// Stats page navigation
document.getElementById('stats-btn')?.addEventListener('click', () => {
  showPage('stats-page');
  loadStatsPage();
});

document.getElementById('back-btn')?.addEventListener('click', () => {
  showPage('main-page');
});


// ══════════════════════════════════════════════════════════════
// SHAREABLE STATS CARD
// ══════════════════════════════════════════════════════════════

async function generateShareCard() {
  if (!cachedStatsData) return;
  const { topTracks, topArtists } = cachedStatsData;

  const canvas = document.getElementById('share-canvas');
  const ctx = canvas.getContext('2d');

  const W = 800;
  const H = 1000;
  canvas.width = W;
  canvas.height = H;

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0d0d0d');
  grad.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Accent glow
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#1db954';
  ctx.beginPath();
  ctx.arc(650, 150, 300, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8ff47';
  ctx.beginPath();
  ctx.arc(150, 800, 250, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Border
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  // Header
  ctx.fillStyle = '#e8ff47';
  ctx.font = '600 14px "DM Sans", sans-serif';
  ctx.fillText('◈ RHYTHMREPORT', 40, 52);

  ctx.fillStyle = '#666';
  ctx.font = '300 12px "DM Sans", sans-serif';
  const date = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  ctx.fillText(date, W - ctx.measureText(date).width - 40, 52);

  // Title
  ctx.fillStyle = '#f0f0f0';
  ctx.font = '48px "Bebas Neue", sans-serif';
  ctx.letterSpacing = '0.06em';
  ctx.fillText('YOUR TOP 5', 40, 110);

  // Top 5 tracks
  const top5 = topTracks.slice(0, 5);
  let y = 150;

  for (let i = 0; i < top5.length; i++) {
    const track = top5[i];
    const imgUrl = track.album.images[1]?.url || track.album.images[0]?.url;

    // Try to load album art
    try {
      const img = await loadImage(imgUrl);
      ctx.save();
      roundedRect(ctx, 40, y, 72, 72, 8);
      ctx.clip();
      ctx.drawImage(img, 40, y, 72, 72);
      ctx.restore();
    } catch {
      ctx.fillStyle = '#1a1a1a';
      roundedRect(ctx, 40, y, 72, 72, 8);
      ctx.fill();
    }

    // Rank
    ctx.fillStyle = '#e8ff47';
    ctx.font = '36px "Bebas Neue", sans-serif';
    ctx.fillText(`#${i + 1}`, 130, y + 36);

    // Track name
    ctx.fillStyle = '#f0f0f0';
    ctx.font = '500 18px "DM Sans", sans-serif';
    const name = truncateText(ctx, track.name, W - 240);
    ctx.fillText(name, 190, y + 30);

    // Artist
    ctx.fillStyle = '#666';
    ctx.font = '300 14px "DM Sans", sans-serif';
    const artist = truncateText(ctx, track.artists.map(a => a.name).join(', '), W - 240);
    ctx.fillText(artist, 190, y + 52);

    y += 90;
  }

  // Divider
  y += 20;
  ctx.strokeStyle = '#222';
  ctx.beginPath();
  ctx.moveTo(40, y);
  ctx.lineTo(W - 40, y);
  ctx.stroke();
  y += 30;

  // Stats summary
  ctx.fillStyle = '#f0f0f0';
  ctx.font = '36px "Bebas Neue", sans-serif';
  ctx.fillText('STATS', 40, y + 10);
  y += 40;

  const uniqueAlbums = new Set(topTracks.map(t => t.album.id)).size;
  const stats = [
    { label: 'Top Artists', value: topArtists.length },
    { label: 'Top Tracks', value: topTracks.length },
    { label: 'Unique Albums', value: uniqueAlbums },
  ];

  const colW = (W - 80) / stats.length;
  stats.forEach((stat, i) => {
    const x = 40 + i * colW;
    ctx.fillStyle = '#e8ff47';
    ctx.font = '56px "Bebas Neue", sans-serif';
    ctx.fillText(stat.value.toString(), x, y + 50);
    ctx.fillStyle = '#666';
    ctx.font = '300 13px "DM Sans", sans-serif';
    ctx.fillText(stat.label, x, y + 72);
  });

  y += 100;

  // Decade breakdown
  const decades = {};
  topTracks.forEach(t => {
    const year = parseInt(t.album.release_date?.substring(0, 4));
    if (!year) return;
    const decade = Math.floor(year / 10) * 10;
    decades[`${decade}s`] = (decades[`${decade}s`] || 0) + 1;
  });

  const sortedDecades = Object.entries(decades).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  if (sortedDecades.length > 0) {
    y += 10;
    ctx.fillStyle = '#f0f0f0';
    ctx.font = '36px "Bebas Neue", sans-serif';
    ctx.fillText('DECADES', 40, y + 10);
    y += 30;

    const maxCount = Math.max(...sortedDecades.map(([, c]) => c));
    const total = sortedDecades.reduce((s, [, c]) => s + c, 0);
    const barAreaW = W - 80;
    const barW = Math.min(80, (barAreaW / sortedDecades.length) - 12);

    sortedDecades.forEach(([label, count], i) => {
      const x = 40 + i * (barW + 12);
      const barH = (count / maxCount) * 100;

      ctx.fillStyle = '#1db954';
      roundedRect(ctx, x, y + (100 - barH), barW, barH, 4);
      ctx.fill();

      ctx.fillStyle = '#666';
      ctx.font = '300 11px "DM Sans", sans-serif';
      ctx.fillText(label, x, y + 118);

      ctx.fillStyle = '#f0f0f0';
      ctx.font = '18px "Bebas Neue", sans-serif';
      ctx.fillText(`${Math.round((count / total) * 100)}%`, x, y + 136);
    });
  }

  // Footer
  ctx.fillStyle = '#333';
  ctx.font = '300 11px "DM Sans", sans-serif';
  ctx.fillText('Generated with RhythmReport', 40, H - 30);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 0 && ctx.measureText(text + '...').width > maxWidth) {
    text = text.slice(0, -1);
  }
  return text + '...';
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Share modal
document.getElementById('share-btn')?.addEventListener('click', async () => {
  const modal = document.getElementById('share-modal');
  modal.classList.remove('hidden');
  await generateShareCard();
});

document.getElementById('share-close')?.addEventListener('click', () => {
  document.getElementById('share-modal').classList.add('hidden');
});

document.querySelector('.share-overlay')?.addEventListener('click', () => {
  document.getElementById('share-modal').classList.add('hidden');
});

document.getElementById('share-download')?.addEventListener('click', () => {
  const canvas = document.getElementById('share-canvas');
  const link = document.createElement('a');
  link.download = 'rhythmreport.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});