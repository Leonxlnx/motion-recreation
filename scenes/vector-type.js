// Editable source contours are rasterized once by Canvas and reused while moving.
// These caches contain generated glyph artwork, never source video frames.
let assets=null,pending=null;
const paths=new Map(),rasters=new Map();
const RESOLUTION=4,PADDING=2,MAX_CACHE_BYTES=192*1024*1024;
let cacheBytes=0;
const canvas=(w,h)=>typeof OffscreenCanvas==='function'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});
function drawPaths(ctx,name,color){
  const asset=assets[name];
  if(asset.parts){for(const part of asset.parts){ctx.save();ctx.translate(part.x,part.y);drawPaths(ctx,part.name,color);ctx.restore()}return;}
  if(asset.base)drawPaths(ctx,asset.base,color);
  ctx.fillStyle=color||asset.color;
  for(let i=0;i<(asset.layers?.length||0);i++){ctx.globalAlpha=asset.layers[i].alpha;ctx.fill(paths.get(name+':'+i),'evenodd');}
  ctx.globalAlpha=1;
  for(let j=0;j<(asset.coveragePatches?.length||0);j++){
    const patch=asset.coveragePatches[j];ctx.clearRect(...patch.box);ctx.save();ctx.beginPath();ctx.rect(...patch.box);ctx.clip();
    for(let i=0;i<patch.layers.length;i++){ctx.globalAlpha=patch.layers[i].alpha;ctx.fill(paths.get(name+':patch:'+j+':'+i),'evenodd');}
    ctx.restore();ctx.globalAlpha=1;
  }
}
function raster(name,color,coverageGain=1){
  coverageGain=Math.round(Math.max(0,Math.min(4,coverageGain))*512)/512;
  const key=name+'\u0000'+(color||'source')+'\u0000'+coverageGain;
  if(rasters.has(key)){const item=rasters.get(key);rasters.delete(key);rasters.set(key,item);return item;}
  const asset=assets[name],w=Math.ceil((asset.width+PADDING*2)*RESOLUTION),h=Math.ceil((asset.height+PADDING*2)*RESOLUTION);
  const surface=canvas(w,h),c=surface.getContext('2d');c.scale(RESOLUTION,RESOLUTION);c.translate(PADDING,PADDING);
  if(coverageGain!==1){
    // Expand the generated mask's coverage before compositing. Canvas globalAlpha
    // cannot exceed one and therefore cannot implement fitted gain above one.
    const original=raster(name,color);c.setTransform(1,0,0,1,0,0);c.drawImage(original.canvas,0,0);
    const image=c.getImageData(0,0,w,h);for(let i=3;i<image.data.length;i+=4)image.data[i]*=coverageGain;c.putImageData(image,0,0);
  }else if(asset.parts){
    for(const part of asset.parts){const item=raster(part.name,color);c.drawImage(item.canvas,part.x-PADDING,part.y-PADDING,item.width,item.height);}
  }else{
    drawPaths(c,name,'#fff');
    // Tint the completed alpha mask once, preserving RGB at very low coverage.
    c.globalAlpha=1;c.globalCompositeOperation='source-in';c.fillStyle=color||asset.color||'#211811';c.fillRect(-PADDING,-PADDING,w/RESOLUTION,h/RESOLUTION);
  }
  const result={canvas:surface,width:w/RESOLUTION,height:h/RESOLUTION,bytes:w*h*4};
  while(cacheBytes+result.bytes>MAX_CACHE_BYTES&&rasters.size){const [oldKey,old]=rasters.entries().next().value;rasters.delete(oldKey);cacheBytes-=old.bytes;old.canvas.width=1;old.canvas.height=1;}
  rasters.set(key,result);cacheBytes+=result.bytes;return result;
}
export function loadVectorType(){
  if(!pending)pending=fetch(new URL('../assets/typography.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Unable to load typography contours');return r.json()}).then(data=>{
    assets=data.assets;
    for(const [name,asset] of Object.entries(assets)){if(asset.layers)asset.layers.forEach((layer,i)=>paths.set(name+':'+i,new Path2D(layer.d)));asset.coveragePatches?.forEach((patch,j)=>patch.layers.forEach((layer,i)=>paths.set(name+':patch:'+j+':'+i,new Path2D(layer.d))));}
    for(const name of Object.keys(assets))raster(name);
    for(const name of ['L','O','V','E','you-dont','you-just-show-it','through-ones','own-ability-to'])for(const color of ['#211811','#eeeae2'])raster(name,color);
    return assets;
  });
  return pending;
}
export function vectorTypeMetrics(name){return assets?.[name]??null;}
export function vectorTypeCacheStats(){return {entries:rasters.size,bytes:cacheBytes,resolution:RESOLUTION,compiledPaths:paths.size};}
export function drawVectorType(ctx,name,x,y,{scale=1,color,opacity=1,coverageGain=1,maxWidth,revealWidth,rotation=0}={}){
  const asset=assets?.[name];if(!asset)return false;
  const item=raster(name,color,coverageGain);
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);
  const sx=maxWidth?Math.min(scale,maxWidth/asset.width):scale;
  ctx.scale(sx,scale);ctx.globalAlpha*=opacity;
  if(revealWidth!==undefined){
    // Crop the glyph source before inherited optical blur. A destination clip
    // would cut the blur into a visible rectangular strip.
    const width=Math.max(0,Math.min(item.width,revealWidth/sx+PADDING));
    if(width>0)ctx.drawImage(item.canvas,0,0,width*RESOLUTION,item.canvas.height,-PADDING,-PADDING,width,item.height);
  }else ctx.drawImage(item.canvas,-PADDING,-PADDING,item.width,item.height);
  ctx.restore();return true;
}
