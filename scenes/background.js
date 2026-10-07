/**
 * Procedural film-paper illumination.
 *
 * The source footage is not loaded by this module. Its compact animation data
 * consists of RGB lighting values at 12 × 9 control points, fitted with the
 * subjects excluded. A smooth tensor cubic surface and analytic transition
 * glows supply the illumination. Four reusable paper residual textures are
 * temporal aggregates with foreground regions excluded and inpainted.
 */
import {isRecoveredGrainReady} from './recovered-grain.js';
import {createBackgroundPrecomputer} from './background-fast.js';
let fit;
let surface;
let surfaceContext;
let surfacePixels;
let previousFrame = -1;
let grainCanvas;
let grainContext;
let grainPixels;
let previousGrain = -1;
let xIndices, yIndices, xWeights, yWeights;
const paperTextures = {};
const lowPaperTextures = {};
let lensGrainFields;
let openingGrainFields;
let backgroundPrecomputer;
const frameCache = new Map();
let frameSurface;
const SW = 240, SH = 180;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export async function createBackground() {
  if (!fit) {
    const response = await fetch(new URL('../assets/background-data.json', import.meta.url));
    if (!response.ok) throw new Error(`Cannot load background fit (${response.status})`);
    fit = await response.json();
    surface = document.createElement('canvas');
    surface.width = SW;
    surface.height = SH;
    surfaceContext = surface.getContext('2d');
    surfacePixels = surfaceContext.createImageData(SW, SH);
    grainCanvas = document.createElement('canvas');
    grainCanvas.width = 360;
    grainCanvas.height = 270;
    grainContext = grainCanvas.getContext('2d');
    grainPixels = grainContext.createImageData(360, 270);
    [xIndices, xWeights] = interpolationAxis(SW, fit.columns);
    [yIndices, yWeights] = interpolationAxis(SH, fit.rows);
    lensGrainFields = Array.from({length: 4}, (_, channel) => makeGrainField(channel));
    openingGrainFields = Array.from({length: 4}, (_, channel) => makeGrainField(channel + 4, .5));
    await Promise.all(['intro', 'icons', 'outro', 'dark'].map(async name => {
      const image = new Image();
      image.src = new URL(`../assets/paper-${name}.png`, import.meta.url).href;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 720; canvas.height = 540;
      const context = canvas.getContext('2d', {willReadFrequently: true});
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, 720, 540).data;
      const residual = new Float32Array(720 * 540);
      for (let p = 0; p < residual.length; p++) residual[p] = (pixels[p * 4] - 128) / 16;
      paperTextures[name] = residual;
      lowPaperTextures[name] = lowPassPaper(residual);
    }));
    backgroundPrecomputer = await createBackgroundPrecomputer({fit,xIndices,yIndices,xWeights,yWeights,paperTextures,lowPaperTextures,lensGrainFields,openingGrainFields});
  }
  return { drawBackground, drawGrain };
}

function hash(x, y, seed) {
  let n = Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + Math.imul(seed + 1, 69069);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Correlated colored film grain. Its spectrum and RMS are measured from
// foreground-free native/area-downsampled patches of the lens transition.
// A reusable procedural field changes phase each source frame.
function makeGrainField(channel, smoothPower = .76) {
  const side = 256, field = new Float32Array(side * side);
  const weights = [.25, .5, .25];
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    let smooth = 0;
    for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) {
      smooth += (hash((x + xx - 1) & 255, (y + yy - 1) & 255, channel + 701) - .5)
        * Math.sqrt(12) * weights[xx] * weights[yy] / .375;
    }
    const fine = (hash(x, y, channel + 911) - .5) * Math.sqrt(12);
    field[y * side + x] = smooth * Math.sqrt(smoothPower) + fine * Math.sqrt(1 - smoothPower);
  }
  return field;
}

function lensGrainStrength(frame) {
  if (frame === 1) return 2.67 / 1.75;
  if (frame === 2) return 2.92 / 1.75;
  const n = frame + 1;
  const keys = [[51, 0], [52, 1.5], [60, 1.74], [70, 2.00], [83, 2.00], [89, 1.90], [90, 2.8], [91, 1.99], [93, .97]];
  for (let i = 1; i < keys.length; i++) if (n <= keys[i][0]) {
    const [a, av] = keys[i - 1], [b, bv] = keys[i];
    return (av + (bv - av) * (n - a) / (b - a)) / 1.75;
  }
  return 0;
}

function interpolationAxis(size, controlCount) {
  const indices = new Int16Array(size * 4), weights = new Float32Array(size * 4);
  for (let p = 0; p < size; p++) {
    const g = p / (size - 1) * (controlCount - 1), i = Math.floor(g), t = g - i;
    const t2 = t * t, t3 = t2 * t;
    const w = [-.5 * t + t2 - .5 * t3, 1 - 2.5 * t2 + 1.5 * t3, .5 * t + 2 * t2 - 1.5 * t3, -.5 * t2 + .5 * t3];
    for (let j = 0; j < 4; j++) {
      indices[p * 4 + j] = clamp(i + j - 1, 0, controlCount - 1);
      weights[p * 4 + j] = w[j];
    }
  }
  return [indices, weights];
}

