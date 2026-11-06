// Bounded SVG rendering, simulation and readable graph labels.
let visibleLabels = new Map();
function render(data) {
  validateGraph(data);
  if (simulation) {
    simulation.stop();
    simulation = null;
  }
  clearTimeout(simulationTimer);
  svg.interrupt();
  clearTimeout(searchTimer);
  document.getElementById('search-results').replaceChildren();
  document.getElementById('search-results').style.display = 'none';
  document.getElementById('tooltip').style.opacity = '0';
  currentNodes = data.nodes.map((n) => ({ ...n }));
  const center = currentNodes.findIndex((node) => node.type === 'center');
  if (center > 0) currentNodes.unshift(...currentNodes.splice(center, 1));
  visibleLabels = graphLabels(currentNodes);
  const visible = new Set(currentNodes.slice(0, MAX_VISIBLE_NODES).map((node) => node.id));
  currentEdges = data.edges
    .filter((edge) => visible.has(edge.source) && visible.has(edge.target))
    .slice(0, MAX_VISIBLE_EDGES)
    .map((edge) => ({ ...edge }));
  renderNotice =
    data.nodes.length > MAX_VISIBLE_NODES || data.edges.length > currentEdges.length
      ? `Drawing ${visible.size}/${data.nodes.length} nodes and ${currentEdges.length}/${data.edges.length} links. Search any path to open its view.`
      : '';
  g.selectAll('*').remove();
  document.getElementById('info-panel').style.display = 'none';
  hideLoading();
  if (!data.nodes || data.nodes.length === 0) {
    g.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#8b949e')
      .attr('font-size', '14px')
      .text('No data available');
    return;
  }

  const nodes = currentNodes.slice(0, MAX_VISIBLE_NODES);
  const edges = currentEdges;

  const link = drawEdges(edges);
  const node = drawNodes(nodes);
  drawLabels(node);
  bindNodeInteractions(node, nodes, edges);
  applyLangFilter();
  startSimulation(nodes, edges, link, node);
}

function drawEdges(edges) {
  const link = g
    .append('g')
    .attr('class', 'edges')
    .selectAll('line')
    .data(edges)
    .join('line')
    .attr('stroke', (d) =>
      d.type === 'semantic' ? 'rgba(139,233,253,0.35)' : 'rgba(48,54,61,0.6)',
    )
    .attr('stroke-width', (d) =>
      d.type === 'semantic' ? 1 : Math.min(3, (d.weight || 1) * 0.5 + 1),
    )
    .attr('stroke-dasharray', (d) => (d.type === 'semantic' ? '4,3' : 'none'));

  return link;
}

function drawNodes(nodes) {
  const node = g
    .append('g')
    .attr('class', 'nodes')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .attr('cursor', 'pointer')
    .attr('role', 'button')
    .attr('tabindex', 0)
    .attr('aria-label', (d) => d.id)
    .attr('class', (d) => `node lang-${langGroup(d.language)}`)
    .call(d3.drag().on('start', dragStart).on('drag', dragging).on('end', dragEnd));

  // Outer glow
  node
    .append('circle')
    .attr('class', 'glow-ring')
    .attr('r', (d) => nodeRadius(d) + 3)
    .attr('fill', 'none')
    .attr('stroke', (d) => langColor(d.language))
    .attr('stroke-opacity', 0.15)
    .attr('filter', 'url(#glow)');

  // Main circle
  node
    .append('circle')
    .attr('class', 'main-circle')
    .attr('r', (d) => nodeRadius(d))
    .attr('fill', (d) => langColor(d.language))
    .attr('fill-opacity', 0.85)
    .attr('stroke', (d) => (d.type === 'center' ? '#fff' : langColor(d.language)))
    .attr('stroke-width', (d) => (d.type === 'center' ? 2.5 : 1))
    .attr('stroke-opacity', 0.5);

  return node;
}

function drawLabels(node) {
  // Labels
  node
    .append('text')
    .text((d) => visibleLabels.get(d.id))
    .attr('dy', (d) => nodeRadius(d) + LABEL_OFFSET)
    .attr('text-anchor', 'middle')
    .attr('fill', '#e6edf3')
    .attr('font-size', labelSize() + 'px')
    .attr('font-weight', (d) => (d.type === 'center' || d.type === 'community' ? '700' : '400'))
    .attr('opacity', 0.9);

  // Community size badge (level 0)
  if (currentLevel === 0) {
    node
      .filter((d) => d.size > 1)
      .append('text')
      .text((d) => d.size)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', '#fff')
      .attr('font-size', Math.max(10, labelSize() - 2) + 'px')
      .attr('font-weight', '700');
  }
}

