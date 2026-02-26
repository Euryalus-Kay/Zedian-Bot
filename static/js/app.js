/* ═══════════════════════════════════════════════════════════════════════════
   Viral Reddit Story Bot - Frontend Application
   ═══════════════════════════════════════════════════════════════════════════ */

const API = '';
let currentStories = [];
let selectedStory = null;
let currentScript = null;
let lastGeneratedResult = null;
let libraryFilter = 'all';

// ─── Initialization ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  checkServices();
  loadVoices();
  loadBackgrounds();
});

// ─── Navigation ──────────────────────────────────────────────────────────────

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${pageId}`);
  const nav = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if (page) page.classList.add('active');
  if (nav) nav.classList.add('active');

  // Load page-specific data
  if (pageId === 'library') loadLibrary();
  if (pageId === 'backgrounds') loadBackgrounds();
  if (pageId === 'youtube') checkYouTubeStatus();

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  return res.json();
}

async function apiPost(path, data = {}) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`${API}${path}`, { method: 'DELETE' });
  return res.json();
}

// ─── Services Check ──────────────────────────────────────────────────────────

async function checkServices() {
  try {
    const settings = await apiGet('/api/settings');
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');

    const reddit = settings.reddit_configured;
    const claude = settings.claude_configured;
    const youtube = settings.youtube_authenticated;

    // Status badges
    setBadge('badgeReddit', reddit ? 'Connected' : 'Not Configured', reddit ? 'success' : 'warning');
    setBadge('badgeClaude', claude ? 'Connected' : 'Not Configured', claude ? 'success' : 'warning');
    setBadge('badgeYouTube', youtube ? 'Connected' : 'Not Connected', youtube ? 'success' : 'danger');

    // Overall status
    const allGood = reddit && claude;
    if (allGood) {
      dot.className = 'status-dot connected';
      text.textContent = 'All services connected';
    } else if (reddit || claude) {
      dot.className = 'status-dot partial';
      text.textContent = 'Some services need setup';
    } else {
      dot.className = 'status-dot';
      text.textContent = 'Services need configuration';
    }
  } catch (e) {
    console.error('Failed to check services:', e);
  }
}

function setBadge(id, text, type) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    el.className = `badge badge-${type}`;
  }
}

// ─── Story Discovery ─────────────────────────────────────────────────────────

async function scrapeStories() {
  const btn = document.getElementById('btnScrape');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner spinner-sm"></div> Scraping...';

  try {
    const sort = document.getElementById('scrapeSort').value;
    const time_filter = document.getElementById('scrapeTime').value;
    const limit = parseInt(document.getElementById('scrapeLimit').value);

    const data = await apiPost('/api/scrape', { sort, time_filter, limit });

    if (data.status === 'ok') {
      currentStories = data.stories;
      renderStories(currentStories);
      toast(`Found ${data.count} stories!`, 'success');
      document.getElementById('btnRank').disabled = false;
    } else {
      toast('Failed to scrape stories. Check Reddit API config.', 'error');
    }
  } catch (e) {
    toast('Error scraping stories: ' + e.message, 'error');
  }

  btn.disabled = false;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Scrape Stories';
}

async function loadCachedStories() {
  try {
    const data = await apiGet('/api/stories/cached');
    if (data.stories && data.stories.length > 0) {
      currentStories = data.stories;
      renderStories(currentStories);
      toast(`Loaded ${data.count} cached stories`, 'info');
      document.getElementById('btnRank').disabled = false;
    } else {
      toast('No cached stories found.', 'info');
    }
  } catch (e) {
    toast('Failed to load cached stories.', 'error');
  }
}

async function rankStories() {
  const btn = document.getElementById('btnRank');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner spinner-sm"></div> AI Ranking...';

  try {
    const data = await apiPost('/api/stories/rank', {
      stories: currentStories,
      top_n: 15,
    });

    if (data.status === 'ok') {
      currentStories = data.stories;
      renderStories(currentStories, true);
      toast(`Top ${data.count} stories ranked by viral potential!`, 'success');
    }
  } catch (e) {
    toast('Ranking failed: ' + e.message, 'error');
  }

  btn.disabled = false;
  btn.innerHTML = 'AI Rank Stories';
}

function renderStories(stories, ranked = false) {
  const container = document.getElementById('storyList');
  const countEl = document.getElementById('storyCount');
  countEl.textContent = `${stories.length} stories loaded`;

  if (stories.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No stories found</h3>
        <p>Try adjusting your search filters or check your Reddit API configuration.</p>
      </div>`;
    return;
  }

  container.innerHTML = stories.map((story, i) => `
    <div class="story-card ${selectedStory && selectedStory.id === story.id ? 'selected' : ''}"
         onclick="selectStory(${i})">
      ${ranked && story.viral_score ? `<div class="viral-badge">${story.viral_score}/100</div>` : ''}
      <div class="story-title">${escapeHtml(story.title)}</div>
      <div class="story-meta">
        <span class="subreddit-tag">r/${story.subreddit}</span>
        <span>${formatNumber(story.score)} upvotes</span>
        <span>${formatNumber(story.num_comments)} comments</span>
        ${story.estimated_duration ? `<span>~${story.estimated_duration}s</span>` : ''}
      </div>
      ${story.viral_reason ? `<div class="story-preview" style="color:var(--viral);font-weight:500;">${escapeHtml(story.viral_reason)}</div>` : ''}
      <div class="story-preview">${escapeHtml(story.selftext.substring(0, 200))}...</div>
    </div>
  `).join('');
}

