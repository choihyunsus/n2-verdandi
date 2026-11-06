// Graph DOM controls render labels as text and bind actions without inline handlers.

function bindControls() {
  document.getElementById('btn-back').addEventListener('click', goBack);
  document.getElementById('btn-refresh').addEventListener('click', () => {
    loadStats();
    void loadLevel(currentLevel, currentLevel === 1 ? currentCommunityId : currentNodeId);
  });
  document.getElementById('font-size').addEventListener('input', updateTextSize);
  document
    .getElementById('search-input')
    .addEventListener('input', (event) => onSearch(event.target.value));
  document.querySelectorAll('.legend-item[data-lang]').forEach((element) => {
    element.setAttribute('role', 'button');
    element.tabIndex = 0;
    element.addEventListener('click', () => toggleLangFilter(element.dataset.lang));
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        element.click();
      }
    });
  });
}

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text == null ? '' : String(text);
  if (className) element.className = className;
  return element;
}

function navigationLink(label, level, id, active) {
  const element = textElement('span', label, active ? 'active' : '');
  if (!active) {
    element.setAttribute('role', 'button');
    element.tabIndex = 0;
    element.onclick = () => {
      pushHistory();
      void loadLevel(level, id);
    };
    element.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        element.click();
      }
    };
  }
  return element;
}

function updateBreadcrumb(level, id) {
  const bc = document.getElementById('breadcrumb');
  bc.replaceChildren(navigationLink('Overview', 0, null, level === 0));
  const cid = level === 1 ? id : currentCommunityId;
  if (level >= 1 && cid) {
    bc.append(textElement('span', '›', 'sep'), navigationLink(pathLabel(cid), 1, cid, level === 1));
  }
  if (level === 2)
    bc.append(textElement('span', '›', 'sep'), navigationLink(shortName(id), 2, id, true));
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

function buildTooltip(d) {
  let html = `<b>${escapeHtml(d.id)}</b>`;
  if (d.language)
    html += `<br><span style="color:${langColor(d.language)}">${escapeHtml(d.language)}</span>`;
  if (d.size) html += `<br>${escapeHtml(d.size)} files`;
  if (d.degree) html += `<br>degree ${escapeHtml(d.degree)}`;
  if (d.internal_edges) html += `<br>${escapeHtml(d.internal_edges)} internal edges`;
  return html;
}

function showInfo(d) {
  const panel = document.getElementById('info-panel');
  const close = textElement('span', '✕', 'close');
  close.setAttribute('role', 'button');
  close.tabIndex = 0;
  close.onclick = () => {
    panel.style.display = 'none';
  };
  close.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      close.click();
    }
  };
  const fullPath = textElement('div', d.id);
  fullPath.style.cssText =
    'font-size:var(--ui-font-size);color:var(--muted);margin-bottom:8px;word-break:break-all';
  panel.replaceChildren(close, textElement('h3', shortName(d.id)), fullPath);
  const props = {
    type: d.type,
    language: d.language,
    size: d.size,
    degree: d.degree,
    'internal edges': d.internal_edges,
  };
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    const row = textElement('div', '', 'row');
    row.append(textElement('span', key, 'label'), textElement('span', value, 'value'));
    panel.append(row);
  }
  const level = d.type === 'community' ? 1 : ['file', 'neighbor'].includes(d.type) ? 2 : null;
  if (level !== null) {
    const button = textElement('button', level === 1 ? 'Expand' : 'Show neighbors', 'btn');
    button.onclick = () => {
      pushHistory();
      void loadLevel(level, d.id);
    };
    panel.append(button);
  }
  panel.style.display = 'block';
}
