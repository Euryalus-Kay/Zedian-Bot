/* ═══════════════════════════════════════════════════════════════════════════
   Viral Reddit Story Bot — Frontend
   ═══════════════════════════════════════════════════════════════════════════ */

const API = '';
let currentStories = [];
let selectedStory = null;
let currentScript = null;
let lastGeneratedResult = null;
let lastAutoResult = null;
let libraryFilter = 'all';

// ─── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  checkServices();
  checkTunnelOnLoad();
  loadVoices();
  loadBackgrounds();

  // Track script changes for step indicator
  const scriptEl = document.getElementById('scriptText');
  if (scriptEl) {
    scriptEl.addEventListener('input', updateCreateSteps);
  }

  // Show/hide privacy when upload checkbox changes
  const autoUpload = document.getElementById('autoUpload');
  if (autoUpload) {
    autoUpload.addEventListener('change', () => {
      document.getElementById('autoPrivacyGroup').style.display =
        autoUpload.checked ? 'block' : 'none';
    });
  }
});

// ─── Navigation ──────────────────────────────────────────────────────────────

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${pageId}`);
  const nav = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if (page) page.classList.add('active');
  if (nav) nav.classList.add('active');

  if (pageId === 'library') loadLibrary();
  if (pageId === 'backgrounds') loadBackgrounds();
  if (pageId === 'youtube') checkYouTubeStatus();
  if (pageId === 'create') updateCreateSteps();

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ─── Create Page Step Indicator ──────────────────────────────────────────────

function updateCreateSteps() {
  const hasStory = selectedStory !== null;
  const hasScript = (document.getElementById('scriptText')?.value || '').trim().length > 0;
  const hasResult = lastGeneratedResult !== null;

  const s1 = document.getElementById('step1');
  const s2 = document.getElementById('step2');
  const s3 = document.getElementById('step3');
  if (!s1) return;

  // Step 1: Script
  s1.className = (hasScript || hasStory) ? 'step done' : 'step active';
  // Step 2: Settings (active once script is ready)
  s2.className = hasScript ? 'step done' : (hasStory ? 'step active' : 'step');
  // Step 3: Generate
  s3.className = hasResult ? 'step done' : (hasScript ? 'step active' : 'step');
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

// ─── Services ────────────────────────────────────────────────────────────────

async function checkServices() {
  try {
    const s = await apiGet('/api/settings');
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');

    const reddit = s.reddit_configured;
    const claude = s.claude_configured;
    const youtube = s.youtube_authenticated;

    setBadge('badgeReddit', reddit ? 'Connected' : 'Not Set', reddit ? 'success' : 'warning');
    setBadge('badgeClaude', claude ? 'Connected' : 'Not Set', claude ? 'success' : 'warning');
    setBadge('badgeYouTube', youtube ? 'Connected' : 'Not Set', youtube ? 'success' : 'danger');

    if (reddit && claude) {
      dot.className = 'status-dot connected';
      text.textContent = 'All connected';
    } else if (reddit || claude) {
      dot.className = 'status-dot partial';
      text.textContent = 'Partial setup';
    } else {
      dot.className = 'status-dot';
      text.textContent = 'Needs setup';
    }
  } catch (e) {
    console.error('Service check failed:', e);
  }
}

function setBadge(id, text, type) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    el.className = `badge badge-${type}`;
  }
}

// ─── Autopilot ───────────────────────────────────────────────────────────────

async function runAutopilot() {
  const btn = document.getElementById('btnAutopilot');
  const btnAgain = document.getElementById('btnAutopilotAgain');
  btn.disabled = true;
  if (btnAgain) btnAgain.disabled = true;
  btn.innerHTML = '<div class="spinner spinner-sm"></div> Running...';

  document.getElementById('autoProgress').classList.remove('hidden');
  document.getElementById('autoResult').classList.add('hidden');

  const style = document.getElementById('autoStyle').value;
  const voice = document.getElementById('autoVoice').value;
  const bgFile = document.getElementById('autoBg').value;
  const upload = document.getElementById('autoUpload').checked;
  const privacy = document.getElementById('autoPrivacy').value;

  try {
    const data = await apiPost('/api/autopilot', {
      style,
      voice: voice || null,
      background_file: bgFile || null,
      upload,
      privacy,
    });

    if (data.status === 'ok') {
      pollAutopilot(data.job_id);
    } else {
      toast(data.message || 'Autopilot failed to start', 'error');
      resetAutopilotBtn();
    }
  } catch (e) {
    toast('Error: ' + e.message, 'error');
    resetAutopilotBtn();
  }
}

function pollAutopilot(jobId) {
  const interval = setInterval(async () => {
    try {
      const job = await apiGet(`/api/jobs/${jobId}`);

      if (job.status === 'processing') {
        const fill = document.getElementById('autoProgressFill');
        const step = document.getElementById('autoProgressStep');
        const pct = document.getElementById('autoProgressPercent');
        const title = document.getElementById('autoProgressTitle');
        if (fill) fill.style.width = `${job.progress || 0}%`;
        if (step) step.textContent = job.step || 'Processing...';
        if (pct) pct.textContent = `${job.progress || 0}%`;
        if (title) title.textContent = job.step || 'Working...';
      } else {
        clearInterval(interval);
        onAutopilotDone(job);
      }
    } catch (e) {
      clearInterval(interval);
      onAutopilotDone({ status: 'error', message: e.message });
    }
  }, 1500);
}

function onAutopilotDone(job) {
  document.getElementById('autoProgress').classList.add('hidden');
  resetAutopilotBtn();

  if (job.status === 'complete' && job.result) {
    lastAutoResult = job.result;
    const r = job.result;

    document.getElementById('autoResult').classList.remove('hidden');
    document.getElementById('autoPreviewVideo').src = `/api/output/${getFilename(r.video)}`;
    document.getElementById('autoResultDuration').textContent = `${r.duration.toFixed(1)}s`;
    document.getElementById('autoResultTitle').textContent = r.title || 'Untitled';

    // YouTube link
    const ytRow = document.getElementById('autoYtRow');
    const ytLink = document.getElementById('autoYtLink');
    if (r.youtube && r.youtube.status === 'success' && r.youtube.url) {
      ytRow.style.display = 'flex';
      ytLink.href = r.youtube.url;
      ytLink.textContent = r.youtube.url;
      toast('Video uploaded to YouTube!', 'success');
    } else {
      ytRow.style.display = 'none';
      toast('Video ready!', 'success');
    }
  } else {
    toast(job.message || 'Autopilot failed', 'error');
  }
}

function resetAutopilotBtn() {
  const btn = document.getElementById('btnAutopilot');
  const btnAgain = document.getElementById('btnAutopilotAgain');
  btn.disabled = false;
  if (btnAgain) btnAgain.disabled = false;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg> Launch Autopilot';
}

function autoDownload(type) {
  if (!lastAutoResult) return;
  let file;
  if (type === 'video') file = lastAutoResult.video;
  else if (type === 'audio') file = lastAutoResult.audio_only;
  if (file) window.open(`/api/output/${getFilename(file)}`, '_blank');
}

// ─── Discover Mode Toggle ────────────────────────────────────────────────────

let discoverMode = 'ai';

function switchDiscoverMode(mode, tabEl) {
  discoverMode = mode;
  document.querySelectorAll('#page-discover > .tabs .tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');

  document.getElementById('cardAiGen').classList.toggle('hidden', mode !== 'ai');
  document.getElementById('cardReddit').classList.toggle('hidden', mode !== 'reddit');
  document.getElementById('btnLoadCached').classList.toggle('hidden', mode !== 'reddit');
}

// ─── AI Story Generation ─────────────────────────────────────────────────────

async function generateAiStories() {
  const btn = document.getElementById('btnAiGen');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner spinner-sm"></div> Generating...';

  try {
    const style = document.getElementById('aiStyle').value;
    const count = parseInt(document.getElementById('aiCount').value);

    const data = await apiPost('/api/stories/generate', { style, count });

    if (data.status === 'ok') {
      currentStories = data.stories;
      renderStories(currentStories, true);
      toast(`Generated ${data.count} stories`, 'success');
      document.getElementById('btnRank').disabled = false;
    } else {
      toast(data.message || 'Generation failed. Check Claude API key.', 'error');
    }
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }

  btn.disabled = false;
  btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg> Generate';
}

// ─── Reddit Story Discovery ──────────────────────────────────────────────────

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
      toast(`Found ${data.count} stories`, 'success');
      document.getElementById('btnRank').disabled = false;
    } else {
      toast('Scrape failed. Check Reddit API config.', 'error');
    }
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }

  btn.disabled = false;
  btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Scrape';
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
      toast('No cached stories found', 'info');
    }
  } catch (e) {
    toast('Failed to load cache', 'error');
  }
}

async function rankStories() {
  const btn = document.getElementById('btnRank');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner spinner-sm"></div> Ranking...';

  try {
    const data = await apiPost('/api/stories/rank', {
      stories: currentStories,
      top_n: 15,
    });

    if (data.status === 'ok') {
      currentStories = data.stories;
      renderStories(currentStories, true);
      toast(`Top ${data.count} ranked by viral potential`, 'success');
    }
  } catch (e) {
    toast('Ranking failed: ' + e.message, 'error');
  }

  btn.disabled = false;
  btn.innerHTML = 'AI Rank';
}

function renderStories(stories, ranked = false) {
  const container = document.getElementById('storyList');
  const countEl = document.getElementById('storyCount');
  countEl.textContent = `${stories.length} stories`;

  if (stories.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Nothing found</h3>
        <p>Try different filters or check Reddit API config.</p>
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
      ${story.viral_reason ? `<div class="story-preview" style="color:var(--pink);font-weight:500;">${escapeHtml(story.viral_reason)}</div>` : ''}
      <div class="story-preview">${escapeHtml(story.selftext.substring(0, 200))}...</div>
    </div>
  `).join('');
}

