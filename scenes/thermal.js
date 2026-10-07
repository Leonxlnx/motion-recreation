import {createThermalLights} from './thermal-lights.js';
import {createThermalExitEdge} from './thermal-exit-edge.js';
import {createThermalRims} from './thermal-rims.js';
import {createThermalMotion} from './thermal-motion.js';
import {createThermalPen} from './thermal-pen.js';
/**
 * Editable inverse-graphics reconstruction of the thermal person and hand.
 * Geometry: one native-derived closed silhouette per observed pose.
 * Shading: a coarse, regular triangle mesh with measured RGB vertex colors.
 * No bitmap frames, video textures, or source footage are used at runtime.
 * All coordinates are in the film's 720 × 540 design space; frame is zero based.
 */
let instance;

/** Continuous contour geometry; observed endpoints are preserved exactly. */
export function interpolateThermalOutline(a, b, mix) {
  const correspondence = mix > 1e-6 && a.morph;
  let points = new Float32Array(correspondence ? correspondence.length : a.outline.length);
  for (let i = 0; i < points.length; i += 2) {
    const from = correspondence ? correspondence[i] * 2 : i;
    const to = correspondence ? correspondence[i + 1] * 2 : i;
    points[i] = a.outline[from] + (b.outline[to] - a.outline[from]) * mix;
    points[i + 1] = a.outline[from + 1] + (b.outline[to + 1] - a.outline[from + 1]) * mix;
  }
  if (!a.cleanupMorph || mix <= 1e-6 || mix >= 1 - 1e-6) return points;
  const area = polygon => {
    let sum = 0;
    for (let i = 0; i < polygon.length; i += 2) {
      const j = (i + 2) % polygon.length;
      sum += polygon[i] * polygon[j + 1] - polygon[j] * polygon[i + 1];
    }
    return Math.abs(sum);
  };
  // Thin source ink can touch the photographed silhouette. Its little branches
  // may cross during a pose morph; retain the principal closed body contour.
  for (let pass = 0; pass < 16; pass++) {
    const count = points.length / 2;
    let replacement;
    for (let i = 0; i < count && !replacement; i++) {
      const ni = (i + 1) % count;
      const ax = points[2 * i], ay = points[2 * i + 1];
      const bx = points[2 * ni], by = points[2 * ni + 1];
      for (let j = i + 4; j < count; j++) {
        if (count - j + i < 4) continue;
        const nj = (j + 1) % count;
        const cx = points[2 * j], cy = points[2 * j + 1];
        const dx = points[2 * nj], dy = points[2 * nj + 1];
        if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx)
          || Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) continue;
        const ux = bx - ax, uy = by - ay, vx = dx - cx, vy = dy - cy;
        const denominator = ux * vy - uy * vx;
        if (Math.abs(denominator) < 1e-9) continue;
        const t = ((cx - ax) * vy - (cy - ay) * vx) / denominator;
        const u = ((cx - ax) * uy - (cy - ay) * ux) / denominator;
        if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) continue;
        const hit = [ax + t * ux, ay + t * uy];
        const first = hit.concat(Array.from(points.slice((i + 1) * 2, (j + 1) * 2)));
        const second = hit.concat(Array.from(points.slice((j + 1) * 2)), Array.from(points.slice(0, (i + 1) * 2)));
        replacement = area(first) > area(second) ? first : second;
        break;
      }
    }
    if (!replacement) break;
    points = new Float32Array(replacement);
  }
  return points;
}

function shader(gl, kind, source) {
  const item = gl.createShader(kind);
  gl.shaderSource(item, source);
  gl.compileShader(item);
  if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(item));
  }
  return item;
}

