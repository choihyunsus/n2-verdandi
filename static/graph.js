// Bundled graph client; no inline scripts or executable file-name interpolation.
const LABEL_OFFSET = 14,
  TOOLTIP_OFFSET = 14,
  MAX_FILE_NODE_RADIUS = 14;
const LANG_COLORS = {
  rust: '#58a6ff',
  rs: '#58a6ff',
  typescript: '#3178c6',
  ts: '#3178c6',
  javascript: '#f1e05a',
  js: '#f1e05a',
  jsx: '#f1e05a',
  tsx: '#3178c6',
  html: '#e34c26',
  css: '#563d7c',
  python: '#3572a5',
  py: '#3572a5',
  toml: '#89e051',
  json: '#89e051',
  yaml: '#89e051',
  yml: '#89e051',
  go: '#00ADD8',
  java: '#b07219',
  c: '#555555',
  cpp: '#f34b7d',
  mixed: '#bc8cff',
  unknown: '#8b949e',
};
const LANG_GROUPS = {
  rust: ['rust', 'rs'],
  typescript: ['typescript', 'ts', 'tsx'],
  javascript: ['javascript', 'js', 'jsx'],
  html: ['html', 'css'],
  toml: ['toml', 'json', 'yaml', 'yml'],
  other: [],
};
function langColor(lang) {
  const key = (lang || '').toLowerCase();
  return Object.hasOwn(LANG_COLORS, key) ? LANG_COLORS[key] : '#8b949e';
}
function langGroup(lang) {
  const l = (lang || '').toLowerCase();
  for (const [group, langs] of Object.entries(LANG_GROUPS)) {
    if (langs.includes(l)) return group;
  }
  return 'other';
}
function shortName(path) {
  const p = (path || '').replace(/\\/g, '/');
  return p.split('/').pop() || p;
}

function pathLabel(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .slice(-2)
    .join('/');
}

let width, height, svg, g, simulation, zoomBehavior;
let currentLevel = 0,
  currentCommunityId = null,
  currentNodeId = null;
let navigationVersion = 0,
  navigationController = null,
  pendingHistory = null;
let statsVersion = 0,
  statsText = '',
  graphError = '';
let currentNodes = [],
  currentEdges = [];
let renderNotice = '',
  simulationTimer = null;
const MAX_VISIBLE_NODES = 800,
  MAX_VISIBLE_EDGES = 4000;
const navHistory = [];
const hiddenLangs = new Set();

function apiFetch(url, signal) {
  return fetch(url, { signal, credentials: 'same-origin' });
}

function showLoading() {
  document.getElementById('loading').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loading').style.display = 'none';
}

function topbarHeight() {
  const el = document.querySelector('.topbar');
  return el ? el.offsetHeight : 48;
}

function syncTopbarHeight() {
  document.documentElement.style.setProperty('--topbar-h', topbarHeight() + 'px');
}

async function init() {
  bindControls();
  syncTopbarHeight();
  new ResizeObserver(resizeCanvas).observe(document.querySelector('.topbar'));

  width = window.innerWidth;
  height = window.innerHeight - topbarHeight();
  svg = d3.select('body').append('svg').attr('width', width).attr('height', height);
  g = svg.append('g');

  zoomBehavior = d3
    .zoom()
    .scaleExtent([0.05, 10])
    .on('zoom', (e) => g.attr('transform', e.transform));
  svg.call(zoomBehavior);
  svg.on('click', () => {
    document.getElementById('info-panel').style.display = 'none';
  });

  // Glow filter
  const defs = svg.append('defs');
  const filter = defs.append('filter').attr('id', 'glow');
  filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
  const merge = filter.append('feMerge');
  merge.append('feMergeNode').attr('in', 'blur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  try {
    loadStats();
    await loadLevel(0);
  } catch (e) {
    hideLoading();
    document.getElementById('stats').textContent = 'Connection failed — engine offline?';
  }
}

function displayStatus() {
  const status = document.getElementById('stats');
  status.textContent = graphError
    ? `Error: ${graphError}`
    : [statsText, renderNotice].filter(Boolean).join(' · ');
  status.title = status.textContent;
  status.setAttribute('role', graphError ? 'alert' : 'status');
}