function selectStory(index) {
  selectedStory = currentStories[index];
  document.querySelectorAll('.story-card').forEach((c, i) => {
    c.classList.toggle('selected', i === index);
  });

  document.getElementById('selectedStoryPreview').innerHTML = `
    <div>
      <strong>${escapeHtml(selectedStory.title)}</strong>
      <span class="subreddit-tag" style="margin-left:8px;">r/${selectedStory.subreddit}</span>
    </div>`;
  document.getElementById('btnGenScript').disabled = false;

  if (selectedStory.hook) {
    document.getElementById('videoTitle').value = selectedStory.hook;
  }

  updateCreateSteps();
  toast('Story selected — go to Create Video', 'info');
}

// ─── Script ──────────────────────────────────────────────────────────────────

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
      if (data.script.title) document.getElementById('videoTitle').value = data.script.title;
      if (data.script.tags) document.getElementById('videoTags').value = data.script.tags.join(', ');
      updateCreateSteps();
      toast('Script generated', 'success');
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
    toast('Select a story or write a script first', 'error');
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
      toast(data.message || 'Generation failed', 'error');
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
    const r = job.result;

    document.getElementById('genResult').classList.remove('hidden');
    document.getElementById('previewVideo').src = `/api/output/${getFilename(r.video)}`;
    document.getElementById('resultDuration').textContent = `${r.duration.toFixed(1)}s`;
    document.getElementById('resultTitle').textContent = r.title || 'Untitled';
    document.getElementById('resultFile').textContent = getFilename(r.video);

    updateCreateSteps();
    toast('Video ready!', 'success');
  } else {
    toast(job.message || 'Generation failed', 'error');
  }
}