function selectStory(index) {
  selectedStory = currentStories[index];
  document.querySelectorAll('.story-card').forEach((c, i) => {
    c.classList.toggle('selected', i === index);
  });

  // Update create page
  document.getElementById('selectedStoryPreview').innerHTML = `
    <div>
      <strong>${escapeHtml(selectedStory.title)}</strong>
      <span class="subreddit-tag" style="margin-left:8px;">r/${selectedStory.subreddit}</span>
    </div>`;
  document.getElementById('btnGenScript').disabled = false;

  if (selectedStory.hook) {
    document.getElementById('videoTitle').value = selectedStory.hook;
  }

  toast('Story selected! Go to Create to generate a video.', 'info');
}

// ─── Script Generation ───────────────────────────────────────────────────────

async function generateScript() {
  if (!selectedStory) return;

  const btn = document.getElementById('btnGenScript');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner spinner-sm"></div> Generating...';

  try {
    const data = await apiPost('/api/stories/script', selectedStory);
    if (data.status === 'ok') {
      currentScript = data.script;
      document.getElementById('scriptText').value = data.script.script;
      if (data.script.title) {
        document.getElementById('videoTitle').value = data.script.title;
      }
      if (data.script.tags) {
        document.getElementById('videoTags').value = data.script.tags.join(', ');
      }
      toast('Script generated!', 'success');
    }
  } catch (e) {
    toast('Script generation failed: ' + e.message, 'error');
  }

  btn.disabled = false;
  btn.innerHTML = 'Generate Script with AI';
}

// ─── Video Generation ────────────────────────────────────────────────────────

async function generateVideo() {
  const scriptText = document.getElementById('scriptText').value.trim();
  if (!scriptText && !selectedStory) {
    toast('Please select a story or write a script first.', 'error');
    return;
  }

  const btn = document.getElementById('btnGenerate');
  btn.disabled = true;

  const voice = document.getElementById('voiceSelect').value;
  const bgFile = document.getElementById('bgSelect').value;
  const title = document.getElementById('videoTitle').value;
  const tagsStr = document.getElementById('videoTags').value;
  const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()) : [];

  const payload = {
    story: selectedStory || null,
    script: scriptText || null,
    voice: voice || null,
    background_file: bgFile || null,
    title,
    tags,
  };

  try {
    const data = await apiPost('/api/generate', payload);
    if (data.status === 'ok') {
      document.getElementById('genProgress').classList.remove('hidden');
      document.getElementById('genResult').classList.add('hidden');
      pollJobStatus(data.job_id, onVideoComplete);
    } else {
      toast(data.message || 'Failed to start generation.', 'error');
      btn.disabled = false;
    }
  } catch (e) {
    toast('Error: ' + e.message, 'error');
    btn.disabled = false;
  }
}

