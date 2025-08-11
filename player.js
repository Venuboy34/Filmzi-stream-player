/* player.js - Filmzii Universal Player
  Usage:
    - Open index.html
    - Paste a video URL into the input and click Load
    - Or open directly: index.html?src=<encoded-url>
  Notes:
    - By default the player will use the filmzii Worker proxy path: /stream?url=ENCODED
    - If proxy checkbox is off, the player will use the raw URL.
*/

const WORKER_BASE = ''; // when deployed on same domain, keep empty. If worker on another origin e.g. https://filmzii-worker.example.workers.dev, set it here.
const STREAM_ENDPOINT = (pathUrl) => {
  // Worker expects /stream?url=ENCODED_URL
  if (WORKER_BASE) return `${WORKER_BASE}/stream?url=${encodeURIComponent(pathUrl)}`;
  // when running Pages + Worker with same origin, same-origin call is fine:
  return `/stream?url=${encodeURIComponent(pathUrl)}`;
};

const qparams = new URLSearchParams(location.search);
const initialSrc = qparams.get('src');

const player = videojs('filmzii-player', {
  autoplay: false,
  controls: true,
  preload: 'auto',
  fluid: true
});

// DOM refs
const urlField = document.getElementById('urlField');
const loadBtn = document.getElementById('loadBtn');
const useProxy = document.getElementById('useProxy');
const titleBox = document.getElementById('titleBox');
const descBox = document.getElementById('desc');
const qualityMenu = document.getElementById('qualityMenu');
const audioMenu = document.getElementById('audioMenu');
const subMenu = document.getElementById('subMenu');
const downloadBtn = document.getElementById('downloadBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');

// helper
function setTitle(t){ titleBox.textContent = t || 'No media loaded'; }
function setDesc(d){ descBox.textContent = d || ''; }
function makeBtn(label, cb){ const b = document.createElement('button'); b.className='btn'; b.textContent=label; b.addEventListener('click', cb); return b; }

// choose source (applies proxy if asked)
function chooseSrc(rawUrl){
  const actual = useProxy && useProxy.checked ? STREAM_ENDPOINT(rawUrl) : rawUrl;
  return actual;
}

// load logic
let hls = null;
let dashPlayer = null;

async function loadUrl(rawUrl){
  if(!rawUrl) return alert('Please provide a URL');
  setTitle('Loading...');
  setDesc(rawUrl);

  // cleanup previous
  if(hls){ try{ hls.destroy(); } catch(e){} hls = null; }
  if(dashPlayer){ try{ dashPlayer.reset(); } catch(e){} dashPlayer = null; }
  player.pause(); player.reset();

  const src = chooseSrc(rawUrl);

  // detect type
  const lower = rawUrl.split('?')[0].split('#')[0].toLowerCase();
  if(lower.endsWith('.m3u8')){
    // HLS path - use hls.js with worker proxy URL passed as src (so CORS issues solved)
    if(Hls.isSupported()){
      hls = new Hls({ enableWebVTT: true, autoStartLoad: true });
      hls.loadSource(src);
      hls.attachMedia(player.tech_.el_);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setTitle(extractTitleFromUrl(rawUrl));
        setupHlsUI();
        player.play().catch(()=>{});
      });
      hls.on(Hls.Events.ERROR, (evt, data) => {
        console.warn('HLS error', data);
      });
    } else {
      // Safari native
      player.src({ src, type: 'application/vnd.apple.mpegurl' });
      player.ready(()=> setTimeout(setupNativeTextAudioTracks, 800));
    }
  } else if(lower.endsWith('.mpd')){
    // DASH
    player.ready(()=>{
      dashPlayer = dashjs.MediaPlayer().create();
      dashPlayer.initialize(player.tech_.el_, src, false);
      setTitle(extractTitleFromUrl(rawUrl));
      // text/audio track handling depends on dash.js events
      player.play().catch(()=>{});
    });
  } else {
    // direct file (mp4, mkv, webm). Browsers don't support mkv widely; mp4 will work.
    player.src({ src, type: guessMimeType(lower) });
    setTitle(extractTitleFromUrl(rawUrl));
    // no manifest = limited metadata for audio/subtitles; but we can still offer Download and fallback
    setupFallbackUI(rawUrl);
    player.play().catch(()=>{});
  }
}

// UI helpers for tracks / qualities

function clearMenus(){
  qualityMenu.innerHTML=''; audioMenu.innerHTML=''; subMenu.innerHTML='';
}