function lowPassPaper(input) {
  let field = input;
  for (let pass = 0; pass < 2; pass++) {
    const horizontal = new Float32Array(field.length), result = new Float32Array(field.length);
    for (let y = 0; y < 540; y++) {
      const row = y * 720; let sum = 0;
      for (let d = -3; d <= 3; d++) sum += field[row + clamp(d, 0, 719)];
      for (let x = 0; x < 720; x++) { horizontal[row + x] = sum / 7; sum += field[row + Math.min(719, x + 4)] - field[row + Math.max(0, x - 3)]; }
    }
    for (let x = 0; x < 720; x++) {
      let sum = 0; for (let d = -3; d <= 3; d++) sum += horizontal[clamp(d, 0, 539) * 720 + x];
      for (let y = 0; y < 540; y++) { result[y * 720 + x] = sum / 7; sum += horizontal[Math.min(539, y + 4) * 720 + x] - horizontal[Math.max(0, y - 3) * 720 + x]; }
    }
    field = result;
  }
  return field;
}

function textureFor(frame, recoveredReady) {
  const textures = recoveredReady ? lowPaperTextures : paperTextures;
  if (frame >= 419) return textures.outro;
  if (fit.frames[frame].k === 'paper') return textures[frame <= 47 ? 'intro' : 'icons'];
  if (fit.frames[frame].k === 'black') return textures.dark;
  return null;
}

function rasterize(frame, recoveredReady) {
  const f = fit.frames[frame], colors = f.c;
  const nx = fit.columns;
  const data = surfacePixels.data;
  const rowColors = new Float64Array(nx * 3);
  for (let y = 0; y < SH; y++) {
    for(let x=0;x<nx;x++)for(let c=0;c<3;c++){
      let value=0;for(let yy=0;yy<4;yy++)value+=colors[(yIndices[y*4+yy]*nx+x)*3+c]*yWeights[y*4+yy];
      rowColors[x*3+c]=value;
    }
    for (let x = 0; x < SW; x++) {
      const p = (y * SW + x) * 4;
      // Independent noise adds visible grain with no correlation to the film.
      // Keep the illumination clean; a recovered reusable paper residual is
      // applied separately where the source has a demonstrably fixed texture.
      const grain = 0;
      let r = grain, g = grain, b = grain;
      for (let xx = 0; xx < 4; xx++) {
        const j = xIndices[x * 4 + xx] * 3, w = xWeights[x * 4 + xx];
        r += rowColors[j] * w; g += rowColors[j + 1] * w; b += rowColors[j + 2] * w;
      }
      data[p] = r; data[p + 1] = g; data[p + 2] = b;
      data[p + 3] = 255;
    }
  }
  surfaceContext.putImageData(surfacePixels, 0, 0);
  const texture = textureFor(frame, recoveredReady);
  const lensGrain = !recoveredReady && (frame === 1 || frame === 2 || (frame >= 51 && frame <= 92));
  const cached = document.createElement('canvas');
  cached.width = texture || lensGrain ? 720 : SW;
  cached.height = texture || lensGrain ? 540 : SH;
  const cachedContext = cached.getContext('2d', {willReadFrequently: !!texture || lensGrain});
  cachedContext.imageSmoothingEnabled = true;
  cachedContext.imageSmoothingQuality = 'high';
  cachedContext.drawImage(surface, 0, 0, cached.width, cached.height);
  if (texture || lensGrain) {
    const imageData = cachedContext.getImageData(0, 0, 720, 540), pixels = imageData.data;
    const strength = lensGrain ? lensGrainStrength(frame) : 0;
    const grainFields = frame < 3 ? openingGrainFields : lensGrainFields;
    const offsetX = (frame * 137) & 255, offsetY = (frame * 79) & 255;
    for (let p = 0; p < 720 * 540; p++) {
      const j = p * 4, delta = texture ? texture[p] : 0;
      let r = delta, g = delta, b = delta;
      if (lensGrain) {
        const x = p % 720, y = (p / 720) | 0;
        const index = (((y + offsetY) & 255) * 256) + ((x + offsetX) & 255);
        const illumination = frame < 3 ? 1 : .6 + .4 * Math.min(1, (pixels[j] * .2126 + pixels[j + 1] * .7152 + pixels[j + 2] * .0722) / 220);
        const amplitude = strength * illumination;
        const shared = grainFields[0][index] * 1.63;
        r += amplitude * (shared + grainFields[1][index] * .55);
        g += amplitude * (shared + grainFields[2][index] * .88);
        b += amplitude * (shared + grainFields[3][index] * 1.45);
      }
      pixels[j] += r; pixels[j + 1] += g; pixels[j + 2] += b;
    }
    cachedContext.putImageData(imageData, 0, 0);
  }
  frameSurface = cached;
  const cacheKey = `${frame}:${recoveredReady ? 1 : 0}`;
  frameCache.set(cacheKey, cached);
  if (frameCache.size > 48) {
    const oldest = frameCache.keys().next().value;
    const evicted = frameCache.get(oldest);
    frameCache.delete(oldest);
    evicted.width = evicted.height = 1;
  }
  previousFrame = cacheKey;
}