function onVideoComplete(job) {
  const btn = document.getElementById('btnGenerate');
  btn.disabled = false;

  document.getElementById('genProgress').classList.add('hidden');

  if (job.status === 'complete' && job.result) {
    lastGeneratedResult = job.result;
    const result = job.result;

    document.getElementById('genResult').classList.remove('hidden');
    document.getElementById('previewVideo').src = `/api/output/${getFilename(result.video)}`;
    document.getElementById('resultDuration').textContent = `${result.duration.toFixed(1)}s`;
    document.getElementById('resultTitle').textContent = result.title || 'Untitled';
    document.getElementById('resultFile').textContent = getFilename(result.video);

    toast('Video generated successfully!', 'success');
  } else {
    toast(job.message || 'Video generation failed.', 'error');
  }
}

function downloadResult(type) {
  if (!lastGeneratedResult) return;
  let file;
  if (type === 'video') file = lastGeneratedResult.video;
  else if (type === 'audio') file = lastGeneratedResult.audio_only;
  else if (type === 'video_no_audio') file = lastGeneratedResult.video_no_audio;
  if (file) {
    window.open(`/api/output/${getFilename(file)}`, '_blank');
  }
}

// ─── Job Polling ─────────────────────────────────────────────────────────────

function pollJobStatus(jobId, onComplete) {
  const interval = setInterval(async () => {
    try {
      const job = await apiGet(`/api/jobs/${jobId}`);

      if (job.status === 'processing') {
        const fill = document.getElementById('genProgressFill');
        const step = document.getElementById('genProgressStep');
        const pct = document.getElementById('genProgressPercent');
        if (fill) fill.style.width = `${job.progress || 0}%`;
        if (step) step.textContent = job.step || 'Processing...';
        if (pct) pct.textContent = `${job.progress || 0}%`;
      } else {
        clearInterval(interval);
        onComplete(job);
      }
    } catch (e) {
      clearInterval(interval);
      onComplete({ status: 'error', message: e.message });
    }
  }, 1500);
}

// ─── Voices ──────────────────────────────────────────────────────────────────

async function loadVoices() {
  try {
    const data = await apiGet('/api/tts/voices');
    const select = document.getElementById('voiceSelect');
    select.innerHTML = '';
    for (const [key, name] of Object.entries(data.voices)) {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${label} (${name})`;
      select.appendChild(opt);
    }
  } catch (e) {
    console.error('Failed to load voices:', e);
  }
}

// ─── Backgrounds ─────────────────────────────────────────────────────────────

async function loadBackgrounds() {
  try {
    const data = await apiGet('/api/backgrounds');
    const bgGrid = document.getElementById('bgList');
    const bgSelect = document.getElementById('bgSelect');

    // Update select dropdown
    bgSelect.innerHTML = '<option value="">Random</option>';
    for (const bg of data.backgrounds || []) {
      const opt = document.createElement('option');
      opt.value = bg.filename;
      opt.textContent = `${bg.filename} (${bg.size_mb}MB)`;
      bgSelect.appendChild(opt);
    }

    // Update grid
    if (!data.backgrounds || data.backgrounds.length === 0) {
      bgGrid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <h3>No background videos</h3>
          <p>Download some gameplay footage above to get started.</p>
        </div>`;
      return;
    }

    bgGrid.innerHTML = data.backgrounds.map(bg => `
      <div class="bg-card">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="margin-bottom:8px"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="m10 8 6 4-6 4z"/></svg>
        <div class="filename">${bg.filename}</div>
        <div class="size">${bg.size_mb} MB - ${bg.type}</div>
        <button class="btn btn-danger btn-sm mt-8" onclick="deleteBgVideo('${bg.filename}')">Delete</button>
      </div>
    `).join('');
  } catch (e) {
    console.error('Failed to load backgrounds:', e);
  }
}