function setupHlsUI(){
  clearMenus();
  // populate quality list using levels
  const levels = hls.levels || [];
  const uniqueLevels = Array.from(new Set(levels.map(l => l.height || l.bitrate))).slice().reverse();
  if(uniqueLevels.length){
    qualityMenu.appendChild(makeBtn('Auto', ()=> { if(hls) hls.currentLevel = -1; }));
    uniqueLevels.forEach((val, idx)=>{
      qualityMenu.appendChild(makeBtn(val + 'p', ()=> {
        if(hls){
          // choose first level that matches height
          const lvlIndex = hls.levels.findIndex(l => (l.height || l.bitrate) === val);
          if(lvlIndex >= 0) hls.currentLevel = lvlIndex;
        }
      }));
    });
  }

  // audio tracks
  const auds = hls.audioTracks || [];
  if(auds.length){
    audioMenu.appendChild(makeBtn('Track', ()=>{})); // label
    auds.forEach((a, i)=>{
      audioMenu.appendChild(makeBtn(a.name || a.lang || `Audio ${i+1}`, ()=> {
        if(hls) hls.audioTrack = i;
      }));
    });
  }

  // subtitles
  const subs = hls.subtitleTracks || [];
  if(subs.length){
    subMenu.appendChild(makeBtn('Off', ()=> { if(hls) hls.subtitleTrack = -1; }));
    subs.forEach((s, i)=>{
      subMenu.appendChild(makeBtn(s.name || s.lang || `Sub ${i+1}`, ()=> {
        if(hls) hls.subtitleTrack = i;
      }));
    });
  }

  // Download button - link to proxied stream or raw if proxy off
  setDownloadForCurrentSrc();

  // listen for adding tracks update
  hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, setupHlsUI);
  hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, setupHlsUI);
  hls.on(Hls.Events.LEVELS_UPDATED, setupHlsUI);
}

function setupNativeTextAudioTracks(){
  clearMenus();
  // native textTracks
  const vt = player.tech_.el_.textTracks || [];
  if(vt.length){
    subMenu.appendChild(makeBtn('Off', ()=>{ for(let t of vt) t.mode='disabled'; }));
    for(let i=0;i<vt.length;i++){
      const t = vt[i];
      subMenu.appendChild(makeBtn(t.label || t.language || `Sub ${i+1}`, ()=> {
        for(let x=0;x<vt.length;x++){ vt[x].mode='disabled'; }
        t.mode = 'showing';
      }));
    }
  }
  // audio tracks (non-standard in many browsers)
  if(player.tech_.el_.audioTracks){
    const at = player.tech_.el_.audioTracks;
    for(let i=0;i<at.length;i++){
      const a = at[i];
      audioMenu.appendChild(makeBtn(a.label||a.language||`Audio ${i+1}`, ()=> {
        // not widely supported to switch via JS
        try{ at.selectedIndex = i; }catch(e){ console.warn('audioTracks select not supported'); }
      }));
    }
  }

  setDownloadForCurrentSrc();
}

function setupFallbackUI(rawUrl){
  clearMenus();
  // no separate audio/subtitle info available
  audioMenu.appendChild(makeBtn('Audio: N/A', ()=>{}));
  subMenu.appendChild(makeBtn('Subs: N/A', ()=>{}));
  setDownloadForCurrentSrc();
}

function setDownloadForCurrentSrc(){
  // Choose displayed download target depending on proxy checkbox
  const currentSrc = player.currentSrc() || '';
  if(!currentSrc) {
    downloadBtn.href = '#'; downloadBtn.removeAttribute('download'); downloadBtn.title = '';
  } else {
    // If proxied URL (contains /stream?url=...), we can show raw link too - but keep proxied so user can download via domain
    downloadBtn.href = currentSrc;
    downloadBtn.setAttribute('download','');
    downloadBtn.title = 'Right-click -> Save as to download';
  }
}

// tiny utilities
function extractTitleFromUrl(u){
  try{
    const p = new URL(u);
    const parts = p.pathname.split('/').filter(Boolean);
    return parts.length ? decodeURIComponent(parts[parts.length-1]) : u;
  }catch(e){ return u; }
}

function guessMimeType(lower){
  if(lower.endsWith('.mp4')) return 'video/mp4';
  if(lower.endsWith('.webm')) return 'video/webm';
  if(lower.endsWith('.ogg') || lower.endsWith('.ogv')) return 'video/ogg';
  // mkv not widely supported in browsers
  return 'video/mp4';
}

// Attach UI events
loadBtn.addEventListener('click', ()=> {
  const v = urlField.value.trim();
  if(!v) return alert('Paste URL first');
  loadUrl(v);
});

urlField.addEventListener('keyup', (e)=>{ if(e.key === 'Enter') loadBtn.click(); });

fullscreenBtn.addEventListener('click', ()=> {
  const el = document.querySelector('.player-wrap');
  if (!document.fullscreenElement) el.requestFullscreen().catch(()=>{});
  else document.exitFullscreen().catch(()=>{});
});

// auto-load if ?src param present
if(initialSrc){
  urlField.value = initialSrc;
  loadUrl(initialSrc);
}

// keep download link synced
player.on('loadstart', setDownloadForCurrentSrc);
player.on('loadedmetadata', setDownloadForCurrentSrc);
player.on('srcreset', setDownloadForCurrentSrc);
