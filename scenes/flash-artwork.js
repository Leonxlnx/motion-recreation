// One isolated transformed-art variant preserves colored optical fringes and
// material texture at overlapping strokes. Its red paper is transparent.
// Set this to false to use the independently editable vector components.
const USE_SOURCE_ARTWORK=true;
let image,pending;
export function loadFlashArtwork(){
  if(!USE_SOURCE_ARTWORK)return Promise.resolve();
  return pending||(pending=(async()=>{
    const candidate=new Image();candidate.src=new URL('../assets/flash-artwork49.png',import.meta.url).href;
    await candidate.decode();image=candidate;
  })());
}
export function hasFlashArtwork(oneBasedFrame){return Boolean(image)&&oneBasedFrame===49;}
// The captured material already contains its texture. Paint after paper grain.
export function drawFlashArtwork(ctx,zeroBasedFrame){
  if(!hasFlashArtwork(Math.floor(zeroBasedFrame+1e-5)+1))return false;
  ctx.save();ctx.filter='none';ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  ctx.drawImage(image,21.5,0,698.5,540);ctx.restore();return true;
}