async function loadStats() {
  const version = ++statsVersion;
  try {
    const r = await apiFetch('/api/verdandi/graph/stats');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (
      !d ||
      !['communities', 'members', 'bridges', 'semantic_edges'].every((key) => validCount(d[key]))
    ) {
      throw new Error('Invalid statistics');
    }
    if (version !== statsVersion) return;
    statsText = `${d.communities} communities · ${d.members} files · ${d.bridges} bridges · ${d.semantic_edges} semantic`;
    if (d.coverage === 'partial') statsText += ' · Partial source index';
    if (d.stale) statsText += ' · Rebuild needed';
    if (d.semantic?.edgeCount > 0 && d.semantic.stale) statsText += ' · Semantic refresh needed';
  } catch {
    if (version !== statsVersion) return;
    statsText = 'Stats unavailable';
  }
  displayStatus();
}

function graphUrl(level, id) {
  if (level === 0) return '/api/verdandi/graph/overview';
  if (![1, 2].includes(level) || typeof id !== 'string' || !id)
    throw new Error('Invalid navigation target');
  return `/api/verdandi/graph/${level === 1 ? 'community' : 'node'}/${encodeURIComponent(id)}`;
}

async function loadLevel(level, id, options = {}) {
  const version = ++navigationVersion;
  if (navigationController) navigationController.abort();
  const controller = new AbortController();
  navigationController = controller;
  const history = pendingHistory;
  pendingHistory = null;
  showLoading();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const r = await apiFetch(graphUrl(level, id), controller.signal);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    validateGraph(data);
    if (data.level !== level) throw new Error('Graph level does not match the request');
    if (version !== navigationVersion) return;
    if (options.back) {
      if (navHistory.at(-1) === options.back) navHistory.pop();
      currentCommunityId = options.back.community;
    } else if (history) {
      navHistory.push(history);
      if (navHistory.length > 100) navHistory.shift();
    }
    if (level === 0) currentCommunityId = null;
    if (level === 1) currentCommunityId = id;
    currentNodeId = level === 2 ? id : null;
    currentLevel = level;
    render(data);
    graphError = '';
    updateBreadcrumb(level, id);
    updateBackButton();
    displayStatus();
  } catch (e) {
    if (version !== navigationVersion) return;
    graphError = e.name === 'AbortError' ? 'Graph request timed out; retry navigation' : e.message;
    displayStatus();
  } finally {
    clearTimeout(timeout);
    if (version === navigationVersion) {
      navigationController = null;
      hideLoading();
    }
  }
}

function pushHistory() {
  pendingHistory = {
    level: currentLevel,
    id: currentLevel === 1 ? currentCommunityId : currentNodeId,
    community: currentCommunityId,
  };
}

function goBack() {
  const previous = navHistory.at(-1);
  if (previous) {
    pendingHistory = null;
    return loadLevel(previous.level, previous.id, { back: previous });
  }
}

function updateBackButton() {
  document.getElementById('btn-back').disabled = navHistory.length === 0;
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validateGraph(data) {
  if (
    !record(data) ||
    ![0, 1, 2].includes(data.level) ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.edges) ||
    data.nodes.length > 20000 ||
    data.edges.length > 100000
  )
    throw new Error('Invalid or oversized graph');
  const ids = new Set();
  for (const node of data.nodes) {
    if (
      !record(node) ||
      typeof node.id !== 'string' ||
      !node.id ||
      ids.has(node.id) ||
      !['community', 'file', 'center', 'neighbor'].includes(node.type) ||
      (node.language !== undefined && typeof node.language !== 'string') ||
      ['size', 'degree', 'internal_edges'].some(
        (key) => node[key] !== undefined && !validCount(node[key]),
      )
    ) {
      throw new Error('Invalid graph node');
    }
    ids.add(node.id);
  }
  for (const edge of data.edges) {
    if (
      !record(edge) ||
      !ids.has(edge.source) ||
      !ids.has(edge.target) ||
      !['bridge', 'import', 'semantic'].includes(edge.type) ||
      (edge.weight !== undefined && !validCount(edge.weight)) ||
      (edge.similarity !== undefined &&
        (!Number.isFinite(edge.similarity) || edge.similarity < 0 || edge.similarity > 1))
    )
      throw new Error('Invalid graph edge');
  }
}

// -- Language filter --