export function drawBackground(ctx, zeroBasedFrame, exact = false) {
  if (!fit) throw new Error('Call and await createBackground() before drawing.');
  const frame = clamp(Math.floor(zeroBasedFrame + 1e-5), 0, fit.frames.length - 1);
  const recoveredReady = isRecoveredGrainReady(frame, exact);
  if (!exact) backgroundPrecomputer?.prefetch(frame);
  const preparedSurface=exact?null:backgroundPrecomputer?.get(frame,recoveredReady);
  const cacheKey = `${frame}:${recoveredReady ? 1 : 0}`;
  if (!preparedSurface && cacheKey !== previousFrame) {
    if (frameCache.has(cacheKey)) {
      frameSurface = frameCache.get(cacheKey);
      previousFrame = cacheKey;
    } else rasterize(frame, recoveredReady);
  }
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(preparedSurface||frameSurface, 0, 0, 720, 540);
  // Interpolate the measured lighting within each rotating row, keeping scene cuts and all native poses exact.
  const rowEnd=zeroBasedFrame>=220&&zeroBasedFrame<237?236:zeroBasedFrame>=253&&zeroBasedFrame<265?264:null;
  const next=rowEnd==null?frame:Math.min(frame+1,rowEnd),fraction=zeroBasedFrame-frame;
  if(next!==frame&&fraction>1e-7){
    const nextKey=`${next}:${recoveredReady?1:0}`;
    let nextSurface=exact?null:backgroundPrecomputer?.get(next,recoveredReady);
    if(!nextSurface){nextSurface=frameCache.get(nextKey);if(!nextSurface){rasterize(next,recoveredReady);nextSurface=frameSurface;}}
    ctx.globalAlpha=Math.min(1,fraction);ctx.drawImage(nextSurface,0,0,720,540);ctx.globalAlpha=1;
  }
  // Two iris transitions have a luminous central field hidden by the subject.
  // Its inferred falloff is represented as a radial lighting primitive.
  if (frame === 331) {
    // Foreground-excluded fit of the closing iris. These nine parameters
    // describe only a smooth elliptical illumination field, not its subjects.
    ctx.save();
    ctx.translate(358.12235662, 273.13021791);
    ctx.rotate(0.37894116);
    ctx.scale(66.34888598, 69.88475856);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 2.3);
    for (let i = 0; i <= 96; i++) {
      const radius = i / 96 * 2.3;
      const alpha = i === 96 ? 0 : Math.exp(-Math.pow(radius, 3.40441920));
      glow.addColorStop(i / 96, `rgba(217.46531002,215.17777738,216.99199887,${alpha})`);
    }
    ctx.fillStyle = glow;
    ctx.fillRect(-2.3, -2.3, 4.6, 4.6);
    ctx.restore();
  }
  // The LOVE record light travels with its continuously animated icon pass.

  ctx.restore();
}

/** Optional final film grain pass, drawn over the complete assembled scene. */
export function drawGrain(ctx, zeroBasedFrame, amount = 0) {
  if (!fit || amount <= 0) return;
  const frame = clamp(Math.floor(zeroBasedFrame + 1e-5), 0, fit.frames.length - 1);
  if (previousGrain !== frame) {
    const data = grainPixels.data;
    const strength = clamp(fit.frames[frame].g * 2.4, 1, 7);
    for (let y = 0; y < 270; y++) for (let x = 0; x < 360; x++) {
      const p = (y * 360 + x) * 4;
      const value = 128 + (hash(x, y, frame * 13 + 41) - .5) * strength;
      data[p] = data[p + 1] = data[p + 2] = value;
      data[p + 3] = 255;
    }
    grainContext.putImageData(grainPixels, 0, 0);
    previousGrain = frame;
  }
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = clamp(amount, 0, 1);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(grainCanvas, 0, 0, 720, 540);
  ctx.restore();
}

export function backgroundKind(zeroBasedFrame) {
  return fit?.frames[clamp(Math.floor(zeroBasedFrame + 1e-5), 0, 488)]?.k;
}

export async function prepareBackgroundFrames(zeroBasedFrame=0,count=6) {
  await backgroundPrecomputer?.prime(zeroBasedFrame,count);
}
export function backgroundPerformanceStats() {return backgroundPrecomputer?.stats()||{failed:true};}
