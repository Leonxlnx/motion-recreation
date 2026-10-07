import {clamp,lerp,smooth,keyframe,text,star,line} from './math.js';
import {drawVectorType,vectorTypeMetrics} from './vector-type.js';
import {drawCaptionTransition} from './caption-transition.js';
import {loadThermalCaptionPigments,drawThermalCaptionPigment} from './thermal-type-pigments.js';
import {loadIntroCaptions,drawMeasuredIntroCaption} from './intro-captions.js';
import {loadLoveCaptions,drawLoveCaptions} from './love-captions.js';
import {loadThermalCaptions,drawThermalExitCaption} from './thermal-captions.js';
import {loadFlashArtwork,hasFlashArtwork} from './flash-artwork.js';
import {drawOpening} from './opening-motion.js';
import {drawIntroField,drawIntroFlash} from './intro-field.js';
import {drawIntroInk} from './intro-ink.js';
import {drawSlicedType} from './sliced-type.js';
import {drawIntroMarks,drawOutroMarks} from './vector-marks.js';
import {loadRefinedOutro,drawRefinedOutro} from './outro-type.js';
import {loadFlashIcons,drawFlashIcons,drawFlashCluster} from './flash-icons.js';
import {loadFinalInk} from './final-ink.js';
// Measured two-state flash transition of the reusable sentence artwork.
const flashPrefix={"49":{"pose":[21.401433758689674,256.1744525915042,0.9995699331947341,0.9867617063045145,0.46976646904149094,1.3470523239570416],"color":[40.74380941807565,16.373490564476665,15.897300260336841]},"50":{"pose":[22.448928696943153,257.4248842533152,0.9842895250714329,0.9019670448005098,7.966406508230048,0.8050885341617704],"color":[40.74380941807565,16.373490564476665,15.897300260336841]}};
const INK='#211811',PAPER='#eeeae2';
const sentence='how do you communicate that you’re going through a change?';
const TAU=Math.PI*2;
const pixelScale=ctx=>{const m=ctx.getTransform();return Math.hypot(m.a,m.b)};
let outroTracks,captionTracks,introIconTracks,introCaptionTracks,paperCaptionTracks;
const introIcons=document.createElement('canvas');introIcons.width=720;introIcons.height=540;
const introIconContext=introIcons.getContext('2d');
const pixelIcons=document.createElement('canvas');pixelIcons.width=144;pixelIcons.height=108;
export async function createTypography(){const [outro,captions,icons,introCaption,paperCaption]=await Promise.all([...['outro-tracks','caption-tracks','intro-icon-tracks','intro-caption-tracks','paper-caption-tracks'].map(async name=>(await fetch(new URL(`../assets/${name}.json`,import.meta.url))).json()),loadRefinedOutro(),loadFlashIcons(),loadFinalInk(),loadThermalCaptions(),loadFlashArtwork(),loadIntroCaptions(),loadLoveCaptions(),loadThermalCaptionPigments()]);outroTracks=outro.tracks;captionTracks=captions;introIconTracks=icons;introCaptionTracks=introCaption.tracks;paperCaptionTracks=paperCaption.tracks}
function drawIntroIcons(ctx,f,drawIcon){
 const n=f+1,a=introIconTracks.frames[Math.floor(n)],b=introIconTracks.frames[Math.ceil(n)]||a;if(!a)return;const t=n-Math.floor(n),block=a.book.pixelSize;
 const target=block?introIconContext:ctx;if(block)target.clearRect(0,0,720,540);
 for(const name of introIconTracks.names){const p=a[name].pose.map((v,i)=>lerp(v,b[name].pose[i],t));const angleDelta=Math.atan2(Math.sin(b[name].pose[4]-a[name].pose[4]),Math.cos(b[name].pose[4]-a[name].pose[4]));p[4]=a[name].pose[4]+angleDelta*t;target.save();target.globalAlpha*=lerp(a[name].opacity,b[name].opacity,t);target.filter=`blur(${p[5]*pixelScale(target)}px)`;drawIcon(target,name,p[0],p[1],p[2],p[3],p[4],undefined,p[6],p[7],p[8]);target.restore();}
 if(block){pixelIcons.width=Math.ceil(720/block);pixelIcons.height=Math.ceil(540/block);const pc=pixelIcons.getContext('2d');pc.imageSmoothingEnabled=false;pc.drawImage(introIcons,0,2,720,pixelIcons.height*block,0,0,pixelIcons.width,pixelIcons.height);ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(pixelIcons,0,2,720,pixelIcons.height*block);ctx.restore();}
}
function ellipse(ctx,x,y,rx,ry,rotation=0,color=PAPER,width=1.5,start=0,end=TAU){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.ellipse(x,y,rx,ry,rotation,start,end);ctx.stroke()}
function dashed(ctx,y,offset,width=1.6){ctx.save();ctx.setLineDash([21,23]);ctx.lineDashOffset=offset;line(ctx,[[-300,y],[1300,y]],'#5b3321',width);ctx.restore()}
function how(ctx){ctx.save();ctx.strokeStyle=INK;ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';const paths=[[[203,376],[245,133],[220,248],[297,216],[308,119],[245,414],[262,301],[319,123]],[[290,266],[281,240],[309,213],[342,204],[376,226],[383,249],[366,274],[330,285],[298,275],[286,251],[303,222],[345,212],[371,234],[370,261],[344,278],[313,276],[293,258]],[[385,133],[397,316],[445,225],[457,314],[529,149],[461,299],[453,230],[398,301],[395,161]]];for(let j=0;j<3;j++){ctx.translate(j*.5,-j*.7);for(const p of paths)line(ctx,p,INK,j===0?3.6:1.4)}line(ctx,[[214,322],[449,288]],'#795634',.6);ctx.restore()}
function scribble(ctx,f,x,y,scale=1,color='#4a2e21',weight=1){ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.strokeStyle=color;ctx.lineWidth=weight;ctx.beginPath();const seed=Math.floor(f/2);for(let i=0;i<100;i++){const t=i/99;const px=(t-.4)*120+18*Math.sin(t*27+seed*.7),py=Math.sin(t*14+seed*.3)*21+Math.sin(t*33)*7;(i?ctx.lineTo(px,py):ctx.moveTo(px,py))}ctx.stroke();ctx.restore()}
export function drawIntro(ctx,f,drawIcon){
 const n=Math.floor(f+1e-5)+1;
 if(n<15){drawOpening(ctx,f);return;}
 if(n<49){
   if(n<19){drawSlicedType(ctx,f);drawIntroMarks(ctx,f);return;}
   let value=n<19?'how do you co':n<22?'how do you communicate':n<32?'how do you communicate that':n<39?'how do you communicate that you’re':n<43?'how do you communicate that you’re going':n<47?'how do you communicate that you’re going through':'how do you communicate that you’re going through a';
   const [dx,dy,sx,sy,blur,gain]=keyframe(paperCaptionTracks,f+1);ctx.save();ctx.translate(21.75+dx,256+dy);ctx.scale(sx,sy);ctx.filter=`blur(${blur*pixelScale(ctx)}px)`;drawVectorType(ctx,'sentence',0,0,{opacity:Math.min(1,gain),coverageGain:Math.max(1,gain),revealWidth:n<22?283:n<32?334:n<39?405:n<=43?470:n<47?560:583});
   if(n===43){
     // The arriving word has its own measured fade and settles leftward.
     const t=clamp(f+1-43);ctx.save();ctx.beginPath();ctx.rect(472,-10,98,50);ctx.clip();ctx.translate(1.75018*(1-t)/sx,.01841*(1-t)/sy);ctx.filter=`blur(${lerp(.073309,blur,t)*pixelScale(ctx)/sx}px)`;
     drawVectorType(ctx,'sentence',0,0,{opacity:lerp(.5495,Math.min(1,gain),t),coverageGain:Math.max(1,gain),revealWidth:lerp(564.75,560,t)});ctx.restore();
   }
   ctx.restore();
   drawIntroMarks(ctx,f);
   return;
 }
 if(n<51){
   if(hasFlashArtwork(n))return;
   ctx.save();if(n===50)ctx.filter=`blur(${9*pixelScale(ctx)}px)`;
   if(n===49){drawIntroFlash(ctx);}else{ctx.save();ctx.filter='none';drawIntroFlash(ctx,50);ctx.restore();}
   {const {pose:p,color}=flashPrefix[n];ctx.save();ctx.filter=`blur(${p[4]*pixelScale(ctx)}px)`;ctx.translate(p[0],p[1]);ctx.scale(p[2],p[3]);drawVectorType(ctx,'sentence',0,0,{revealWidth:582,color:`rgb(${color.join(',')})`,opacity:Math.min(1,p[5]),coverageGain:Math.max(1,p[5])});ctx.restore();}
   if(n===49){drawVectorType(ctx,'stretched-change-selected-complete',605,88);drawVectorType(ctx,'flash-white-scratch',406,119.25);drawFlashCluster(ctx);}
   else{drawFlashIcons(ctx,50,drawIcon);drawVectorType(ctx,'stretched-change',615,113);}
   ctx.restore();return;
 }
 if(n<=93){
   drawIntroField(ctx,f);drawIntroIcons(ctx,f,drawIcon);
 }
 if(drawMeasuredIntroCaption(ctx,f+1)){drawIntroInk(ctx,f);return;}
 const [dx,dy,sx,sy,blur,gain]=keyframe(introCaptionTracks,f+1);ctx.save();ctx.translate(21.75+dx,256+dy);ctx.scale(sx,sy);ctx.filter=`blur(${blur*pixelScale(ctx)}px)`;
 drawVectorType(ctx,'sentence',0,0,{opacity:Math.min(1,gain),coverageGain:Math.max(1,gain),revealWidth:n>=90?keyframe([[90,678],[91,616],[92,510],[93,313]],f+1)[0]:undefined});
 if(n>=85){ctx.save();ctx.beginPath();ctx.rect(81.25,-6,45,40);ctx.clip();drawVectorType(ctx,'sentence',0,0,{color:PAPER});ctx.restore();}ctx.restore();
 drawIntroInk(ctx,f);
}
export function drawTextOverlays(ctx,f){const n=f+1;
 if(drawThermalExitCaption(ctx,n))return;
 if(n>=94&&n<129&&drawThermalCaptionPigment(ctx,'you-dont',n))return;
 if(n>=94&&n<153){ctx.save();if(n<105)ctx.filter=`blur(${keyframe([[94,9],[95,4],[96,4],[98,2],[102,1],[105,0]],n)[0]*pixelScale(ctx)}px)`;const k=clamp((n-140)/9),shade=Math.round(lerp(239,28,k)),color=`rgb(${shade},${shade-2},${shade-5})`;drawVectorType(ctx,n<129?'you-dont':'you-just-show-it',102,n<129?256.5:256.75,{color,revealWidth:n<129?104:n<131?44:n<138?86:n<146?143:169});ctx.restore();
 }
 if(n>=328&&n<383){if(drawCaptionTransition(ctx,n))return;if(!drawThermalCaptionPigment(ctx,'through-ones',n)){const [x,y,blur]=n<332?keyframe([[328,189,259.5,0],[329,160.5,259.5,0],[330,145.25,259.5,0],[331,135.5,259.5,0],[332,127.75,259.5,0]],n):keyframe(captionTracks.left,n);ctx.save();if(blur)ctx.filter=`blur(${blur*pixelScale(ctx)}px)`;drawVectorType(ctx,'through-ones',x,y,{revealWidth:n<335?90:undefined,color:n<332?INK:PAPER});ctx.restore();}
  if(n>=344&&!drawThermalCaptionPigment(ctx,'own-ability',n)){const [rx,ry,rb]=captionTracks.right?keyframe(captionTracks.right,n):keyframe([[344,473.25,259.5,0],[375,464,259.5,0],[380,452.5,259.5,0],[381,442.75,259.5,0],[382,388.25,259.5,0]],n);ctx.save();if(rb)ctx.filter=`blur(${rb*pixelScale(ctx)}px)`;drawVectorType(ctx,'own-ability-to',rx,ry,{revealWidth:n<350?47:n<379?120:undefined,color:PAPER});ctx.restore();}
 }
 if(drawLoveCaptions(ctx,n))return;
 if(n>=384&&n<415){let letters=n<392?'L':n<400?'LO':n<406?'LOV':'LOVE';for(let i=0;i<letters.length;i++){const char=letters[i],m=vectorTypeMetrics(char);let color=n<390?INK:n>=398&&n<405?'#5fd9c7':PAPER;if(n>=413&&n<414&&'OV'.includes(char))color=INK;if(n>=414&&'LE'.includes(char))color=INK;drawVectorType(ctx,char,m.origin[0],m.origin[1],{color})}}
}
export function drawTypingCarets(ctx,f){const n=f+1,sample=Math.floor(n);const keys=[[327,212,254.5,105,28.5],[328,298.5,254.25,105,28.5],[329,328.5,254.5,36.5,28],[330,339.75,254.5,22.75,28],[331,345.5,254.5,16.5,28.25],[343,439,258.75,84.25,23.75],[344,525.5,258.5,84.5,24],[345,555.5,258.5,16,24],[346,566.25,258.5,2.75,24],[347,568.25,258.25,4.5,24]];if(!keys.some(k=>k[0]===sample))return;const group=keys.filter(k=>sample<332?k[0]<332:k[0]>332);ctx.save();ctx.fillStyle=sample<332?INK:PAPER;ctx.fillRect(...keyframe(group,n));ctx.restore()}
const finalKeys=[
 [415,328,214,390,270,190,315,520,330],
 [420,260,89,644,278,337,286,353,62],
 [423,293,238,686,230,379,283,225,91],
 [430,110,151,494,161,343,400,501,444],
 [440,179,174,427,153,297,400,546,464],
 [450,194,135,429,136,238,451,588,446],
 [460,166,123,406,128,221,447,595,443],
 [470,184,129,400,138,220,433,584,428],
 [480,190,145,398,148,237,417,568,420],
 [484,214,168,393,171,256,392,540,394],
 [486,266,202,379,207,291,352,466,350],
 [488,332,251,370,248,336,290,395,294],
 [489,343,255,367,263,346,278,383,281]
];
export function drawOutro(ctx,f){const n=f+1,p=clamp((n-415)/74);const pos=keyframe(finalKeys,n);const collapse=smooth((n-484)/5);
 if(n>=489)return;
 if(n<421){drawOutroMarks(ctx,f);return;}
 if(drawRefinedOutro(ctx,n)){drawOutroMarks(ctx,f);return;}
 const chars=['V','O','L','E'];for(let i=0;i<4;i++){
  const tracked=outroTracks&&n>=421?keyframe(outroTracks[chars[i]],n):null;
  const x=tracked?tracked[0]:pos[i*2],y=tracked?tracked[1]:pos[i*2+1];const rotation=tracked?tracked[2]:(i===0?-.7:i===2?.65:.2)*Math.exp(-(n-423)/25)+Math.sin((n-416)*.24+i)*.25+collapse*(i-1.5)*1.6;
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);if(n<427)ctx.filter=`blur(${keyframe([[421,2.9],[422,2.3],[423,1.75],[424,1.15],[425,.6],[426,.1],[427,0]],n)[0]*pixelScale(ctx)}px)`;const m=vectorTypeMetrics(chars[i]),s=tracked?tracked[3]:lerp(1,2.7,collapse);drawVectorType(ctx,chars[i],-m.width*s/2,-m.height*s/2,{color:INK,scale:s});ctx.restore();
 }
 drawOutroMarks(ctx,f);
}