function makeMeshRenderer() {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 540;
  const gl = canvas.getContext('webgl', {
    alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('The thermal mesh renderer requires WebGL.');
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, `
    attribute vec2 position;
    attribute vec3 color;
    varying vec3 pigment;
    void main() {
      gl_Position = vec4(position.x / 360.0 - 1.0, 1.0 - position.y / 270.0, 0.0, 1.0);
      pigment = color;
    }
  `));
  gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec3 pigment;
    void main() { gl_FragColor = vec4(pigment, 1.0); }
  `));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const position = gl.getAttribLocation(program, 'position');
  const color = gl.getAttribLocation(program, 'color');
  const positionBuffer = gl.createBuffer();
  const colorBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  gl.enableVertexAttribArray(position);
  gl.enableVertexAttribArray(color);
  gl.viewport(0, 0, 720, 540);
  let activeGroup;
  let indices;
  let indexType;
  let pigments;
  let basePositions;
  let warpedPositions;

  return {
    canvas,
    draw(group, a, b, mix, scale = 1) {
      const width = Math.round(720 * scale), height = Math.round(540 * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      if (activeGroup !== group) {
        activeGroup = group;
        const points = [];
        const triangles = [];
        for (let y = 0; y < group.rows; y++) for (let x = 0; x < group.cols; x++) {
          points.push(group.x + x * group.step, group.y + y * group.step);
          if (x < group.cols - 1 && y < group.rows - 1) {
            const i = y * group.cols + x;
            // Alternate diagonals reduce visible directional shading in the mesh.
            if ((x + y) % 2) triangles.push(i, i + 1, i + group.cols, i + 1, i + group.cols + 1, i + group.cols);
            else triangles.push(i, i + 1, i + group.cols + 1, i, i + group.cols + 1, i + group.cols);
          }
        }
        if (group.cols * group.rows > 65535) {
          if (!gl.getExtension('OES_element_index_uint')) throw new Error('The detailed thermal mesh requires 32-bit element indices.');
          indices = new Uint32Array(triangles);
          indexType = gl.UNSIGNED_INT;
        } else {
          indices = new Uint16Array(triangles);
          indexType = gl.UNSIGNED_SHORT;
        }
        pigments = new Float32Array(group.cols * group.rows * 3);
        basePositions = new Float32Array(points);
        warpedPositions = new Float32Array(points.length);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, basePositions, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      }
      let nextColors = b.colors;
      let positions = basePositions;
      if (mix > 1e-6 && a.poseTransform) {
        const [m00, m01, tx, m10, m11, ty] = a.poseTransform;
        positions = warpedPositions;
        if (!a.transportedNextColors) {
          a.transportedNextColors = new Float32Array(pigments.length);
          for (let i = 0; i < basePositions.length; i += 2) {
            const x = basePositions[i], y = basePositions[i + 1];
            const gx = Math.max(0, Math.min(group.cols - 1, (m00 * x + m01 * y + tx - group.x) / group.step));
            const gy = Math.max(0, Math.min(group.rows - 1, (m10 * x + m11 * y + ty - group.y) / group.step));
            const left = Math.min(group.cols - 2, Math.floor(gx));
            const top = Math.min(group.rows - 2, Math.floor(gy));
            const u = gx - left, v = gy - top;
            const p = (top * group.cols + left) * 3;
            for (let c = 0; c < 3; c++) {
              const c00 = b.colors[p + c], c10 = b.colors[p + 3 + c];
              const c01 = b.colors[p + group.cols * 3 + c], c11 = b.colors[p + group.cols * 3 + 3 + c];
              a.transportedNextColors[i / 2 * 3 + c] = (c00 * (1 - u) + c10 * u) * (1 - v)
                + (c01 * (1 - u) + c11 * u) * v;
            }
          }
        }
        nextColors = a.transportedNextColors;
        for (let i = 0; i < basePositions.length; i += 2) {
          const x = basePositions[i], y = basePositions[i + 1];
          positions[i] = x + (m00 * x + m01 * y + tx - x) * mix;
          positions[i + 1] = y + (m10 * x + m11 * y + ty - y) * mix;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      for (let i = 0; i < pigments.length; i++) pigments[i] = (a.colors[i] + (nextColors[i] - a.colors[i]) * mix) / 255;
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, pigments, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 0, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, indices.length, indexType, 0);
    },
  };
}

export async function createThermal(url = new URL('../assets/thermal-data.json', import.meta.url)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Thermal geometry could not load (${response.status}).`);
  const data = await response.json();
  for (const group of [data.head, data.hand, data.transition].filter(Boolean)) {
    if (group.colorEncoding === 'base64-rgb8') for (const frame of group.frames) {
      const encoded = atob(frame.colors);
      frame.colors = Uint8Array.from(encoded, byte => byte.charCodeAt(0));
    }
  }
  const rimLayers = await Promise.all([createThermalRims(data),createThermalRims(data,new URL('../assets/thermal-hand-rims.json',import.meta.url))]);
  const rims={outline:frame=>rimLayers.map(layer=>layer.outline(frame)).find(Boolean),draw(ctx,frame){for(const layer of rimLayers)layer.draw(ctx,frame);}};
  const mesh = makeMeshRenderer();
  const articulated = await createThermalMotion(data);
  const refinedPen = await createThermalPen();
  const exteriorLights = await createThermalLights();
  const exitEdge = await createThermalExitEdge(data);
  // Cache only fields generated by the editable mesh. The silhouette stays a
  // live vector clip. This avoids synchronous WebGL → Canvas readback on rAF.
  for (const group of [data.head, data.hand, data.transition].filter(Boolean)) {
    for (const frame of group.frames) {
      mesh.draw(group, frame, frame, 0, 1);
      frame.fieldBitmap = await createImageBitmap(mesh.canvas);
    }
  }
  const layer = document.createElement('canvas');
  layer.width = 720;
  layer.height = 540;
  const painter = layer.getContext('2d');
  const strokeLayers = new Map();
  const renderer = {
    data,
    draw(ctx, frame, options = {}) {
      const group = [data.head, data.hand, data.transition].filter(Boolean).find(
        scene => frame >= scene.start && frame < scene.start + scene.frames.length,
      );
      if (!group) return false;
      exteriorLights.draw(ctx, frame);
      if (options.rims !== false) exitEdge.begin(ctx, frame);
      const local = Math.max(0, frame - group.start);
      const index = Math.floor(local);
      const a = group.frames[index];
      const b = group.frames[Math.min(index + 1, group.frames.length - 1)];
      const mix = options.interpolate === false || group === data.transition ? 0 : local - index;
      const transform = ctx.getTransform();
      const scale = Math.max(1, Math.hypot(transform.a, transform.b));
      const articulatedField = options.articulated !== false && articulated.has(frame);
      const cachedField = !articulatedField && scale <= 2 && a.fieldBitmap && b.fieldBitmap;
      if (articulatedField) articulated.draw(frame, scale <= 2 ? 1 : scale);
      else if (!cachedField) mesh.draw(group, a, b, mix, scale);
      const layerWidth = Math.round(720 * scale), layerHeight = Math.round(540 * scale);
      if (layer.width !== layerWidth || layer.height !== layerHeight) {
        layer.width = layerWidth;
        layer.height = layerHeight;
      }
      painter.setTransform(scale, 0, 0, scale, 0, 0);
      painter.clearRect(0, 0, 720, 540);
      painter.save();
      painter.beginPath();
      if (a.clipPath) {
        // Transition icons are separate objects with open spaces between them.
        // Preserve their actual contours instead of filling their convex hull.
        a.compiledClipPath ||= new Path2D(a.clipPath);
        painter.clip(a.compiledClipPath, 'evenodd');
      } else {
      const outline = (options.rims !== false && rims.outline(frame)) || interpolateThermalOutline(a, b, mix);
      for (let i = 0; i < outline.length; i += 2) {
        let x = outline[i];
        let y = outline[i + 1];
        // Native contours follow the boundary pixel centers. A subpixel outward
        // offset restores their pixel coverage when rasterized as a vector path.
        const previous = (i + outline.length - 2) % outline.length;
        const next = (i + 2) % outline.length;
        const tx = outline[next] - outline[previous];
        const ty = outline[next + 1] - outline[previous + 1];
        const distance = Math.hypot(tx, ty) || 1;
        const expansion = options.outlineExpansion ?? .2;
        x += ty / distance * expansion;
        y -= tx / distance * expansion;
        if (!i) painter.moveTo(x, y);
        else painter.lineTo(x, y);
      }
      painter.closePath();
      painter.clip();
      }
      if (cachedField) {
        const first = [1, 0, 0, 1, 0, 0], second = [1, 0, 0, 1, 0, 0];
        if (mix > 1e-6 && a.poseTransform) {
          const [a00, a01, ax, a10, a11, ay] = a.poseTransform;
          first[0] = 1 + (a00 - 1) * mix; first[1] = a10 * mix;
          first[2] = a01 * mix; first[3] = 1 + (a11 - 1) * mix;
          first[4] = ax * mix; first[5] = ay * mix;
          const determinant = a00 * a11 - a01 * a10;
          const inverse = [a11 / determinant, -a10 / determinant, -a01 / determinant, a00 / determinant,
            (a01 * ay - a11 * ax) / determinant, (a10 * ax - a00 * ay) / determinant];
          second[0] = first[0] * inverse[0] + first[2] * inverse[1];
          second[1] = first[1] * inverse[0] + first[3] * inverse[1];
          second[2] = first[0] * inverse[2] + first[2] * inverse[3];
          second[3] = first[1] * inverse[2] + first[3] * inverse[3];
          second[4] = first[0] * inverse[4] + first[2] * inverse[5] + first[4];
          second[5] = first[1] * inverse[4] + first[3] * inverse[5] + first[5];
        }
        const paintField = (bitmap, transform, opacity) => {
          if (opacity <= 0) return;
          painter.save();
          painter.transform(...transform);
          painter.globalAlpha = opacity;
          painter.drawImage(bitmap, 0, 0, 720, 540);
          painter.restore();
        };
        paintField(a.fieldBitmap, first, 1 - mix);
        if (mix > 0) {
          painter.globalCompositeOperation = 'lighter';
          paintField(b.fieldBitmap, second, mix);
        }
      } else painter.drawImage(articulatedField ? articulated.canvas : mesh.canvas, 0, 0, 720, 540);
      painter.restore();
      const onsetInk = group === data.hand && local < 2;
      if (onsetInk && options.strokes !== false) renderer.drawStrokes(ctx, frame, options.exact);
      ctx.save();
      // The opening thermal exposures are deliberately defocused in the film.
      const blur = options.blur ?? (group === data.head && local < 6 ? 2.6 - local * .35
        : group === data.hand && local < 2 ? 4.5 - local * 1.6
        : group === data.hand && local < 7 ? 1.5 - local * .16 : .35);
      ctx.filter = `blur(${Math.max(0, blur) * scale}px)`;
      ctx.globalAlpha *= options.opacity ?? 1;
      ctx.drawImage(layer, 0, 0, 720, 540);
      ctx.restore();
      if (options.rims !== false) {
        ctx.save();
        ctx.globalAlpha *= options.opacity ?? 1;
        rims.draw(ctx, frame);
        ctx.restore();
      }
      if (!onsetInk && options.strokes !== false) renderer.drawStrokes(ctx, frame, options.exact);
      if (options.rims !== false) exitEdge.draw(ctx, frame);
      return true;
    },
    drawStrokes(ctx, frame, exact = false) {
      if (!data.strokes) return;
      const whole = Math.floor(frame), blend = frame - whole;
      refinedPen.drawMotion(ctx, frame);
      const strokeFrame = (sample, opacity) => {
        const bands = data.strokes[String(sample)]?.filter((_, index) => !refinedPen.omitBand(sample, index));
        if (opacity <= 0) return;
        ctx.save();
        ctx.globalAlpha *= opacity;
        if (refinedPen.draw(ctx, sample)) { ctx.restore(); return; }
        if (!bands) { ctx.restore(); return; }
        const transform = ctx.getTransform();
        const scale = Math.hypot(transform.a, transform.b);
        const softness = sample >= 332 && sample < 340 ? 3.2 - (sample - 332) * .3 : sample >= 377 ? .65 : .18;
        if (sample !== 332 && sample !== 333) {
          // Retain the precise export path; during playback reuse the generated
          // filtered ink, rather than enqueueing every blur for every refresh.
          if (scale <= 2 && !exact) {
            const key = `filtered:${sample}/${scale}`;
            let surface = strokeLayers.get(key);
            if (!surface) {
              surface = document.createElement('canvas');surface.width=Math.round(720*scale);surface.height=Math.round(540*scale);
              const ink=surface.getContext('2d');ink.setTransform(scale,0,0,scale,0,0);ink.filter=`blur(${softness*scale}px)`;
              for(const band of bands){ink.beginPath();for(let i=0;i<band.points.length;i+=2){if(!i)ink.moveTo(band.points[i],band.points[i+1]);else ink.lineTo(band.points[i],band.points[i+1])}ink.closePath();ink.fillStyle=`rgb(${band.color.join(',')})`;ink.fill()}
              strokeLayers.set(key,surface);while(strokeLayers.size>12)strokeLayers.delete(strokeLayers.keys().next().value);
            }
            ctx.filter='none';ctx.drawImage(surface,0,0,720,540);ctx.restore();return;
          }
          ctx.filter = `blur(${softness * scale}px)`;
          for (const band of bands) {
            ctx.beginPath();
            for (let i = 0; i < band.points.length; i += 2) {
              if (!i) ctx.moveTo(band.points[i], band.points[i + 1]);
              else ctx.lineTo(band.points[i], band.points[i + 1]);
            }
            ctx.closePath();ctx.fillStyle = `rgb(${band.color.join(',')})`;ctx.fill();
          }
          ctx.restore();return;
        }
        const key = `${sample}/${scale}`;
        let surface = strokeLayers.get(key);
        if (!surface) {
          surface = document.createElement('canvas');
          surface.width = Math.round(720 * scale);
          surface.height = Math.round(540 * scale);
          const ink = surface.getContext('2d');
          ink.setTransform(scale, 0, 0, scale, 0, 0);
          for (const band of bands) {
            ink.beginPath();
            for (let i = 0; i < band.points.length; i += 2) {
              if (!i) ink.moveTo(band.points[i], band.points[i + 1]);
              else ink.lineTo(band.points[i], band.points[i + 1]);
            }
            ink.closePath();
            ink.fillStyle = `rgb(${band.color.join(',')})`;
            ink.fill();
          }
          strokeLayers.set(key, surface);
          while (strokeLayers.size > (scale > 2 ? 3 : 12)) strokeLayers.delete(strokeLayers.keys().next().value);
        }
        ctx.filter = `blur(${softness * scale}px)`;
        ctx.drawImage(surface, 0, 0, 720, 540);
        ctx.restore();
      };
      strokeFrame(whole, 1 - blend);
      if (blend) strokeFrame(whole + 1, blend);
    },
  };
  instance = renderer;
  return renderer;
}

/** Call after await createThermal(); frame uses the source's zero-based cadence. */
export function drawThermal(ctx, frame, options) {
  if (!instance) throw new Error('Call await createThermal() before drawThermal().');
  return instance.draw(ctx, frame, options);
}
