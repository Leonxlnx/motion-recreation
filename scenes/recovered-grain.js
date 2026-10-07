/**
 * Recovered stochastic film grain, separated from source image content.
 * Assets contain normalized scalar or RGB stochastic noise; object/text edges are excluded,
 * missing regions filled with flat grain-only patches, and local mean/RMS reset.
 * Smooth material RMS/correlation fields control recoloring. Lighting, silhouettes,
 * text and artwork remain in the procedural scene code.
 */
let manifest, readyPromise, compositor;
let textureWidth = 2880;
let useAmplitudeFields = true;
const cache = new Map(), pending = new Map(), queue = [];
const CACHE_LIMIT = 16, LOAD_LIMIT = 3;
let loading = 0;
const frameNumber = f => Math.max(1, Math.min(489, Math.floor(f + 1e-5) + 1));
const frameLayers = f => manifest?.frames[String(frameNumber(f))]?.layers || [];
const layerSource = (layer, exact = false) => !exact && textureWidth <= 1440 && layer.previewFile ? layer.previewFile : layer.file;

export async function createRecoveredGrain(targetWidth = 2880) {
  if (!readyPromise) {
    textureWidth = Math.max(72, Math.min(2880, Math.round(targetWidth)));
    readyPromise = (async () => {
    const response = await fetch(new URL('../assets/grain/manifest.json', import.meta.url));
    if (!response.ok) throw new Error(`Cannot load recovered grain manifest (${response.status})`);
    manifest = await response.json();
    compositor = makeCompositor();
    return manifest;
    })();
  }
  return readyPromise;
}

/** The optional model14 scope uses the actual prepared clapper artwork alpha.
 * Positive scope replaces its material; negative scope keeps the other actors.
 * Mode2 damps steep rendered edges; mode3 also uses a luminance response.
 */
export function needsClapperMaterialMask(zeroBasedFrame) {
  return frameLayers(zeroBasedFrame).some(layer => layer.model[0] === 14 && Math.abs(layer.model[3]) > .5);
}

export function cellMaterialNeedsClapperScope(f){const layers=frameLayers(f);return !layers.some(l=>l.model[0]===14&&l.model[3]>1.5)||layers.some(l=>l.model[0]===14&&l.model[3]>.5&&l.model[3]<1.5);}
export function getCellMaterialActors(f){const selected=frameLayers(f).find(l=>l.model[0]===14&&l.model[3]>1.5);return selected?.cellActors||[];}
export function getPreservedCellMaterialActors(f){const selected=frameLayers(f).find(l=>l.model[0]===14&&l.model[3]>1.5);return selected?.cellActorsPreserve||[];}
export function needsPlantCashMaterialMask(f) {return frameLayers(f).some(l=>l.model[0]===14&&Math.abs(l.model[3])>1.5);}
function touch(key) {
  const image = cache.get(key);
  if (image) { cache.delete(key); cache.set(key, image); }
  return image;
}

function pump() {
  while (loading < LOAD_LIMIT && queue.length) {
    const job = queue.shift(); loading++;
    (async () => {
      const sourceFile = job.key;
      const usePreview = sourceFile !== job.layer.file;
      const sourceWidth = usePreview ? (job.layer.previewWidth || 1440) : manifest.width;
      const response = await fetch(new URL(`../assets/grain/${sourceFile}`, import.meta.url));
      if (!response.ok) throw new Error(`Cannot load grain ${job.layer.file} (${response.status})`);
      const options = {colorSpaceConversion: 'none', imageOrientation: 'flipY'};
      if (textureWidth < sourceWidth) Object.assign(options, {resizeWidth: textureWidth, resizeHeight: Math.round(textureWidth * manifest.height / manifest.width), resizeQuality: 'high'});
      const bitmap = await createImageBitmap(await response.blob(), options);
      cache.set(job.key, bitmap);
      while (cache.size > CACHE_LIMIT) {
        const key = cache.keys().next().value;
        cache.get(key).close(); cache.delete(key);
      }
      return bitmap;
    })().then(job.resolve, job.reject).finally(() => {
      loading--; pending.delete(job.key); pump();
    });
  }
}

function loadLayer(layer, priority, frame, required = false, exact = false) {
  const key = layerSource(layer, exact);
  const cached = touch(key);
  if (cached) return Promise.resolve(cached);
  if (pending.has(key)) {if(required){const job=queue.find(job=>job.key===key);if(job)job.required=true;}return pending.get(key);}
  const promise = new Promise((resolve, reject) => {
    const job = {layer, key, resolve, reject, frame, required};
    priority ? queue.unshift(job) : queue.push(job);
  });
  pending.set(key, promise); pump(); return promise;
}

