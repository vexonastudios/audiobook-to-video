// Reuse the decorated cover across chapters, opening cards and transitions.
let cachedCover = null;
let cachedOutline = null;

function segmentDistanceSquared(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const t = dx || dy ? Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy))) : 0;
  return (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2;
}

function simplifySection(points) {
  const keep = new Set([0, points.length - 1]);
  const pending = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop();
    // Less than one output pixel: remove raster stair steps while retaining
    // the book's corners and curved contours. Canvas antialiases the result.
    let greatest = 0.9 ** 2, split = -1;
    for (let i = start + 1; i < end; i++) {
      const distance = segmentDistanceSquared(points[i], points[start], points[end]);
      if (distance > greatest) { greatest = distance; split = i; }
    }
    if (split >= 0) {
      keep.add(split);
      pending.push([start, split], [split, end]);
    }
  }
  return [...keep].sort((a, b) => a - b).map(index => points[index]);
}

function traceCoverOutline(image, width, height) {
  if (cachedOutline?.image === image && cachedOutline.width === width && cachedOutline.height === height) {
    return cachedOutline.path;
  }
  const mask = document.createElement('canvas');
  // Transparent padding closes contours even when artwork touches the PNG edge.
  mask.width = Math.ceil(width) + 4; mask.height = Math.ceil(height) + 4;
  const ctx = mask.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 2, 2, width, height);
  const { data } = ctx.getImageData(0, 0, mask.width, mask.height);
  const w = mask.width, h = mask.height;
  const nodes = new Map();
  const connect = (a, b) => { a.links.push(b); b.links.push(a); };
  const crossing = (id, x, y, dx, dy, from, to) => {
    if (!nodes.has(id)) {
      const fraction = (128 - from) / (to - from);
      // Samples lie at pixel centers. Retain fractional edge positions instead
      // of rounding each row to a new whole-pixel stair step.
      nodes.set(id, { x: x + 0.5 + dx * fraction - 2, y: y + 0.5 + dy * fraction - 2, links: [] });
    }
    return nodes.get(id);
  };
  // Marching squares at 50% alpha ignores faint shadows and traces both outer
  // edges and transparent holes, including concave or rounded book shapes.
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const a = data[i * 4 + 3], b = data[(i + 1) * 4 + 3];
      const c = data[(i + w + 1) * 4 + 3], d = data[(i + w) * 4 + 3];
      const edges = [];
      if ((a >= 128) !== (b >= 128)) edges.push(crossing(i * 2, x, y, 1, 0, a, b));
      if ((b >= 128) !== (c >= 128)) edges.push(crossing((i + 1) * 2 + 1, x + 1, y, 0, 1, b, c));
      if ((d >= 128) !== (c >= 128)) edges.push(crossing((i + w) * 2, x, y + 1, 1, 0, d, c));
      if ((a >= 128) !== (d >= 128)) edges.push(crossing(i * 2 + 1, x, y, 0, 1, a, d));
      if (edges.length === 2) connect(edges[0], edges[1]);
      else if (edges.length === 4) {
        if ((a >= 128) === ((a + b + c + d) / 4 >= 128)) {
          connect(edges[0], edges[1]); connect(edges[2], edges[3]);
        } else {
          connect(edges[0], edges[3]); connect(edges[1], edges[2]);
        }
      }
    }
  }
  const path = new Path2D();
  const visited = new Set();
  for (const start of nodes.values()) {
    if (visited.has(start)) continue;
    const points = [];
    let current = start;
    while (current && !visited.has(current)) {
      visited.add(current); points.push(current);
      current = current.links.find(node => !visited.has(node));
    }
    if (points.length < 3) continue;
    // Split the closed contour into two open arcs before simplifying; using
    // identical start/end points would lose the shape's corners.
    let split = 1;
    for (let i = 2; i < points.length; i++) {
      if (segmentDistanceSquared(points[i], start, start) > segmentDistanceSquared(points[split], start, start)) split = i;
    }
    const simplified = [...simplifySection(points.slice(0, split + 1)),
      ...simplifySection([...points.slice(split), start]).slice(1, -1)];
    path.moveTo(simplified[0].x, simplified[0].y);
    for (const point of simplified.slice(1)) path.lineTo(point.x, point.y);
    path.closePath();
  }
  cachedOutline = { image, width, height, path };
  return path;
}

function createCoverArtwork(image, width, height, borderWidth, accentColor) {
  const key = JSON.stringify([width, height, borderWidth, accentColor]);
  if (cachedCover?.image === image && cachedCover.key === key) return cachedCover;

  const padding = Math.ceil(borderWidth) + 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width) + padding * 2;
  canvas.height = Math.ceil(height) + padding * 2;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (borderWidth > 0) {
    const outline = traceCoverOutline(image, width, height);
    ctx.save();
    ctx.translate(padding, padding);
    const outside = new Path2D();
    outside.rect(-padding, -padding, canvas.width, canvas.height);
    outside.addPath(outline);
    ctx.clip(outside, 'evenodd');
    ctx.lineWidth = borderWidth * 2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgb(${accentColor})`;
    ctx.stroke(outline);
    ctx.restore();
  }
  ctx.drawImage(image, padding, padding, width, height);

  cachedCover = { image, key, canvas, padding };
  return cachedCover;
}

function drawCoverBacklight(ctx, { x, y, width, height, intensity, accentColor }) {
  if (!(intensity > 0)) return;
  const color = accentColor.map(channel => Math.round(channel * 0.55 + 255 * 0.45));
  const strength = Math.min(1, intensity);
  ctx.save();
  // Elliptical light above the darkened background and below the book.
  ctx.translate(x + width * 0.12, y + height * 0.96);
  ctx.scale(width * 1.18, height * 0.85);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  glow.addColorStop(0, `rgba(${color},${strength * 0.85})`);
  glow.addColorStop(0.3, `rgba(${color},${strength * 0.55})`);
  glow.addColorStop(0.65, `rgba(${color},${strength * 0.18})`);
  glow.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

module.exports = { createCoverArtwork, drawCoverBacklight };