function toggleLangFilter(lang) {
  if (hiddenLangs.has(lang)) hiddenLangs.delete(lang);
  else hiddenLangs.add(lang);
  document.querySelectorAll('.legend-item[data-lang]').forEach((el) => {
    el.classList.toggle('dimmed', hiddenLangs.has(el.dataset.lang));
  });
  applyLangFilter();
}

function applyLangFilter() {
  if (hiddenLangs.size === 0) {
    g.selectAll('.node').style('display', null);
    g.selectAll('.edges line').style('display', null);
    return;
  }
  g.selectAll('.node').style('display', (d) =>
    hiddenLangs.has(langGroup(d.language)) ? 'none' : null,
  );
  const visible = new Set();
  g.selectAll('.node').each(function (d) {
    if (!hiddenLangs.has(langGroup(d.language))) visible.add(d.id);
  });
  g.selectAll('.edges line').style('display', (d) => {
    const sid = typeof d.source === 'object' ? d.source.id : d.source;
    const tid = typeof d.target === 'object' ? d.target.id : d.target;
    return visible.has(sid) && visible.has(tid) ? null : 'none';
  });
}

// -- Search --

let searchTimer = null;
function onSearch(query) {
  clearTimeout(searchTimer);
  const results = document.getElementById('search-results');
  if (!query.trim()) {
    results.style.display = 'none';
    return;
  }
  searchTimer = setTimeout(() => {
    const q = query.toLowerCase();
    const matches = currentNodes.filter((n) => (n.id || '').toLowerCase().includes(q)).slice(0, 20);
    if (matches.length === 0) {
      results.style.display = 'none';
      return;
    }
    results.replaceChildren();
    for (const match of matches) {
      const item = textElement('div', '', 'item');
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.onclick = () => focusNode(match.id);
      item.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          item.click();
        }
      };
      const dot = textElement('div', '', 'dot');
      dot.style.background = langColor(match.language);
      const language = textElement('span', match.language);
      language.style.cssText = 'color:var(--muted);margin-left:auto;font-size:10px';
      item.append(dot, textElement('span', pathLabel(match.id)), language);
      results.append(item);
    }
    results.style.display = 'block';
  }, 150);
}

function focusNode(id) {
  document.getElementById('search-results').style.display = 'none';
  document.getElementById('search-input').value = '';
  const node = currentNodes.find((n) => n.id === id);
  if (!node) return;
  if (node.x == null) {
    pushHistory();
    void loadLevel(node.type === 'community' ? 1 : 2, node.id);
    return;
  }
  // Zoom to node
  const scale = 1.5;
  const tx = width / 2 - node.x * scale;
  const ty = height / 2 - node.y * scale;
  svg
    .transition()
    .duration(600)
    .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  // Flash the node
  g.selectAll('.node')
    .filter((d) => d.id === id)
    .select('.main-circle')
    .transition()
    .duration(200)
    .attr('fill-opacity', 1)
    .attr('stroke', '#fff')
    .attr('stroke-width', 3)
    .transition()
    .duration(800)
    .attr('fill-opacity', 0.85)
    .attr('stroke', (d) => langColor(d.language))
    .attr('stroke-width', 1);
}

// -- Drag --

function dragStart(e, d) {
  if (!e.active) simulation.alphaTarget(0.3).restart();
  scheduleSimulationStop();
  d.fx = d.x;
  d.fy = d.y;
}
function dragging(e, d) {
  d.fx = e.x;
  d.fy = e.y;
}
function dragEnd(e, d) {
  if (!e.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

// -- Resize --

function resizeCanvas() {
  syncTopbarHeight();
  width = window.innerWidth;
  height = window.innerHeight - topbarHeight();
  svg?.attr('width', width).attr('height', height);
  if (svg && g) {
    svg.interrupt();
    fitToView();
  }
}
window.addEventListener('resize', resizeCanvas);

// -- Keyboard --

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('info-panel').style.display = 'none';
    document.getElementById('search-results').style.display = 'none';
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    document.getElementById('search-input').focus();
  }
  if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    goBack();
  }
});

window.addEventListener('pagehide', () => {
  navigationVersion++;
  statsVersion++;
  navigationController?.abort();
  simulation?.stop();
  clearTimeout(searchTimer);
  svg?.interrupt();
  clearTimeout(simulationTimer);
});

init();
