import {createBackground,drawBackground,drawGrain} from './scenes/background.js';
import {createIcons,drawIconScene,drawIcon} from './scenes/icons.js';
import {createThermal,drawThermal} from './scenes/thermal.js';
import {createTypography,drawIntro,drawTextOverlays,drawTypingCarets,drawOutro} from './scenes/typography.js';
import {loadVectorType} from './scenes/vector-type.js';
import {createIntroField} from './scenes/intro-field.js';
import {createIntroInk} from './scenes/intro-ink.js';
import {createSlicedType} from './scenes/sliced-type.js';
import {prewarmOpening} from './scenes/opening-motion.js';
import {loadVectorMarks,drawGhostGrainMask,drawOutroMaterialMask} from './scenes/vector-marks.js';
import {createRecoveredGrain,prepareGrain,prefetchGrain,drawRecoveredGrain,needsClapperMaterialMask,needsPlantCashMaterialMask,getCellMaterialActors,getPreservedCellMaterialActors,cellMaterialNeedsClapperScope} from './scenes/recovered-grain.js';
import {drawFlashArtwork} from './scenes/flash-artwork.js';
import {drawFinalInk} from './scenes/final-ink.js';
const FPS=24000/1001,DURATION=489/FPS;
const canvas=document.querySelector('#film'),ctx=canvas.getContext('2d',{alpha:false});
const query=new URLSearchParams(location.search);if(query.has('clean'))document.body.classList.add('clean');
const resolution=Number(query.get('width')||1440);canvas.width=resolution;canvas.height=resolution*.75;
let time=0,playing=false,started=0,mode='smooth',sound=false,paintRequest=0;
const audio=document.querySelector('#audio');audio.muted=true;
const filmFont=new FontFace('FilmSans',"local('Arial Bold'), local('Arial-BoldMT'), url('assets/Arimo.ttf')",{weight:'700'});await filmFont.load();document.fonts.add(filmFont);
await Promise.all([createBackground(),createIcons(),createThermal(),loadVectorType(),createIntroField(),createIntroInk(),createSlicedType(),createTypography(),loadVectorMarks(),createRecoveredGrain(resolution)]);
prewarmOpening(Math.min(resolution,1440));
let sourceArtMask=null,clapperMaterialMask=null,encodedMaterialMask=null,plantCashMaterialMask=null,expandedCellMaterialMask=null,protectedCellMaterialMask=null;
function render(t,{native=false,exact=false}={}){
 time=Math.max(0,Math.min(DURATION-1e-6,t));let f=time*FPS;if(native)f=Math.floor(f+1e-5);else if(Math.abs(f-Math.round(f))<1e-7)f=Math.round(f);
 ctx.setTransform(canvas.width/720,0,0,canvas.height/540,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';
 ctx.reconstructionExact=exact;const ghostMaterialActive=Math.floor(f+1e-5)===20||Math.floor(f+1e-5)===22;const outroMaterialActive=Math.floor(f+1e-5)===415;const sourceArtActive=outroMaterialActive||ghostMaterialActive||(f>=93&&f<128)||(f>=158&&f<332)||(f>=332&&f<382)||(f>=382&&f<414);ctx.grainExclusionContext=null;if(sourceArtActive){if(!sourceArtMask)sourceArtMask=document.createElement('canvas');const maskWidth=exact?canvas.width:Math.min(720,canvas.width),maskHeight=maskWidth*.75;if(sourceArtMask.width!==maskWidth||sourceArtMask.height!==maskHeight){sourceArtMask.width=maskWidth;sourceArtMask.height=maskHeight;}const mx=sourceArtMask.getContext('2d');mx.setTransform(1,0,0,1,0,0);mx.clearRect(0,0,maskWidth,maskHeight);ctx.grainExclusionContext=mx;}
 ctx.clapperGrainContext=null;ctx.cellMaterialClapperScope=cellMaterialNeedsClapperScope(f);if(needsClapperMaterialMask(f)){if(!clapperMaterialMask)clapperMaterialMask=document.createElement('canvas');clapperMaterialMask.width=sourceArtMask.width;clapperMaterialMask.height=sourceArtMask.height;ctx.clapperGrainContext=clapperMaterialMask.getContext('2d');}
 ctx.plantCashGrainContext=null;ctx.cellMaterialActors=null;ctx.expandedCellGrainContext=null;ctx.protectedCellGrainContext=null;ctx.preservedCellMaterialActors=null;if(needsPlantCashMaterialMask(f)){if(!plantCashMaterialMask)plantCashMaterialMask=document.createElement('canvas');plantCashMaterialMask.width=sourceArtMask.width;plantCashMaterialMask.height=sourceArtMask.height;ctx.plantCashGrainContext=plantCashMaterialMask.getContext('2d');ctx.cellMaterialActors=new Set(getCellMaterialActors(f));const preserve=getPreservedCellMaterialActors(f);if(preserve.length){if(preserve.some(name=>!ctx.cellMaterialActors.has(name)))throw Error('Preserved material actor must be selected');ctx.preservedCellMaterialActors=new Set(preserve);if(!expandedCellMaterialMask)expandedCellMaterialMask=document.createElement('canvas');if(!protectedCellMaterialMask)protectedCellMaterialMask=document.createElement('canvas');for(const c of[expandedCellMaterialMask,protectedCellMaterialMask]){c.width=sourceArtMask.width;c.height=sourceArtMask.height;}ctx.expandedCellGrainContext=expandedCellMaterialMask.getContext('2d');ctx.protectedCellGrainContext=protectedCellMaterialMask.getContext('2d');}}
 drawBackground(ctx,f,exact);
 if(f<93)drawIntro(ctx,f,drawIcon);
 if(f>=93&&f<158)drawThermal(ctx,f,{exact});
 if(f>=326&&f<331)drawTextOverlays(ctx,f);
 if(f>=158&&f<332)drawIconScene(ctx,f);
 if(f>=332&&f<382)drawThermal(ctx,f,{exact});
 if(f>=382&&f<414)drawIconScene(ctx,f);
 if(f<326||f>=331)drawTextOverlays(ctx,f);
 drawTypingCarets(ctx,f);
 if(f>=414)drawOutro(ctx,f);
 if(ghostMaterialActive)drawGhostGrainMask(ctx.grainExclusionContext,f);
 if(outroMaterialActive)drawOutroMaterialMask(ctx.grainExclusionContext,f);
 if(ctx.expandedCellGrainContext){const add=ctx.expandedCellGrainContext,protect=ctx.protectedCellGrainContext,w=add.canvas.width,h=add.canvas.height,p=add.getImageData(0,0,w,h),a=protect.getImageData(0,0,w,h).data;for(let i=0;i<a.length;i+=4)if(a[i+3]){p.data[i]=0;p.data[i+1]=0;p.data[i+2]=0;p.data[i+3]=0;}add.putImageData(p,0,0);const old=ctx.plantCashGrainContext;old.save();old.setTransform(1,0,0,1,0,0);old.globalAlpha=1;old.filter='none';old.globalCompositeOperation='lighter';old.drawImage(add.canvas,0,0);old.restore();}
 let activeMaterialMask=sourceArtActive?sourceArtMask:null;if(ctx.clapperGrainContext){if(!encodedMaterialMask)encodedMaterialMask=document.createElement('canvas');encodedMaterialMask.width=sourceArtMask.width;encodedMaterialMask.height=sourceArtMask.height;const em=encodedMaterialMask.getContext('2d');em.drawImage(sourceArtMask,0,0);em.globalCompositeOperation='source-in';em.fillStyle='#000';em.fillRect(0,0,em.canvas.width,em.canvas.height);em.globalCompositeOperation='source-atop';em.drawImage(clapperMaterialMask,0,0);if(ctx.plantCashGrainContext){em.globalCompositeOperation='copy';em.fillStyle='#000';em.fillRect(0,0,em.canvas.width,em.canvas.height);em.globalCompositeOperation='lighter';em.drawImage(clapperMaterialMask,0,0);em.drawImage(plantCashMaterialMask,0,0);em.globalCompositeOperation='destination-in';em.drawImage(sourceArtMask,0,0);}activeMaterialMask=encodedMaterialMask;}
 if(!drawRecoveredGrain(ctx,f,{exact,sourceArtMask:activeMaterialMask,sourceArtStrength:1}))drawGrain(ctx,f);
 drawFlashArtwork(ctx,f);
 if(f>=488)drawFinalInk(ctx);
 if(!exact)prefetchGrain(f);
 document.querySelector('#seek').value=time;document.querySelector('#time').textContent=`${time.toFixed(2)} / 20.40`;
 return f;
}
async function renderExact(t,options){const bounded=Math.max(0,Math.min(DURATION-1e-6,t));await prepareGrain(bounded*FPS,{exact:true});return render(bounded,{...options,exact:true})}
function show(t,options){const request=++paintRequest;render(t,options);prepareGrain(Math.max(0,Math.min(DURATION-1e-6,t))*FPS).then(()=>{if(request===paintRequest&&!playing)render(t,options)}).catch(error=>{document.querySelector('#status').textContent=`Grain texture could not load: ${error.message}`})}
function pause(){playing=false;audio.pause();document.querySelector('#play').textContent='Play';}
async function play(){paintRequest++;if(time>=DURATION-.06)time=0;playing=true;started=performance.now()-time*1000;audio.currentTime=time;if(sound)await audio.play().catch(()=>{});document.querySelector('#play').textContent='Pause';}
function tick(now){if(playing){const t=(now-started)/1000;if(t>=DURATION){render(DURATION-.00001,{native:mode==='native'});pause();}else render(t,{native:mode==='native'});}requestAnimationFrame(tick)}
document.querySelector('#play').onclick=()=>playing?pause():play();
document.querySelector('#seek').oninput=e=>{time=Number(e.target.value);started=performance.now()-time*1000;audio.currentTime=time;show(time,{native:mode==='native'})};
document.querySelector('#timing').onchange=e=>{mode=e.target.value;show(time,{native:mode==='native'})};
document.querySelector('#sound').onclick=()=>{sound=!sound;audio.muted=!sound;document.querySelector('#sound').textContent=sound?'Sound on':'Sound off';if(sound&&playing){audio.currentTime=time;audio.play().catch(()=>{});}else audio.pause()};
document.querySelector('#full').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.querySelector('.stage').requestFullscreen();
document.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;if(e.code==='Space'){e.preventDefault();playing?pause():play()}if(e.code==='ArrowRight'){pause();show(time+1/FPS,{native:true})}if(e.code==='ArrowLeft'){pause();show(time-1/FPS,{native:true})}});
window.recreation={render,renderExact,canvas,FPS,DURATION,ready:true,async exportFrame(t){await renderExact(t,{native:true});return canvas.toDataURL('image/png')}};
document.querySelector('#loading').remove();show(Number(query.get('time')||0));requestAnimationFrame(tick);