function downloadResult(type) {
  if (!lastGeneratedResult) return;
  let file;
  if (type === 'video') file = lastGeneratedResult.video;
  else if (type === 'audio') file = lastGeneratedResult.audio_only;
  else if (type === 'video_no_audio') file = lastGeneratedResult.video_no_audio;
  if (file) window.open(`/api/output/${getFilename(file)}`, '_blank');
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
    const selects = [
      document.getElementById('voiceSelect'),
      document.getElementById('autoVoice'),
    ].filter(Boolean);

    for (const select of selects) {
      select.innerHTML = '';
      for (const [key, name] of Object.entries(data.voices)) {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${label} (${name})`;
        select.appendChild(opt);
      }
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

    const bgSelects = [bgSelect, document.getElementById('autoBg')].filter(Boolean);
    for (const sel of bgSelects) {
      sel.innerHTML = '<option value="">Random</option>';
      for (const bg of data.backgrounds || []) {
        const opt = document.createElement('option');
        opt.value = bg.filename;
        opt.textContent = `${bg.filename} (${bg.size_mb}MB)`;
        sel.appendChild(opt);
      }
    }

    if (!data.backgrounds || data.backgrounds.length === 0) {
      bgGrid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <h3>No backgrounds</h3>
          <p>Download gameplay footage above to get started.</p>
        </div>`;
      return;
    }

    bgGrid.innerHTML = data.backgrounds.map(bg => `
      <div class="bg-card">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.5" style="margin-bottom:8px"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="m10 8 6 4-6 4z"/></svg>
        <div class="filename">${bg.filename}</div>
        <div class="size">${bg.size_mb} MB</div>
        <button class="btn btn-danger btn-sm mt-8" onclick="deleteBgVideo('${bg.filename}')">Remove</button>
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
      toast('Download started...', 'info');
      pollJobStatus(data.job_id, (job) => {
        if (job.status === 'complete') {
          toast('Background downloaded!', 'success');
          loadBackgrounds();
        } else {
          toast(job.message || 'Download failed', 'error');
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
    toast('Deleted', 'info');
    loadBackgrounds();
  } catch (e) {
    toast('Delete failed', 'error');
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
        <h3>Empty</h3>
        <p>Generate a video to see it here.</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(f => `
    <div class="card" style="padding:14px 18px;">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-12">
          <div style="width:36px;height:36px;background:var(--bg-0);border-radius:8px;display:flex;align-items:center;justify-content:center;">
            ${getFileIcon(f.type)}
          </div>
          <div>
            <div style="font-size:13px;font-weight:600;">${f.filename}</div>
            <div style="font-size:12px;color:var(--text-3);">${f.size_mb} MB &middot; ${new Date(f.created).toLocaleDateString()}</div>
          </div>
        </div>
        <div class="flex gap-6">
          ${f.type === 'video' ? `<button class="btn btn-ghost btn-sm" onclick="previewFile('${f.filename}', '${f.type}')">Preview</button>` : ''}
          <a href="/api/output/${f.filename}" target="_blank" class="btn btn-ghost btn-sm">Download</a>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteFile('${f.filename}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function getFileIcon(type) {
  const icons = {
    video: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="m10 8 6 4-6 4z"/></svg>',
    audio: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--yellow)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  };
  return icons[type] || '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
}

function previewFile(filename, type) {
  const modal = document.getElementById('modalOverlay');
  const body = document.getElementById('modalBody');
  document.getElementById('modalTitle').textContent = filename;

  if (type === 'video') {
    body.innerHTML = `<video src="/api/output/${filename}" controls style="width:100%;max-height:60vh;border-radius:var(--radius-sm);"></video>`;
  } else if (type === 'audio') {
    body.innerHTML = `<audio src="/api/output/${filename}" controls style="width:100%;"></audio>`;
  }

  modal.classList.add('active');
}

async function deleteFile(filename) {
  if (!confirm(`Delete ${filename}?`)) return;
  try {
    await apiDelete(`/api/output/${filename}`);
    toast('Deleted', 'info');
    loadLibrary();
  } catch (e) {
    toast('Delete failed', 'error');
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
    console.error('YouTube check failed:', e);
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
      toast(data.message || 'Auth failed. Check client_secrets.json.', 'error');
    }
  } catch (e) {
    toast('Auth error: ' + e.message, 'error');
  }
}

async function youtubeAuthCode() {
  const code = document.getElementById('ytCode').value.trim();
  if (!code) { toast('Enter the authorization code', 'error'); return; }

  try {
    const data = await apiPost('/api/youtube/auth', { auth_code: code });
    if (data.status === 'authenticated') {
      showYouTubeConnected(data);
      toast('YouTube connected!', 'success');
    } else {
      toast(data.message || 'Auth failed', 'error');
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
      container.innerHTML = '<div class="empty-state"><p>No videos yet.</p></div>';
      return;
    }

    container.innerHTML = data.videos.map(v => `
      <div class="yt-video-item">
        ${v.thumbnail ? `<img src="${v.thumbnail}" alt="">` : ''}
        <div class="yt-video-info">
          <div class="title">${escapeHtml(v.title)}</div>
          <div class="date">${new Date(v.published_at).toLocaleDateString()} &middot; ${v.status}</div>
        </div>
        <a href="${v.url}" target="_blank" class="btn btn-ghost btn-sm">View</a>
      </div>
    `).join('');
  } catch (e) {
    console.error('Failed to load YouTube videos:', e);
  }
}

async function youtubeDisconnect() {
  if (!confirm('Disconnect YouTube?')) return;
  try {
    await apiPost('/api/youtube/disconnect');
    document.getElementById('ytNotConnected').classList.remove('hidden');
    document.getElementById('ytConnected').classList.add('hidden');
    toast('Disconnected', 'info');
    checkServices();
  } catch (e) {
    toast('Disconnect failed', 'error');
  }
}

async function uploadToYouTube() {
  if (!lastGeneratedResult) {
    toast('Generate a video first', 'error');
    return;
  }

  try {
    const status = await apiGet('/api/youtube/status');
    if (!status.authenticated) {
      toast('Connect YouTube first (YouTube tab)', 'error');
      return;
    }

    const data = await apiPost('/api/youtube/upload', {
      video_path: lastGeneratedResult.video,
      title: lastGeneratedResult.title || 'Reddit Story #shorts',
      description: lastGeneratedResult.description || '',
      tags: lastGeneratedResult.tags || ['reddit', 'storytime', 'viral'],
    });

    if (data.status === 'ok') {
      toast('Uploading...', 'info');
      pollJobStatus(data.job_id, (job) => {
        if (job.status === 'success') {
          toast(`Uploaded! ${job.url}`, 'success');
        } else {
          toast(job.message || 'Upload failed', 'error');
        }
      });
    } else {
      toast(data.message || 'Upload failed', 'error');
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

// ─── Toasts ──────────────────────────────────────────────────────────────────

function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px) scale(0.96)';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ─── Cloudflare Tunnel ───────────────────────────────────────────────────

async function startTunnel() {
  const btn = document.getElementById('btnStartTunnel');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner spinner-sm"></div> Starting...';

  try {
    await apiPost('/api/tunnel/start');
    pollTunnelUrl();
  } catch (e) {
    toast('Failed to start tunnel: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = 'Start Tunnel';
  }
}

function pollTunnelUrl() {
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    try {
      const data = await apiGet('/api/tunnel/status');
      if (data.url) {
        clearInterval(interval);
        showTunnelRunning(data.url);
        toast('Tunnel live! Public URL ready.', 'success');
      } else if (attempts > 20) {
        clearInterval(interval);
        toast('Tunnel started but no URL yet. Check if cloudflared is installed.', 'error');
        resetTunnelBtn();
      }
    } catch (e) {
      clearInterval(interval);
      resetTunnelBtn();
    }
  }, 1500);
}

function showTunnelRunning(url) {
  document.getElementById('tunnelStopped').classList.add('hidden');
  document.getElementById('tunnelRunning').classList.remove('hidden');
  document.getElementById('tunnelUrl').textContent = url;
  document.getElementById('tunnelUrl').href = url;

  // Show in sidebar
  const sidebarTunnel = document.getElementById('sidebarTunnel');
  const sidebarUrl = document.getElementById('sidebarTunnelUrl');
  if (sidebarTunnel) {
    sidebarTunnel.classList.remove('hidden');
    sidebarUrl.textContent = url;
    sidebarUrl.href = url;
  }
}

function resetTunnelBtn() {
  document.getElementById('tunnelStopped').classList.remove('hidden');
  document.getElementById('tunnelRunning').classList.add('hidden');
  const btn = document.getElementById('btnStartTunnel');
  btn.disabled = false;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Start Tunnel';

  // Hide from sidebar
  const sidebarTunnel = document.getElementById('sidebarTunnel');
  if (sidebarTunnel) sidebarTunnel.classList.add('hidden');
}

async function stopTunnel() {
  try {
    await apiPost('/api/tunnel/stop');
    resetTunnelBtn();
    toast('Tunnel stopped', 'info');
  } catch (e) {
    toast('Stop failed: ' + e.message, 'error');
  }
}

function copyTunnelUrl() {
  const url = document.getElementById('tunnelUrl').textContent;
  navigator.clipboard.writeText(url).then(() => {
    toast('URL copied!', 'success');
  }).catch(() => {
    toast('Copy failed — select and copy manually', 'error');
  });
}

async function checkTunnelOnLoad() {
  try {
    const data = await apiGet('/api/tunnel/status');
    if (data.running && data.url) {
      showTunnelRunning(data.url);
    }
  } catch (e) { /* ignore */ }
}

// ─── Settings: Save API Key ──────────────────────────────────────────────

async function saveApiKey() {
  const input = document.getElementById('inputApiKey');
  const key = input.value.trim();
  if (!key) { toast('Paste your API key first', 'error'); return; }

  const btn = document.getElementById('btnSaveKey');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const data = await apiPost('/api/settings/apikey', { api_key: key });
    if (data.status === 'ok') {
      toast(data.message || 'API key saved!', 'success');
      input.value = '';
      checkServices();
    } else {
      toast(data.message || 'Failed to save', 'error');
    }
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Save Key';
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
