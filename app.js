(() => {
  'use strict';

  const STORAGE = {
    host: 'fsr.remote.host',
    username: 'fsr.remote.username',
    password: 'fsr.remote.password',
    rememberPassword: 'fsr.remote.rememberPassword'
  };

  const state = {
    ws: null,
    connected: false,
    connecting: false,
    demo: false,
    manualDisconnect: false,
    reconnectTimer: null,
    host: localStorage.getItem(STORAGE.host) || '',
    username: localStorage.getItem(STORAGE.username) || '',
    password: localStorage.getItem(STORAGE.password) || '',
    rememberPassword: localStorage.getItem(STORAGE.rememberPassword) === '1',
    song: null,
    status: 'stopped',
    position: 0,
    positionUpdatedAt: 0,
    volume: 70,
    shuffle: false,
    repeat: 'none',
    favorite: false,
    demoIndex: 0
  };

  const demoTracks = [
    { id:'demo-1', name:'Midnight Drive', artistName:'Demo Artist', album:'Night Signals', releaseYear:2025, duration:224, imageUrl:'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=85' },
    { id:'demo-2', name:'Neon Rain', artistName:'Demo Artist', album:'Night Signals', releaseYear:2025, duration:198, imageUrl:'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=900&q=85' },
    { id:'demo-3', name:'Afterglow', artistName:'Neon Bloom', album:'Orbit', releaseYear:2024, duration:241, imageUrl:'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=900&q=85' }
  ];

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (v) => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(total / 60);
    const secs = String(total % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function normalizeWs(value) {
    let v = String(value || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) v = v.replace(/^http/i, 'ws');
    if (!/^wss?:\/\//i.test(v)) v = `ws://${v}`;
    return v.replace(/\/+$/, '');
  }

  function authHeader() {
    const raw = `${state.username}:${state.password}`;
    return state.username || state.password ? `Basic ${btoa(unescape(encodeURIComponent(raw)))}` : '';
  }

  function toast(message, timeout = 2400) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    $('toast-root').appendChild(el);
    window.setTimeout(() => el.remove(), timeout);
  }

  function send(message) {
    if (state.demo) {
      demoCommand(message);
      return true;
    }
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.connected) {
      toast('Sin conexión con Feishin');
      return false;
    }
    state.ws.send(JSON.stringify(message));
    return true;
  }

  function setConnection(_status) {}

  function disconnect(silent = true) {
    state.manualDisconnect = true;
    clearTimeout(state.reconnectTimer);
    if (state.ws) {
      try { state.ws.close(); } catch {}
    }
    state.ws = null;
    state.connected = false;
    state.connecting = false;
    setConnection('disconnected');
    if (!silent) toast('Desconectado');
  }

  function scheduleReconnect() {
    clearTimeout(state.reconnectTimer);
    if (!state.host || state.manualDisconnect || state.demo) return;
    state.reconnectTimer = setTimeout(() => connect(), 3000);
  }

  function connect() {
    const url = normalizeWs(state.host);
    if (!url) { openSettings(); toast('Escribe la dirección de Feishin Remote'); return; }

    disconnect(true);
    state.demo = false;
    state.manualDisconnect = false;
    state.connecting = true;
    setConnection('connecting');

    try {
      const ws = new WebSocket(url);
      state.ws = ws;
      ws.addEventListener('open', () => {
        state.connecting = false;
        state.connected = true;
        setConnection('connected');
        if (state.username || state.password) ws.send(JSON.stringify({ event:'authenticate', header: authHeader() }));
        toast('Conectado');
      });
      ws.addEventListener('message', (event) => {
        try { handleMessage(JSON.parse(event.data)); }
        catch { toast('Respuesta inválida de Feishin'); }
      });
      ws.addEventListener('close', () => {
        const shouldReconnect = !state.manualDisconnect;
        state.connected = false;
        state.connecting = false;
        setConnection('disconnected');
        if (shouldReconnect) scheduleReconnect();
      });
      ws.addEventListener('error', () => {
        state.connected = false;
        setConnection('disconnected');
      });
    } catch (error) {
      state.connecting = false;
      setConnection('disconnected');
      toast(`No se pudo conectar: ${error.message}`);
    }
  }

  function handleMessage(message) {
    const event = message?.event;
    const data = message?.data;

    switch (event) {
      case 'state':
        state.position = normalizePosition(data?.position ?? 0);
        state.positionUpdatedAt = performance.now();
        state.repeat = data?.repeat ?? state.repeat;
        state.shuffle = !!data?.shuffle;
        state.song = data?.song ?? null;
        state.status = data?.status ?? 'stopped';
        state.volume = Number(data?.volume ?? state.volume);
        syncSongExtras();
        break;
      case 'song':
        state.song = data || null;
        state.position = 0;
        state.positionUpdatedAt = performance.now();
        syncSongExtras();
        break;
      case 'playback':
        state.status = data;
        state.positionUpdatedAt = performance.now();
        break;
      case 'position':
        setRemotePosition(data || 0);
        break;
      case 'volume': state.volume = Number(data || 0); break;
      case 'shuffle': state.shuffle = !!data; break;
      case 'repeat': state.repeat = data; break;
      case 'favorite':
        if (!state.song || !data || String(data.id) === String(state.song.id)) state.favorite = !!data?.favorite;
        break;
      case 'proxy':
        if (state.song && data) state.song = { ...state.song, imageUrl: `data:image/jpeg;base64,${data}` };
        break;
      case 'error': toast(String(data || 'Feishin devolvió un error')); break;
      case 'operation-ack': if (data?.error) toast(String(data.error)); break;
      default: break;
    }
    state.connected = true;
    setConnection('connected');
    render();
  }

  function syncSongExtras() {
    const song = state.song || {};
    state.favorite = !!(song.userFavorite ?? song.favorite ?? false);
  }

  function parseDuration(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'string') {
      const text = value.trim();
      if (/^\d+(?:\.\d+)?$/.test(text)) value = Number(text);
      else {
        const parts = text.split(':').map(Number);
        if (parts.every(Number.isFinite) && parts.length >= 2 && parts.length <= 3) {
          let total = 0;
          for (const part of parts) total = total * 60 + part;
          return Math.max(0, total);
        }
        return 0;
      }
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;

    if (numeric >= 10000 && Number.isFinite(state.position) && state.position < numeric) {
      return numeric / 1000;
    }
    return numeric;
  }

  function normalizePosition(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    const duration = parseDuration(state.song?.duration);
    if (duration > 0 && numeric > duration * 20 && numeric > 10000) return numeric / 1000;
    return numeric;
  }

  function setRemotePosition(value) {
    state.position = normalizePosition(value);
    state.positionUpdatedAt = performance.now();
  }

  function displayPosition() {
    let position = state.position;
    if (state.status === 'playing' && state.positionUpdatedAt) {
      position += Math.max(0, (performance.now() - state.positionUpdatedAt) / 1000);
    }
    return Math.max(0, position);
  }

  function icon(name) {
    const icons = {
      play: '<path d=\"m9 6 10 6-10 6Z\"/>',
      pause: '<path d=\"M8 5h3v14H8zm5 0h3v14h-3z\"/>',
      volume0: '<path d=\"M4 10v4h4l5 4V6L8 10H4Z\"/><path d=\"m17 9 4 6m0-6-4 6\"/>',
      volume: '<path d=\"M4 10v4h4l5 4V6L8 10H4Z\"/><path d=\"M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10\"/>'
    };
    return `<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">${icons[name] || ''}</svg>`;
  }

  function currentAlbum() {
    const song = state.song;
    const album = song?.album;
    if (album && typeof album === 'object') return album.name || album.title || '—';
    return album || song?.albumName || song?.albumTitle || '—';
  }

  function currentYear() {
    const song = state.song || {};
    const candidates = [
      song.releaseYear,
      song.albumReleaseYear,
      song.year,
      typeof song.album === 'object' ? song.album.releaseYear : null,
      typeof song.album === 'object' ? song.album.year : null
    ];
    const year = candidates.find((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (year === undefined) return '—';
    const match = String(year).match(/\d{4}/);
    return match ? match[0] : String(year);
  }

  function currentImage() {
    let url = state.song?.imageUrl || state.song?.artworkUrl || state.song?.coverUrl || '';
    
    // Verificamos que tengamos una URL válida y que no sea una imagen en base64 (data:image...)
    if (url && typeof url === 'string' && !url.startsWith('data:')) {
      // 1. Reemplazamos el parámetro 'size' (típico en Navidrome/Subsonic) si ya existe
      if (/size=\d+/i.test(url)) {
        url = url.replace(/size=\d+/ig, 'size=800');
      } else {
        // Si no existe, lo agregamos al final
        url += (url.includes('?') ? '&' : '?') + 'size=800';
      }

      // 2. Opcional: Reemplazamos parámetros de Jellyfin/Emby por si ese es tu backend
      if (/maxHeight=\d+/i.test(url)) url = url.replace(/maxHeight=\d+/ig, 'maxHeight=800');
      if (/maxWidth=\d+/i.test(url)) url = url.replace(/maxWidth=\d+/ig, 'maxWidth=800');
      if (/FillHeight=\d+/i.test(url)) url = url.replace(/FillHeight=\d+/ig, 'FillHeight=800');
      if (/FillWidth=\d+/i.test(url)) url = url.replace(/FillWidth=\d+/ig, 'FillWidth=800');
    }

    return url;
  }

  function applyAmbient(url) {
    const ambient = $('ambient');
    const art = $('album-art');
    if (url) {
      ambient.style.backgroundImage = `url("${url.replaceAll('"','%22')}")`;
    } else {
      ambient.style.backgroundImage = '';
    }
    if (url !== art.dataset.url) {
      art.dataset.url = url || '';
      if (url) {
        art.src = url;
        art.classList.add('show');
        $('album-placeholder').classList.add('hidden');
        art.onerror = () => {
          art.classList.remove('show');
          $('album-placeholder').classList.remove('hidden');
        };
      } else {
        art.removeAttribute('src');
        art.classList.remove('show');
        $('album-placeholder').classList.remove('hidden');
      }
    }
  }

  function render() {
    const song = state.song;
    $('track-name').textContent = song?.name || 'Nada reproduciéndose';
    $('artist-name').textContent = song?.artistName || song?.artist || (state.demo ? 'Demo Artist' : 'Conecta Feishin Remote');
    $('album-name').textContent = currentAlbum();
    $('release-year').textContent = currentYear();

    const image = currentImage();
    applyAmbient(image);

    const isPlaying = state.status === 'playing';
    $('play-svg').innerHTML = isPlaying ? icon('pause').replace('<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">','').replace('</svg>','') : icon('play').replace('<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">','').replace('</svg>','');
    $('favorite-btn').classList.toggle('active', state.favorite);
    $('favorite-btn').querySelector('svg').innerHTML = state.favorite ? '<path d=\"M20.8 8.7c0 5.4-8.8 10.2-8.8 10.2S3.2 14.1 3.2 8.7A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.8 2.2Z\" fill=\"currentColor\" stroke=\"none\"/>' : '<path d=\"M20.8 8.7c0 5.4-8.8 10.2-8.8 10.2S3.2 14.1 3.2 8.7A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.8 2.2Z\"/>';

    $('shuffle-btn').classList.toggle('active', state.shuffle);
    $('repeat-btn').classList.toggle('active', state.repeat !== 'none');
    $('repeat-badge').textContent = state.repeat === 'one' ? '1' : '';

    const duration = parseDuration(song?.duration);
    const position = Math.max(0, Math.min(duration || 0, displayPosition()));
    const progress = duration ? Math.round(position / duration * 1000) : 0;
    $('progress').value = String(progress);
    $('progress').style.setProperty('--pct', `${progress / 10}%`);
    $('current-time').textContent = formatTime(position);
    $('total-time').textContent = formatTime(duration);
    $('volume').value = String(state.volume);
    $('volume').style.setProperty('--pct', `${state.volume}%`);
    $('volume-icon').innerHTML = state.volume <= 0 ? icon('volume0') : icon('volume');
  }

  function playerEvent(event) {
    send({ event });
  }

  function toggleFavorite() {
    if (!state.song?.id) return;
    const next = !state.favorite;
    state.favorite = next;
    render();
    send({ event:'favorite', id:state.song.id, favorite:next });
  }

  function setPositionFromInput(value) {
    const duration = parseDuration(state.song?.duration);
    if (!duration) return;
    const position = (Number(value) / 1000) * duration;
    state.position = position;
    state.positionUpdatedAt = performance.now();
    render();
    send({ event:'position', position });
  }

  function setVolume(value) {
    state.volume = Math.max(0, Math.min(100, Number(value)));
    render();
    send({ event:'volume', volume:state.volume });
  }

  function openSettings() {
    $('host-input').value = state.host;
    $('username-input').value = state.username;
    $('password-input').value = state.rememberPassword ? state.password : '';
    $('remember-password').checked = state.rememberPassword;
    $('settings-backdrop').classList.remove('hidden');
    $('settings-panel').classList.remove('hidden');
  }

  function closeSettings() {
    $('settings-backdrop').classList.add('hidden');
    $('settings-panel').classList.add('hidden');
  }

  function saveAndConnect(event) {
    event.preventDefault();
    state.host = $('host-input').value.trim();
    state.username = $('username-input').value.trim();
    state.password = $('password-input').value;
    state.rememberPassword = $('remember-password').checked;
    localStorage.setItem(STORAGE.host, state.host);
    localStorage.setItem(STORAGE.username, state.username);
    localStorage.setItem(STORAGE.rememberPassword, state.rememberPassword ? '1' : '0');
    if (state.rememberPassword) localStorage.setItem(STORAGE.password, state.password);
    else localStorage.removeItem(STORAGE.password);
    closeSettings();
    connect();
  }

  function startDemo() {
    disconnect(true);
    state.demo = true;
    state.connected = true;
    state.host = 'demo://local';
    state.demoIndex = 0;
    state.song = { ...demoTracks[0] };
    state.position = 88;
    state.positionUpdatedAt = performance.now();
    state.status = 'playing';
    state.volume = 72;
    state.shuffle = false;
    state.repeat = 'none';
    state.favorite = false;
    setConnection('demo');
    closeSettings();
    render();
    toast('Demo activada');
  }

  function demoCommand(message) {
    switch (message.event) {
      case 'play': state.status = 'playing'; break;
      case 'pause': state.status = 'paused'; break;
      case 'previous':
        state.demoIndex = (state.demoIndex - 1 + demoTracks.length) % demoTracks.length;
        state.song = { ...demoTracks[state.demoIndex] }; state.position = 0; state.positionUpdatedAt = performance.now(); state.status = 'playing'; state.favorite = false; break;
      case 'next':
        state.demoIndex = (state.demoIndex + 1) % demoTracks.length;
        state.song = { ...demoTracks[state.demoIndex] }; state.position = 0; state.positionUpdatedAt = performance.now(); state.status = 'playing'; state.favorite = false; break;
      case 'shuffle': state.shuffle = !state.shuffle; break;
      case 'repeat': state.repeat = state.repeat === 'none' ? 'all' : state.repeat === 'all' ? 'one' : 'none'; break;
      case 'favorite': state.favorite = !!message.favorite; break;
      case 'position': setRemotePosition(message.position || 0); break;
      case 'volume': state.volume = Number(message.volume || 0); break;
      default: break;
    }
    render();
  }

  function bind() {
    $('settings-btn').addEventListener('click', openSettings);
    $('close-settings').addEventListener('click', closeSettings);
    $('settings-backdrop').addEventListener('click', closeSettings);
    $('settings-form').addEventListener('submit', saveAndConnect);
    $('demo-btn').addEventListener('click', startDemo);

    $('play-btn').addEventListener('click', () => { state.positionUpdatedAt = performance.now(); playerEvent(state.status === 'playing' ? 'pause' : 'play'); });
    $('prev-btn').addEventListener('click', () => playerEvent('previous'));
    $('next-btn').addEventListener('click', () => playerEvent('next'));
    $('shuffle-btn').addEventListener('click', () => playerEvent('shuffle'));
    $('repeat-btn').addEventListener('click', () => playerEvent('repeat'));
    $('favorite-btn').addEventListener('click', toggleFavorite);
    $('progress').addEventListener('input', (event) => setPositionFromInput(event.target.value));
    $('volume').addEventListener('input', (event) => setVolume(event.target.value));
  }

  function tick() {
    if (!state.song) return;
    render();
  }

  bind();
  setConnection('disconnected');
  render();
  if (state.host && state.host !== 'demo://local') connect();
  setInterval(tick, 250);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();