export async function prepareGrain(zeroBasedFrame, {exact = false} = {}) {
  await createRecoveredGrain();
  const layers = frameLayers(zeroBasedFrame);
  await Promise.all(layers.map(layer => loadLayer(layer, true, frameNumber(zeroBasedFrame), true, exact)));
  return layers.length > 0;
}

export function prefetchGrain(zeroBasedFrame) {
  if (!manifest) return;
  const current = Math.floor(zeroBasedFrame + 1e-5);
  // Playback advances while textures decode. Drop obsolete queued work so it
  // cannot keep the visible frame waiting behind frames already missed.
  for(let i=queue.length-1;i>=0;i--){const job=queue[i];if(!job.required&&(job.frame<current||job.frame>current+9)){queue.splice(i,1);pending.delete(job.key);job.reject(new DOMException('Prefetch is outside the playback window.','AbortError'));}}
  for (let offset = 0; offset <= 4; offset++) {
    for (const layer of frameLayers(current + offset)) {
      if (offset===0||pending.size<8)loadLayer(layer,offset===0,frameNumber(current+offset)).catch(() => {});
    }
  }
}

export function isRecoveredGrainReady(zeroBasedFrame, exact = false) {
  const layers = frameLayers(zeroBasedFrame);
  return layers.length > 0 && layers.every(layer => cache.has(layerSource(layer, exact)));
}