function bindNodeInteractions(node, nodes, edges) {
  const tooltip = d3.select('#tooltip');
  node
    .on('mouseover', function (e, d) {
      tooltip.style('opacity', 1).html(buildTooltip(d));
      highlightNeighbors(d, nodes, edges, true);
    })
    .on('mousemove', (e) => {
      tooltip.style('left', e.pageX + TOOLTIP_OFFSET + 'px').style('top', e.pageY - 12 + 'px');
    })
    .on('mouseout', function (e, d) {
      tooltip.style('opacity', 0);
      highlightNeighbors(d, nodes, edges, false);
    })
    .on('click', (e, d) => {
      e.stopPropagation();
      activateNode(d);
    })
    .on('keydown', (e, d) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activateNode(d);
      }
    });
}

function activateNode(node) {
  if (currentLevel === 0 && node.type === 'community') {
    pushHistory();
    void loadLevel(1, node.id);
  } else if (currentLevel === 1 && node.type === 'file') {
    pushHistory();
    void loadLevel(2, node.id);
  } else showInfo(node);
}

function graphLabels(nodes) {
  const names = new Map(),
    suffixes = new Map();
  for (const node of nodes) {
    const name = shortName(node.id),
      suffix = pathLabel(node.id);
    names.set(name, (names.get(name) || 0) + 1);
    suffixes.set(suffix, (suffixes.get(suffix) || 0) + 1);
  }
  return new Map(
    nodes.map((node) => {
      const name = shortName(node.id),
        suffix = pathLabel(node.id);
      const label = names.get(name) === 1 ? name : suffixes.get(suffix) === 1 ? suffix : node.id;
      const letters = Array.from(label);
      return [node.id, letters.length > 64 ? '…' + letters.slice(-63).join('') : label];
    }),
  );
}

function startSimulation(nodes, edges, link, node) {
  // Force simulation
  if (simulation) simulation.stop();
  simulation = d3
    .forceSimulation(nodes)
    .force(
      'link',
      d3
        .forceLink(edges)
        .id((d) => d.id)
        .distance((d) => (currentLevel === 0 ? 120 : 60))
        .strength(0.4),
    )
    .force('charge', d3.forceManyBody().strength(currentLevel === 0 ? -300 : -80))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force(
      'collision',
      d3.forceCollide().radius((d) => nodeRadius(d) + 8),
    )
    .on('tick', () => {
      link
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);
      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

  // Fit to view after stabilization
  simulation.on('end', fitToView);
  scheduleSimulationStop();
}

function scheduleSimulationStop() {
  clearTimeout(simulationTimer);
  simulationTimer = setTimeout(() => {
    simulation?.stop();
    fitToView();
  }, 5000);
}

function labelSize() {
  return Number(document.getElementById('font-size').value);
}

function updateTextSize() {
  document.documentElement.style.setProperty('--ui-font-size', labelSize() + 'px');
  g?.selectAll('.node > text').attr('font-size', labelSize() + 'px');
  resizeCanvas();
}

function highlightNeighbors(d, nodes, edges, on) {
  if (!on) {
    g.selectAll('.node').attr('opacity', 1);
    g.selectAll('.edges line').attr('opacity', 1);
    return;
  }
  const connected = new Set([d.id]);
  edges.forEach((e) => {
    const sid = typeof e.source === 'object' ? e.source.id : e.source;
    const tid = typeof e.target === 'object' ? e.target.id : e.target;
    if (sid === d.id) connected.add(tid);
    if (tid === d.id) connected.add(sid);
  });
  g.selectAll('.node').attr('opacity', (n) => (connected.has(n.id) ? 1 : 0.15));
  g.selectAll('.edges line').attr('opacity', (e) => {
    const sid = typeof e.source === 'object' ? e.source.id : e.source;
    const tid = typeof e.target === 'object' ? e.target.id : e.target;
    return sid === d.id || tid === d.id ? 1 : 0.05;
  });
}

function fitToView() {
  const bounds = g.node().getBBox();
  if (bounds.width === 0 || bounds.height === 0) return;
  const pad = 60;
  const scale = Math.min(width / (bounds.width + pad * 2), height / (bounds.height + pad * 2), 1.5);
  const tx = width / 2 - (bounds.x + bounds.width / 2) * scale;
  const ty = height / 2 - (bounds.y + bounds.height / 2) * scale;
  svg
    .transition()
    .duration(500)
    .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function nodeRadius(d) {
  if (d.type === 'center') return 18;
  if (d.type === 'community') return Math.max(8, Math.min(35, Math.sqrt(d.size || 1) * 3));
  return Math.max(4, Math.min(MAX_FILE_NODE_RADIUS, (d.degree || 1) * 1.5 + 3));
}