async function downloadBgVideo() {
  const btn = document.getElementById('btnDownloadBg');
  btn.disabled = true;
  btn.textContent = 'Downloading...';

  const bgType = document.getElementById('bgType').value;
  const bgUrl = document.getElementById('bgUrl').value.trim();

  try {
    const data = await apiPost('/api/backgrounds/download', {
      type: bgType,
      url: bgUrl || null,
    });

    if (data.status === 'ok') {
      toast('Download started in background...', 'info');
      // Poll for completion
      pollJobStatus(data.job_id, (job) => {
        if (job.status === 'complete') {
          toast('Background video downloaded!', 'success');
          loadBackgrounds();
        } else {
          toast(job.message || 'Download failed.', 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Download';
      });
    }
  } catch (e) {
    toast('Download failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Download';
  }
}

async function deleteBgVideo(filename) {
  if (!confirm(`Delete ${filename}?`)) return;
  try {
    await apiDelete(`/api/backgrounds/${filename}`);
    toast('Background video deleted.', 'info');
    loadBackgrounds();
  } catch (e) {
    toast('Delete failed.', 'error');
  }
}

// ─── Library ─────────────────────────────────────────────────────────────────

async function loadLibrary() {
  try {
    const data = await apiGet('/api/output');
    renderLibrary(data.files || []);
  } catch (e) {
    console.error('Failed to load library:', e);
  }
}

function filterLibrary(type, tabEl) {
  libraryFilter = type;
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  loadLibrary();
}

function renderLibrary(files) {
  const container = document.getElementById('libraryList');

  const filtered = libraryFilter === 'all'
    ? files
    : files.filter(f => f.type === libraryFilter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No files found</h3>
        <p>Generate a video to see it here.</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(f => `
    <div class="card" style="padding:16px;">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-12">
          <div style="width:40px;height:40px;background:var(--bg-input);border-radius:8px;display:flex;align-items:center;justify-content:center;">
            ${getFileIcon(f.type)}
          </div>
          <div>
            <div style="font-size:14px;font-weight:600;">${f.filename}</div>
            <div class="text-sm text-muted">${f.size_mb} MB - ${new Date(f.created).toLocaleDateString()}</div>
          </div>
        </div>
        <div class="flex gap-8">
          ${f.type === 'video' ? `<button class="btn btn-ghost btn-sm" onclick="previewFile('${f.filename}', '${f.type}')">Preview</button>` : ''}
          <a href="/api/output/${f.filename}" target="_blank" class="btn btn-ghost btn-sm">Download</a>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteFile('${f.filename}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function getFileIcon(type) {
  const icons = {
    video: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="m10 8 6 4-6 4z"/></svg>',
    audio: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    image: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  };
  return icons[type] || '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
}

function previewFile(filename, type) {
  const modal = document.getElementById('modalOverlay');
  const body = document.getElementById('modalBody');
  document.getElementById('modalTitle').textContent = filename;

  if (type === 'video') {
    body.innerHTML = `<video src="/api/output/${filename}" controls style="width:100%;max-height:60vh;border-radius:8px;"></video>`;
  } else if (type === 'audio') {
    body.innerHTML = `<audio src="/api/output/${filename}" controls style="width:100%;"></audio>`;
  }

  modal.classList.add('active');
}

async function deleteFile(filename) {
  if (!confirm(`Delete ${filename}?`)) return;
  try {
    await apiDelete(`/api/output/${filename}`);
    toast('File deleted.', 'info');
    loadLibrary();
  } catch (e) {
    toast('Delete failed.', 'error');
  }
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

async function checkYouTubeStatus() {
  try {
    const data = await apiGet('/api/youtube/status');
    if (data.authenticated) {
      showYouTubeConnected(data);
    } else {
      document.getElementById('ytNotConnected').classList.remove('hidden');
      document.getElementById('ytConnected').classList.add('hidden');
      document.getElementById('ytAuthCode').classList.add('hidden');
    }
  } catch (e) {
    console.error('YouTube status check failed:', e);
  }
}

async function youtubeAuth() {
  try {
    const data = await apiPost('/api/youtube/auth');
    if (data.status === 'needs_auth' && data.auth_url) {
      window.open(data.auth_url, '_blank');
      document.getElementById('ytNotConnected').classList.add('hidden');
      document.getElementById('ytAuthCode').classList.remove('hidden');
    } else if (data.status === 'authenticated') {
      showYouTubeConnected(data);
    } else {
      toast(data.message || 'Auth failed. Make sure client_secrets.json exists.', 'error');
    }
  } catch (e) {
    toast('Auth error: ' + e.message, 'error');
  }
}

async function youtubeAuthCode() {
  const code = document.getElementById('ytCode').value.trim();
  if (!code) {
    toast('Please enter the authorization code.', 'error');
    return;
  }

  try {
    const data = await apiPost('/api/youtube/auth', { auth_code: code });
    if (data.status === 'authenticated') {
      showYouTubeConnected(data);
      toast('YouTube connected!', 'success');
    } else {
      toast(data.message || 'Auth failed.', 'error');
    }
  } catch (e) {
    toast('Auth error: ' + e.message, 'error');
  }
}

function showYouTubeConnected(data) {
  document.getElementById('ytNotConnected').classList.add('hidden');
  document.getElementById('ytAuthCode').classList.add('hidden');
  document.getElementById('ytConnected').classList.remove('hidden');

  document.getElementById('ytChannelName').textContent = data.channel_name || 'Connected';
  document.getElementById('ytSubs').textContent = formatNumber(data.subscribers || 0);
  document.getElementById('ytViews').textContent = formatNumber(data.total_views || 0);
  document.getElementById('ytVideos').textContent = formatNumber(data.video_count || 0);

  loadYouTubeVideos();
}

async function loadYouTubeVideos() {
  try {
    const data = await apiGet('/api/youtube/videos');
    const container = document.getElementById('ytVideoList');

    if (!data.videos || data.videos.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No videos uploaded yet.</p></div>';
      return;
    }

    container.innerHTML = data.videos.map(v => `
      <div class="yt-video-item">
        ${v.thumbnail ? `<img src="${v.thumbnail}" alt="">` : ''}
        <div class="yt-video-info">
          <div class="title">${escapeHtml(v.title)}</div>
          <div class="date">${new Date(v.published_at).toLocaleDateString()} - ${v.status}</div>
        </div>
        <a href="${v.url}" target="_blank" class="btn btn-ghost btn-sm">View</a>
      </div>
    `).join('');
  } catch (e) {
    console.error('Failed to load YouTube videos:', e);
  }
}

async function youtubeDisconnect() {
  if (!confirm('Disconnect your YouTube account?')) return;
  try {
    await apiPost('/api/youtube/disconnect');
    document.getElementById('ytNotConnected').classList.remove('hidden');
    document.getElementById('ytConnected').classList.add('hidden');
    toast('YouTube disconnected.', 'info');
    checkServices();
  } catch (e) {
    toast('Disconnect failed.', 'error');
  }
}

async function uploadToYouTube() {
  if (!lastGeneratedResult) {
    toast('No video to upload. Generate one first.', 'error');
    return;
  }

  try {
    const status = await apiGet('/api/youtube/status');
    if (!status.authenticated) {
      toast('Connect your YouTube account first (YouTube tab).', 'error');
      return;
    }

    const data = await apiPost('/api/youtube/upload', {
      video_path: lastGeneratedResult.video,
      title: lastGeneratedResult.title || 'Reddit Story #shorts',
      description: lastGeneratedResult.description || '',
      tags: lastGeneratedResult.tags || ['reddit', 'storytime', 'viral'],
    });

    if (data.status === 'ok') {
      toast('Upload started...', 'info');
      pollJobStatus(data.job_id, (job) => {
        if (job.status === 'success') {
          toast(`Uploaded! ${job.url}`, 'success');
        } else {
          toast(job.message || 'Upload failed.', 'error');
        }
      });
    } else {
      toast(data.message || 'Upload failed.', 'error');
    }
  } catch (e) {
    toast('Upload error: ' + e.message, 'error');
  }
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
});

// ─── Toast Notifications ─────────────────────────────────────────────────────

function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(100%)';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}

function getFilename(path) {
  return path ? path.split('/').pop() : '';
}