function makeCompositor() {
  const maximumLayers = 4;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true});
  if (!gl) throw new Error('WebGL 2 is required for recovered film grain.');
  const compile = (type, source) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, '#version 300 es\nin vec2 position; out vec2 uv; void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}');
  const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    in vec2 uv;
    out vec4 fragmentColor;
    uniform sampler2D baseImage,sourceArtImage;uniform float sourceArtStrength;
    ${Array.from({length:maximumLayers},(_,i)=>`uniform sampler2D grain${i},amplitudeMap${i},covarianceMap${i};uniform vec4 model${i};uniform vec3 gain${i};uniform vec2 amplitudeSize${i},covarianceSize${i},luminanceBand${i};uniform float phaseUnits${i};`).join('\n')}
    uniform float layerCount;
    uniform float amplitudeFields;
    float amplitude(vec3 rgb, vec4 model) {
      vec3 c=rgb*255.; float lo=min(c.r,min(c.g,c.b)), hi=max(c.r,max(c.g,c.b));
      float mean=(c.r+c.g+c.b)/3., chroma=hi-lo;
      if(model.x<.5) return model.y*(.6+.4*min(1.,mean/220.))*(1.-smoothstep(25.,65.,chroma))*smoothstep(15.,50.,hi);
      if(model.x<1.5) return model.y*min(1.,hi/220.);
      if(model.x<2.5) return max(0.,model.y+model.z*min(mean,255.-mean)/128.)*clamp((hi-35.)/35.,0.,1.)*(model.w>.5?smoothstep(20.,35.,chroma):1.);
      return model.y*(1.-smoothstep(40.,75.,hi));
    }
    float fieldAmplitude(vec3 rgb, vec4 model, float rms) {
      vec3 c=rgb*255.;float lo=min(c.r,min(c.g,c.b)),hi=max(c.r,max(c.g,c.b));
      if(model.x<.5){float fitted=rms*(1.-smoothstep(25.,65.,hi-lo))*smoothstep(15.,50.,hi);return mix(amplitude(rgb,model),fitted,smoothstep(100.,150.,(c.r+c.g+c.b)/3.));}
      if(model.x<1.5)return amplitude(rgb,model);
      return rms*(1.-smoothstep(40.,75.,hi));
    }
    vec3 materialAmplitude(vec3 rgb,vec4 model,vec3 gain,vec3 field,bool hasField){if(model.x>13.5&&model.x<14.5){vec3 c=rgb*255.,rms=hasField?field:vec3(model.y)*gain;return rms*(model.z>.5?1.:smoothstep(25.,45.,max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b))));}
      if(model.x>14.5&&model.x<15.5){
        vec3 c=rgb*255.;float hi=max(c.r,max(c.g,c.b)),lo=min(c.r,min(c.g,c.b)),mean=(c.r+c.g+c.b)/3.;
        vec3 rms=hasField?mix(vec3(model.y)*gain*(.6+.4*min(1.,mean/220.)),field,smoothstep(100.,150.,mean)):vec3(model.y)*gain;
        return rms*(1.-smoothstep(25.,65.,hi-lo))*smoothstep(15.,50.,hi)*texture(sourceArtImage,uv).a*sourceArtStrength;
      }
      // Preserve material noise inside the color field while damping it at
      // steep procedural boundaries where texture phase cannot be retained.
      if(model.x>12.5&&model.x<13.5){
        vec2 dx=vec2(3./720.,0.),dy=vec2(0.,3./540.);
        vec3 horizontal=abs(texture(baseImage,uv+dx).rgb-texture(baseImage,uv-dx).rgb)*255.;
        vec3 vertical=abs(texture(baseImage,uv+dy).rgb-texture(baseImage,uv-dy).rgb)*255.;
        vec3 change=max(horizontal,vertical);
        float edge=max(change.r,max(change.g,change.b));
        return vec3(amplitude(rgb,vec4(2.,model.yzw)))*gain*(1.-smoothstep(3.,96.,edge));
      }
      if(model.x<3.5)return hasField?vec3(fieldAmplitude(rgb,model,field.r))*gain:vec3(amplitude(rgb,model))*gain;
      vec3 c=rgb*255.;float hi=max(c.r,max(c.g,c.b)),lo=min(c.r,min(c.g,c.b)),mean=(c.r+c.g+c.b)/3.;
      vec3 rms=hasField?field:vec3(model.y)*gain;float gate=1.;
      if(model.x<4.5){gate=(1.-smoothstep(15.,35.,c.b-c.r))*smoothstep(12.,35.,hi);if(model.w>0.){if(model.z>0.)gate*=smoothstep(model.z-10.,model.z+10.,mean);if(model.w<255.)gate*=1.-smoothstep(model.w-10.,model.w+10.,mean);}else gate*=min(1.,mean/130.);}
      else if(model.x<5.5)gate=smoothstep(15.,40.,c.b-c.r);
      else if(model.x<6.5){gate=(1.-smoothstep(25.,65.,hi-lo))*smoothstep(15.,50.,hi);if(hasField)rms=mix(vec3(model.y)*gain*(.6+.4*min(1.,mean/220.)),rms,smoothstep(100.,150.,mean));}
      else if(model.x<7.5)gate=1.-smoothstep(40.,75.,hi);
      else if(model.x<8.5)gate=min(1.,hi/220.);
      else if(model.x<9.5)gate=1.-smoothstep(20.,35.,hi-lo);
      else if(model.x<10.5)gate=smoothstep(25.,65.,hi-lo)*clamp((hi-35.)/35.,0.,1.);
      else if(model.x<11.5)gate=1.-smoothstep(15.,35.,c.b-c.r);
      else gate=smoothstep(165.,195.,c.r)*(1.-smoothstep(32.,50.,c.b))*(1.-smoothstep(55.,80.,c.g));
      return rms*gate;
    }
    void main() {
      vec3 base=texture(baseImage,uv).rgb;
      vec3 result=base;float sourceArt=texture(sourceArtImage,uv).a*sourceArtStrength;
      ${Array.from({length:maximumLayers},(_,i)=>`if(layerCount>${i}.5){vec3 noise=(texture(grain${i},uv).rgb*255.-128.)/24.;if(phaseUnits${i}>0.)noise*=24./phaseUnits${i};bool field=amplitudeFields>.5&&amplitudeSize${i}.x>1.;vec3 rms=field?texture(amplitudeMap${i},(uv*(amplitudeSize${i}-1.)+.5)/amplitudeSize${i}).rgb*16.:vec3(0.);if(covarianceSize${i}.x>1.){vec3 rho=texture(covarianceMap${i},(uv*(covarianceSize${i}-1.)+.5)/covarianceSize${i}).rgb*2.-1.;float d=sqrt(max(.015,1.-rho.r*rho.r)),bg=(rho.b-rho.r*rho.g)/d,bd=sqrt(max(.015,1.-rho.g*rho.g-bg*bg));noise=vec3(noise.r,rho.r*noise.r+d*noise.g,rho.g*noise.r+bg*noise.g+bd*noise.b);}float luma=(base.r+base.g+base.b)*85.,band=1.;if(luminanceBand${i}.x>0.)band*=smoothstep(luminanceBand${i}.x-10.,luminanceBand${i}.x+10.,luma);if(luminanceBand${i}.y<255.)band*=1.-smoothstep(luminanceBand${i}.y-10.,luminanceBand${i}.y+10.,luma);result+=noise*materialAmplitude(base,model${i},gain${i},rms,field)*band*(model${i}.x>13.5&&model${i}.x<14.5?sourceArt:1.)*(1.-sourceArt*(((model${i}.x>1.5&&model${i}.x<2.5)||(model${i}.x>4.5&&model${i}.x<5.5)||(model${i}.x>9.5&&model${i}.x<10.5)||model${i}.x>11.5)?0.:1.))/255.;}`).join('\n')}
      fragmentColor=vec4(clamp(result,0.,1.),1.);
    }
  `);
  const scopedFragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    in vec2 uv;
    out vec4 fragmentColor;
    uniform sampler2D baseImage,sourceArtImage;uniform float sourceArtStrength;
    ${Array.from({length:maximumLayers},(_,i)=>`uniform sampler2D grain${i},amplitudeMap${i},covarianceMap${i};uniform vec4 model${i};uniform vec3 gain${i};uniform vec2 amplitudeSize${i},covarianceSize${i},luminanceBand${i};uniform float phaseUnits${i};`).join('\n')}
    uniform float layerCount;
    uniform float amplitudeFields;
    float amplitude(vec3 rgb, vec4 model) {
      vec3 c=rgb*255.; float lo=min(c.r,min(c.g,c.b)), hi=max(c.r,max(c.g,c.b));
      float mean=(c.r+c.g+c.b)/3., chroma=hi-lo;
      if(model.x<.5) return model.y*(.6+.4*min(1.,mean/220.))*(1.-smoothstep(25.,65.,chroma))*smoothstep(15.,50.,hi);
      if(model.x<1.5) return model.y*min(1.,hi/220.);
      if(model.x<2.5) return max(0.,model.y+model.z*min(mean,255.-mean)/128.)*clamp((hi-35.)/35.,0.,1.)*(model.w>.5?smoothstep(20.,35.,chroma):1.);
      return model.y*(1.-smoothstep(40.,75.,hi));
    }
    float fieldAmplitude(vec3 rgb, vec4 model, float rms) {
      vec3 c=rgb*255.;float lo=min(c.r,min(c.g,c.b)),hi=max(c.r,max(c.g,c.b));
      if(model.x<.5){float fitted=rms*(1.-smoothstep(25.,65.,hi-lo))*smoothstep(15.,50.,hi);return mix(amplitude(rgb,model),fitted,smoothstep(100.,150.,(c.r+c.g+c.b)/3.));}
      if(model.x<1.5)return amplitude(rgb,model);
      return rms*(1.-smoothstep(40.,75.,hi));
    }
    vec3 materialAmplitude(vec3 rgb,vec4 model,vec3 gain,vec3 field,bool hasField){if(model.x>13.5&&model.x<14.5){vec3 c=rgb*255.,rms=hasField?field:vec3(model.y)*gain;float gate=1.;if(model.z>1.5){vec2 p=vec2(.5/720.,.5/540.);vec3 gx=abs(texture(baseImage,uv+vec2(p.x,0.)).rgb-texture(baseImage,uv-vec2(p.x,0.)).rgb),gy=abs(texture(baseImage,uv+vec2(0.,p.y)).rgb-texture(baseImage,uv-vec2(0.,p.y)).rgb);vec3 g=max(gx,gy);gate=1.-smoothstep(4.,24.,max(g.r,max(g.g,g.b))*255.);}if(model.z>2.5){float luma=(c.r+c.g+c.b)/3.;gate*=.15+.85*max(0.,min(luma,255.-luma))/128.;}return rms*(model.z>.5?1.:smoothstep(25.,45.,max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b))))*gate;}
      if(model.x>14.5&&model.x<15.5){
        vec3 c=rgb*255.;float hi=max(c.r,max(c.g,c.b)),lo=min(c.r,min(c.g,c.b)),mean=(c.r+c.g+c.b)/3.;
        vec3 rms=hasField?mix(vec3(model.y)*gain*(.6+.4*min(1.,mean/220.)),field,smoothstep(100.,150.,mean)):vec3(model.y)*gain;
        return rms*(1.-smoothstep(25.,65.,hi-lo))*smoothstep(15.,50.,hi)*texture(sourceArtImage,uv).a*sourceArtStrength;
      }
      // Preserve material noise inside the color field while damping it at
      // steep procedural boundaries where texture phase cannot be retained.
      if(model.x>12.5&&model.x<13.5){
        vec2 dx=vec2(3./720.,0.),dy=vec2(0.,3./540.);
        vec3 horizontal=abs(texture(baseImage,uv+dx).rgb-texture(baseImage,uv-dx).rgb)*255.;
        vec3 vertical=abs(texture(baseImage,uv+dy).rgb-texture(baseImage,uv-dy).rgb)*255.;
        vec3 change=max(horizontal,vertical);
        float edge=max(change.r,max(change.g,change.b));
        return vec3(amplitude(rgb,vec4(2.,model.yzw)))*gain*(1.-smoothstep(3.,96.,edge));
      }
      if(model.x<3.5)return hasField?vec3(fieldAmplitude(rgb,model,field.r))*gain:vec3(amplitude(rgb,model))*gain;
      vec3 c=rgb*255.;float hi=max(c.r,max(c.g,c.b)),lo=min(c.r,min(c.g,c.b)),mean=(c.r+c.g+c.b)/3.;
      vec3 rms=hasField?field:vec3(model.y)*gain;float gate=1.;
      if(model.x<4.5){gate=(1.-smoothstep(15.,35.,c.b-c.r))*smoothstep(12.,35.,hi);if(model.w>0.){if(model.z>0.)gate*=smoothstep(model.z-10.,model.z+10.,mean);if(model.w<255.)gate*=1.-smoothstep(model.w-10.,model.w+10.,mean);}else gate*=min(1.,mean/130.);}
      else if(model.x<5.5)gate=smoothstep(15.,40.,c.b-c.r);
      else if(model.x<6.5){gate=(1.-smoothstep(25.,65.,hi-lo))*smoothstep(15.,50.,hi);if(hasField)rms=mix(vec3(model.y)*gain*(.6+.4*min(1.,mean/220.)),rms,smoothstep(100.,150.,mean));}
      else if(model.x<7.5)gate=1.-smoothstep(40.,75.,hi);
      else if(model.x<8.5)gate=min(1.,hi/220.);
      else if(model.x<9.5)gate=1.-smoothstep(20.,35.,hi-lo);
      else if(model.x<10.5)gate=smoothstep(25.,65.,hi-lo)*clamp((hi-35.)/35.,0.,1.);
      else if(model.x<11.5)gate=1.-smoothstep(15.,35.,c.b-c.r);
      else gate=smoothstep(165.,195.,c.r)*(1.-smoothstep(32.,50.,c.b))*(1.-smoothstep(55.,80.,c.g));
      return rms*gate;
    }
    void main() {
      vec3 base=texture(baseImage,uv).rgb;
      vec3 result=base;vec4 semanticArt=texture(sourceArtImage,uv);float sourceArt=semanticArt.a*sourceArtStrength,clapperArt=semanticArt.r*sourceArtStrength;float plantCashArt=min(max(0.,sourceArt-clapperArt),semanticArt.g*sourceArtStrength);
      ${Array.from({length:maximumLayers},(_,i)=>`if(layerCount>${i}.5){vec3 noise=(texture(grain${i},uv).rgb*255.-128.)/24.;if(phaseUnits${i}>0.)noise*=24./phaseUnits${i};bool field=amplitudeFields>.5&&amplitudeSize${i}.x>1.;vec3 rms=field?texture(amplitudeMap${i},(uv*(amplitudeSize${i}-1.)+.5)/amplitudeSize${i}).rgb*16.:vec3(0.);if(covarianceSize${i}.x>1.){vec3 rho=texture(covarianceMap${i},(uv*(covarianceSize${i}-1.)+.5)/covarianceSize${i}).rgb*2.-1.;float d=sqrt(max(.015,1.-rho.r*rho.r)),bg=(rho.b-rho.r*rho.g)/d,bd=sqrt(max(.015,1.-rho.g*rho.g-bg*bg));noise=vec3(noise.r,rho.r*noise.r+d*noise.g,rho.g*noise.r+bg*noise.g+bd*noise.b);}float luma=(base.r+base.g+base.b)*85.,band=1.;if(luminanceBand${i}.x>0.)band*=smoothstep(luminanceBand${i}.x-10.,luminanceBand${i}.x+10.,luma);if(luminanceBand${i}.y<255.)band*=1.-smoothstep(luminanceBand${i}.y-10.,luminanceBand${i}.y+10.,luma);result+=noise*materialAmplitude(base,model${i},gain${i},rms,field)*band*(model${i}.x>13.5&&model${i}.x<14.5?(model${i}.w>1.5?plantCashArt:model${i}.w>.5?clapperArt:model${i}.w< -2.5?max(0.,sourceArt-clapperArt-plantCashArt):model${i}.w<-.5?max(0.,sourceArt-clapperArt):sourceArt):1.)*(1.-sourceArt*(((model${i}.x>1.5&&model${i}.x<2.5)||(model${i}.x>4.5&&model${i}.x<5.5)||(model${i}.x>9.5&&model${i}.x<10.5)||model${i}.x>11.5)?0.:1.))/255.;}`).join('\n')}
      fragmentColor=vec4(clamp(result,0.,1.),1.);
    }
  `);
  const plainFragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    in vec2 uv;
    out vec4 fragmentColor;
    uniform sampler2D baseImage,sourceArtImage;uniform float sourceArtStrength;
    ${Array.from({length:maximumLayers},(_,i)=>`uniform sampler2D grain${i},amplitudeMap${i};uniform vec4 model${i};uniform vec3 gain${i};uniform vec2 amplitudeSize${i};`).join('\n')}
    uniform float layerCount;
    uniform float amplitudeFields;
    float amplitude(vec3 rgb, vec4 model) {
      vec3 c=rgb*255.; float lo=min(c.r,min(c.g,c.b)), hi=max(c.r,max(c.g,c.b));
      float mean=(c.r+c.g+c.b)/3., chroma=hi-lo;
      if(model.x<.5) return model.y*(.6+.4*min(1.,mean/220.))*(1.-smoothstep(25.,65.,chroma))*smoothstep(15.,50.,hi);
      if(model.x<1.5) return model.y*min(1.,hi/220.);
      if(model.x<2.5) return max(0.,model.y+model.z*min(mean,255.-mean)/128.)*clamp((hi-35.)/35.,0.,1.)*(model.w>.5?smoothstep(20.,35.,chroma):1.);
      return model.y*(1.-smoothstep(40.,75.,hi));
    }
    float fieldAmplitude(vec3 rgb, vec4 model, float rms) {
      vec3 c=rgb*255.;float lo=min(c.r,min(c.g,c.b)),hi=max(c.r,max(c.g,c.b));
      if(model.x<.5){float fitted=rms*(1.-smoothstep(25.,65.,hi-lo))*smoothstep(15.,50.,hi);return mix(amplitude(rgb,model),fitted,smoothstep(100.,150.,(c.r+c.g+c.b)/3.));}
      if(model.x<1.5)return amplitude(rgb,model);
      return rms*(1.-smoothstep(40.,75.,hi));
    }
    vec3 materialAmplitude(vec3 rgb,vec4 model,vec3 gain,vec3 field,bool hasField){
      if(model.x<3.5)return hasField?vec3(fieldAmplitude(rgb,model,field.r))*gain:vec3(amplitude(rgb,model))*gain;
      vec3 c=rgb*255.;float hi=max(c.r,max(c.g,c.b)),lo=min(c.r,min(c.g,c.b)),mean=(c.r+c.g+c.b)/3.;
      vec3 rms=hasField?field:vec3(model.y)*gain;float gate=1.;
      if(model.x<4.5){gate=(1.-smoothstep(15.,35.,c.b-c.r))*smoothstep(12.,35.,hi);if(model.w>0.){if(model.z>0.)gate*=smoothstep(model.z-10.,model.z+10.,mean);if(model.w<255.)gate*=1.-smoothstep(model.w-10.,model.w+10.,mean);}else gate*=min(1.,mean/130.);}
      else if(model.x<5.5)gate=smoothstep(15.,40.,c.b-c.r);
      else if(model.x<6.5){gate=(1.-smoothstep(25.,65.,hi-lo))*smoothstep(15.,50.,hi);if(hasField)rms=mix(vec3(model.y)*gain*(.6+.4*min(1.,mean/220.)),rms,smoothstep(100.,150.,mean));}
      else if(model.x<7.5)gate=1.-smoothstep(40.,75.,hi);
      else if(model.x<8.5)gate=min(1.,hi/220.);
      else gate=1.-smoothstep(20.,35.,hi-lo);
      return rms*gate;
    }
    void main() {
      vec3 base=texture(baseImage,uv).rgb;
      vec3 result=base;float sourceArt=texture(sourceArtImage,uv).a*sourceArtStrength;
      ${Array.from({length:maximumLayers},(_,i)=>`if(layerCount>${i}.5){vec3 noise=(texture(grain${i},uv).rgb*255.-128.)/24.;bool field=amplitudeFields>.5&&amplitudeSize${i}.x>1.;vec3 rms=field?texture(amplitudeMap${i},(uv*(amplitudeSize${i}-1.)+.5)/amplitudeSize${i}).rgb*16.:vec3(0.);result+=noise*materialAmplitude(base,model${i},gain${i},rms,field)*(1.-sourceArt*(((model${i}.x>1.5&&model${i}.x<2.5)||(model${i}.x>4.5&&model${i}.x<5.5)||(model${i}.x>9.5&&model${i}.x<10.5)||model${i}.x>11.5)?0.:1.))/255.;}`).join('\n')}
      fragmentColor=vec4(clamp(result,0.,1.),1.);
    }
  `);
  let program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program); const featureProgram=program;
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const attribute = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  const names = ['sourceArtImage','sourceArtStrength','baseImage','layerCount','amplitudeFields',...Array.from({length:maximumLayers},(_,i)=>[`grain${i}`,`model${i}`,`gain${i}`,`amplitudeMap${i}`,`amplitudeSize${i}`,`covarianceMap${i}`,`covarianceSize${i}`,`luminanceBand${i}`,`phaseUnits${i}`]).flat()];
  let uniform = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
  const featureUniform=uniform;
  const textures = Array.from({length: maximumLayers*3+2}, (_, i) => {
    const texture=gl.createTexture(); gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,i>0&&i<=maximumLayers?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([128,128,128,255]));if(i)gl.generateMipmap(gl.TEXTURE_2D);return texture;
  });
  gl.uniform1i(uniform.sourceArtImage,maximumLayers*3+1);gl.uniform1i(uniform.baseImage,0);for(let i=0;i<maximumLayers;i++){gl.uniform1i(uniform['grain'+i],i+1);gl.uniform1i(uniform['amplitudeMap'+i],maximumLayers+i+1);gl.uniform1i(uniform['covarianceMap'+i],maximumLayers*2+i+1);}
  const plainProgram=gl.createProgram();gl.attachShader(plainProgram,vertex);gl.attachShader(plainProgram,plainFragment);gl.linkProgram(plainProgram);if(!gl.getProgramParameter(plainProgram,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(plainProgram));if(gl.getAttribLocation(plainProgram,'position')!==attribute)throw new Error('Unexpected vertex attribute layout');
  const plainUniform=Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(plainProgram,name)]));gl.useProgram(plainProgram);gl.uniform1i(plainUniform.sourceArtImage,maximumLayers*3+1);gl.uniform1i(plainUniform.baseImage,0);for(let i=0;i<maximumLayers;i++){gl.uniform1i(plainUniform['grain'+i],i+1);gl.uniform1i(plainUniform['amplitudeMap'+i],maximumLayers+i+1);}
  // Only explicitly scoped actor layers select this shader. Ordinary material
  // programs retain their previous source and native output rounding.
  const scopedProgram=gl.createProgram();gl.attachShader(scopedProgram,vertex);gl.attachShader(scopedProgram,scopedFragment);gl.linkProgram(scopedProgram);if(!gl.getProgramParameter(scopedProgram,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(scopedProgram));if(gl.getAttribLocation(scopedProgram,'position')!==attribute)throw new Error('Unexpected scoped vertex attribute layout');
  const scopedUniform=Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(scopedProgram,name)]));gl.useProgram(scopedProgram);gl.uniform1i(scopedUniform.sourceArtImage,maximumLayers*3+1);gl.uniform1i(scopedUniform.baseImage,0);for(let i=0;i<maximumLayers;i++){gl.uniform1i(scopedUniform['grain'+i],i+1);gl.uniform1i(scopedUniform['amplitudeMap'+i],maximumLayers+i+1);gl.uniform1i(scopedUniform['covarianceMap'+i],maximumLayers*2+i+1);}
  let lastKeys = Array(maximumLayers).fill('');
  return {
    draw(ctx, layers, exact = false, sourceArtMask = null, sourceArtStrength = 1) {
      const features=layers.some(layer=>layer.covarianceGrid||layer.luminanceBand||layer.phaseEncoding||layer.model[0]>=9.5);const scoped=layers.some(layer=>layer.model[0]===14&&Math.abs(layer.model[3])>.5);program=scoped?scopedProgram:features?featureProgram:plainProgram;uniform=scoped?scopedUniform:features?featureUniform:plainUniform;gl.useProgram(program);
      if(canvas.width!==ctx.canvas.width||canvas.height!==ctx.canvas.height){canvas.width=ctx.canvas.width;canvas.height=ctx.canvas.height;gl.viewport(0,0,canvas.width,canvas.height);}
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,textures[0]);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,ctx.canvas);
      for(let i=0;i<Math.min(layers.length,maximumLayers);i++){
        const layer=layers[i],key=layerSource(layer, exact),bitmap=touch(key); gl.activeTexture(gl.TEXTURE1+i);gl.bindTexture(gl.TEXTURE_2D,textures[i+1]);
        if(lastKeys[i]!==key){
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);gl.generateMipmap(gl.TEXTURE_2D);
          if(layer.amplitudeGrid){
            const grid=layer.amplitudeGrid,pixels=new Uint8Array(grid.columns*grid.rows*4);
            for(let y=0;y<grid.rows;y++)for(let x=0;x<grid.columns;x++){const j=((grid.rows-y-1)*grid.columns+x)*4,p=y*grid.columns+x;for(let c=0;c<3;c++)pixels[j+c]=Math.round(Math.min(16,grid.values[grid.channels===3?p*3+c:p])/16*255);pixels[j+3]=255;}
            gl.activeTexture(gl.TEXTURE0+maximumLayers+i+1);gl.bindTexture(gl.TEXTURE_2D,textures[maximumLayers+i+1]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,grid.columns,grid.rows,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          }
          if(layer.covarianceGrid){const grid=layer.covarianceGrid,pixels=new Uint8Array(grid.columns*grid.rows*4);for(let y=0;y<grid.rows;y++)for(let x=0;x<grid.columns;x++){const j=((grid.rows-y-1)*grid.columns+x)*4,p=(y*grid.columns+x)*3;for(let c=0;c<3;c++)pixels[j+c]=Math.round((grid.values[p+c]+1)*127.5);pixels[j+3]=255;}gl.activeTexture(gl.TEXTURE0+maximumLayers*2+i+1);gl.bindTexture(gl.TEXTURE_2D,textures[maximumLayers*2+i+1]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,grid.columns,grid.rows,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);}lastKeys[i]=key;
        }
        gl.uniform1f(uniform['phaseUnits'+i],layer.phaseEncoding?.unitsPerSigma||0);gl.uniform4fv(uniform['model'+i],layer.model);gl.uniform3fv(uniform['gain'+i],layer.gain||[1,1,1]);gl.uniform2fv(uniform['luminanceBand'+i],layer.luminanceBand||[0,255]);
        gl.uniform2f(uniform['amplitudeSize'+i],layer.amplitudeGrid?.columns||0,layer.amplitudeGrid?.rows||0);gl.uniform2f(uniform['covarianceSize'+i],layer.covarianceGrid?.columns||0,layer.covarianceGrid?.rows||0);
      }
      gl.uniform1f(uniform.sourceArtStrength,sourceArtMask?sourceArtStrength:0);if(sourceArtMask){const index=maximumLayers*3+1;gl.activeTexture(gl.TEXTURE0+index);gl.bindTexture(gl.TEXTURE_2D,textures[index]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,sourceArtMask);}gl.uniform1f(uniform.layerCount,Math.min(layers.length,maximumLayers));gl.uniform1f(uniform.amplitudeFields,useAmplitudeFields?1:0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='copy';ctx.filter='none';ctx.drawImage(canvas,0,0);ctx.restore();
    }
  };
}

/** Returns false while a frame is being prepared; the procedural fallback remains. */
export function drawRecoveredGrain(ctx, zeroBasedFrame, {exact = false, sourceArtMask = null, sourceArtStrength = 1} = {}) {
  if (!compositor || !isRecoveredGrainReady(zeroBasedFrame, exact)) return false;
  compositor.draw(ctx, frameLayers(zeroBasedFrame), exact, sourceArtMask, sourceArtStrength); return true;
}

export function recoveredGrainStats() {
  return {cachedTextures: cache.size, loading, queued: queue.length, limit: CACHE_LIMIT, textureWidth};
}

/** Used by material-fit validation; the default is enabled after measured A/B. */
export function setRecoveredGrainAmplitudeFields(enabled) { useAmplitudeFields = !!enabled; }
