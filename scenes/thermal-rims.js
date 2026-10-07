/**
 * Narrow pigment profiles attached to the editable thermal outline.
 * Each pose stores colors across a narrow contour band; positions come from
 * the existing silhouette. No image or full-frame color field is loaded.
 */
export async function createThermalRims(geometry, url = new URL('../assets/thermal-rims.json', import.meta.url)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Thermal rim profiles could not load (${response.status}).`);
  const data = await response.json();
  const count = data.count, columns = Math.max(data.offsetsNative.length, ...Object.values(data.offsetsByFrame || {}).map(offsets => offsets.length));
  const center = data.offsetsNative.indexOf(0), head = geometry[data.group || 'head'];
  const frames = new Map(Object.entries(data.frames).map(([frame, encoded]) => {
    const decoded = atob(encoded);
    const source = Uint8Array.from(decoded, byte => byte.charCodeAt(0));
    const sourceColumns = source.length / (count * 4);
    if (!Number.isInteger(sourceColumns) || sourceColumns > columns) throw new Error('Invalid thermal profile columns.');
    if (sourceColumns === columns) return [Number(frame), source];
    const padded = new Uint8Array(count * columns * 4);
    for (let row = 0; row < count; row++) for (let column = 0; column < columns; column++) {
      const from = (row * sourceColumns + Math.min(column, sourceColumns - 1)) * 4;
      padded.set(source.subarray(from, from + 4), (row * columns + column) * 4);
    }
    return [Number(frame), padded];
  }));
  delete data.frames;
  const positionsByFrame = new Map();
  const centerlinesByFrame = new Map();
  const morphIntervals = new Set(data.morphIntervals || []);
  const pairedProfiles = new Map();
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {
    alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('The thermal rim renderer requires WebGL.');
  const shader = (type, source) => {
    const item = gl.createShader(type);
    gl.shaderSource(item, source);
    gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item));
    return item;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, `
    attribute vec2 point;
    attribute vec4 colorA;
    attribute vec4 colorB;
    uniform float phase;
    uniform float opacity;
    varying vec4 pigment;
    void main() {
      gl_Position = vec4(point.x / 360.0 - 1.0, 1.0 - point.y / 270.0, 0.0, 1.0);
      pigment = mix(colorA, colorB, phase);
      pigment.a *= opacity;
    }
  `));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec4 pigment;
    void main() { gl_FragColor = pigment; }
  `));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffers = {};
  for (const [name, size, type, normalized] of [
    ['point', 2, gl.FLOAT, false], ['colorA', 4, gl.UNSIGNED_BYTE, true], ['colorB', 4, gl.UNSIGNED_BYTE, true],
  ]) {
    buffers[name] = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[name]);
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, type, normalized, 0, 0);
  }
  const maximumRows = count * 2;
  const largeIndices = maximumRows * columns > 65535;
  if (largeIndices && !gl.getExtension('OES_element_index_uint')) throw new Error('Thermal profiles require 32-bit WebGL indices.');
  const IndexArray = largeIndices ? Uint32Array : Uint16Array;
  const indexBytes = IndexArray.BYTES_PER_ELEMENT;
  const indexType = largeIndices ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  const indicesPerRow = (columns - 1) * 6;
  const indices = new IndexArray(maximumRows * indicesPerRow);
  const closingRow = (row, nextRow) => {
    const values = new IndexArray(indicesPerRow);
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column, b = a + 1;
      const c = nextRow * columns + column, d = c + 1;
      values.set([a, b, d, a, d, c], column * 6);
    }
    return values;
  };
  for (let row = 0; row < maximumRows; row++) indices.set(closingRow(row, (row + 1) % maximumRows), row * indicesPerRow);
  indices.set(closingRow(count - 1, 0), (count - 1) * indicesPerRow);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  let activeRows = count;
  const checkRows = rows => {
    if (rows > maximumRows || rows * columns > (largeIndices ? 4294967295 : 65535)) throw new Error('Thermal rim correspondence exceeds its index range.');
  };
  function activateRows(rows) {
    if (rows === activeRows) return;
    checkRows(rows);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    // Every strip shares its sequential triangles. Only the final row wraps
    // back to zero, so patch that row instead of retaining dozens of arrays.
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, (activeRows - 1) * indicesPerRow * indexBytes,
      closingRow(activeRows - 1, activeRows % maximumRows));
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, (rows - 1) * indicesPerRow * indexBytes, closingRow(rows - 1, 0));
    activeRows = rows;
  }
  const phase = gl.getUniformLocation(program, 'phase');
  const opacity = gl.getUniformLocation(program, 'opacity');

  function positions(frame) {
    let points = positionsByFrame.get(frame);
    if (points) return points;
    const outline = head.frames[frame - head.start].outline;
    const n = outline.length / 2, length = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      length[i + 1] = length[i] + Math.hypot(outline[j * 2] - outline[i * 2], outline[j * 2 + 1] - outline[i * 2 + 1]);
    }
    const curve = new Float64Array(count * 2);
    let segment = 0;
    for (let i = 0; i < count; i++) {
      const distance = i * length[n] / count;
      while (segment < n - 1 && length[segment + 1] < distance) segment++;
      const j = (segment + 1) % n;
      const mix = (distance - length[segment]) / (length[segment + 1] - length[segment] || 1);
      curve[i * 2] = outline[segment * 2] + (outline[j * 2] - outline[segment * 2]) * mix;
      curve[i * 2 + 1] = outline[segment * 2 + 1] + (outline[j * 2 + 1] - outline[segment * 2 + 1]) * mix;
    }
    centerlinesByFrame.set(frame, Float32Array.from(curve));
    points = new Float32Array(count * columns * 2);
    for (let i = 0; i < count; i++) {
      const previous = (i + count - 1) % count, following = (i + 1) % count;
      const tx = curve[following * 2] - curve[previous * 2];
      const ty = curve[following * 2 + 1] - curve[previous * 2 + 1];
      const distance = Math.hypot(tx, ty) || 1;
      for (let column = 0; column < columns; column++) {
        const offsets = data.offsetsByFrame?.[frame] || data.offsetsNative;
        const offset = offsets[Math.min(column, offsets.length - 1)] / 4, k = (i * columns + column) * 2;
        points[k] = curve[i * 2] + ty / distance * offset;
        points[k + 1] = curve[i * 2 + 1] - tx / distance * offset;
      }
    }
    positionsByFrame.set(frame, points);
    return points;
  }

  function pairProfiles(low, colorA, colorB) {
    if (pairedProfiles.has(low)) return pairedProfiles.get(low);
    const first = head.frames[low - head.start], second = head.frames[low + 1 - head.start];
    const left = positions(low), right = positions(low + 1);
    const arc = outline => {
      const n = outline.length / 2, out = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        out[i + 1] = out[i] + Math.hypot(outline[j * 2] - outline[i * 2], outline[j * 2 + 1] - outline[i * 2 + 1]);
      }
      const total = out[n];
      for (let i = 0; i <= n; i++) out[i] = out[i] / total * count;
      return out;
    };
    const arcA = arc(first.outline), arcB = arc(second.outline);
    const nA = first.outline.length / 2, nB = second.outline.length / 2;
    const correspondence = first.morph ? Array.from(first.morph) : Array.from({length:nA * 2}, (_, i) => Math.floor(i / 2));
    correspondence.push(nA, nB);
    const knots = correspondence.length / 2, rows = [[0, 0]];
    // Use the union of both native profile grids. Every native corner survives
    // at each endpoint; uniform resampling omitted some sharp fingertip rows.
    for (let segment = 0; segment < knots - 1; segment++) {
      const a0 = arcA[correspondence[segment * 2]], a1 = arcA[correspondence[(segment + 1) * 2]];
      const b0 = arcB[correspondence[segment * 2 + 1]], b1 = arcB[correspondence[(segment + 1) * 2 + 1]];
      const events = [];
      for (const [start, end] of [[a0, a1], [b0, b1]]) {
        if (end <= start) continue;
        for (let crossing = Math.floor(start + 1e-9) + 1; crossing <= end + 1e-9; crossing++) {
          events.push(Math.min(1, (crossing - start) / (end - start)));
        }
      }
      events.sort((a, b) => a - b);
      for (const mix of events) {
        const uA = a0 + (a1 - a0) * mix, uB = b0 + (b1 - b0) * mix;
        const previous = rows[rows.length - 1];
        if (uA >= count - 1e-8 && uB >= count - 1e-8) continue;
        if (Math.abs(uA - previous[0]) + Math.abs(uB - previous[1]) < 1e-8) continue;
        rows.push([uA, uB]);
      }
    }
    const pair = {left:new Float32Array(rows.length * columns * 2), right:new Float32Array(rows.length * columns * 2), a:new Uint8Array(rows.length * columns * 4), b:new Uint8Array(rows.length * columns * 4)};
    const copyRow = (from, to, row, parameter, channels) => {
      const floor = Math.floor(parameter), a = ((floor % count) + count) % count, b = (a + 1) % count, mix = parameter - floor;
      for (let column = 0; column < columns; column++) for (let c = 0; c < channels; c++) {
        const aa = (a * columns + column) * channels + c, bb = (b * columns + column) * channels + c;
        const value = from[aa] + (from[bb] - from[aa]) * mix;
        to[(row * columns + column) * channels + c] = channels === 4 ? Math.round(value) : value;
      }
    };
    for (let row = 0; row < rows.length; row++) {
      const [uA, uB] = rows[row];
      copyRow(left, pair.left, row, uA, 2); copyRow(right, pair.right, row, uB, 2);
      copyRow(colorA, pair.a, row, frames.has(low) ? uA : uB, 4);
      copyRow(colorB, pair.b, row, frames.has(low + 1) ? uB : uA, 4);
    }
    checkRows(rows.length);
    pairedProfiles.set(low, pair);
    return pair;
  }

  let lastFrame, lastSample;
  function sample(frame) {
    if (frame === lastFrame) return lastSample;
    lastFrame = frame;
    lastSample = null;
    const low = Math.floor(frame), high = Math.ceil(frame), blend = frame - low;
    let a = frames.get(low), b = frames.get(high), strength = 1;
    if (!a && !b) return null;
    if (!a) { a = b; strength = blend; }
    if (!b) { b = a; strength = 1 - blend; }
    const local = low - head.start;
    if (local < 0 || local >= head.frames.length - 1) return null;
    let points = positions(low);
    const matched = blend > 1e-7 && morphIntervals.has(low);
    if (blend > 1e-7) {
      const pair = matched ? pairProfiles(low, a, b) : null;
      const left = pair ? pair.left : points, right = pair ? pair.right : positions(high);
      if (pair) { a = pair.a; b = pair.b; }
      points = new Float32Array(left.length);
      // Interpolate stable endpoint normals with their vertices. Recomputing
      // normals on a moving polygon magnifies tiny corner changes into spikes.
      for (let i = 0; i < points.length; i++) points[i] = left[i] + (right[i] - left[i]) * blend;
    }
    lastSample = { a, b, blend, strength, points, matched };
    return lastSample;
  }

  let uploadedA, uploadedB;
  // Prepare correspondence once while the film loads, rather than doing the
  // first expensive profile transport on an animation frame.
  let warmed = 0;
  for (const low of morphIntervals) {
    let a = frames.get(low), b = frames.get(low + 1);
    if ((!a && !b) || low < head.start || low >= head.start + head.frames.length - 1) continue;
    a ||= b; b ||= a;
    pairProfiles(low, a, b);
    if (++warmed % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return {
    outline(frame) {
      const current = sample(frame);
      if (!current || current.blend < 1e-7 || current.matched) return null;
      // The body clip and color rim share the same continuous silhouette.
      // Native samples keep their original contour and exact pixel coverage.
      const outline = new Float32Array(count * 2);
      if (data.offsetsByFrame?.[Math.floor(frame)] || data.offsetsByFrame?.[Math.ceil(frame)]) {
        const a = centerlinesByFrame.get(Math.floor(frame)), b = centerlinesByFrame.get(Math.ceil(frame));
        for (let i = 0; i < outline.length; i++) outline[i] = a[i] + (b[i] - a[i]) * current.blend;
        return outline;
      }
      for (let i = 0; i < count; i++) {
        const k = (i * columns + center) * 2;
        outline[i * 2] = current.points[k];
        outline[i * 2 + 1] = current.points[k + 1];
      }
      return outline;
    },
    draw(ctx, frame) {
      const current = sample(frame);
      if (!current) return false;
      const scale = Math.max(1, Math.hypot(ctx.getTransform().a, ctx.getTransform().b));
      const width = Math.round(720 * scale), height = Math.round(540 * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width; canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.point);
      gl.bufferData(gl.ARRAY_BUFFER, current.points, gl.DYNAMIC_DRAW);
      if (uploadedA !== current.a) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.colorA);
        gl.bufferData(gl.ARRAY_BUFFER, current.a, gl.DYNAMIC_DRAW);
        uploadedA = current.a;
      }
      if (uploadedB !== current.b) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.colorB);
        gl.bufferData(gl.ARRAY_BUFFER, current.b, gl.DYNAMIC_DRAW);
        uploadedB = current.b;
      }
      gl.uniform1f(phase, current.blend);
      gl.uniform1f(opacity, current.strength);
      activateRows(current.points.length / (columns * 2));
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, activeRows * indicesPerRow, indexType, 0);
      ctx.drawImage(canvas, 0, 0, 720, 540);
      return true;
    },
  };
}
