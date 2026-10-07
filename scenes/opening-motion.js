import {drawVectorType} from './vector-type.js';
import {openingArt} from './opening-art.js';

// The opening uses three hard type cuts followed by a tracked horizontal pan.
// Positions are measured independently at the source cadence; between samples
// the same editable glyph geometry moves continuously.
const howPoses=[
 [4,218.120624,181.555964,.997281,.998134,32,30,31],
 [5,216.710692,181.640516,.995378,.996731,24,22,23],
 [6,215.990360,182.114871,.993334,.993881,23,21,22],
 [7,197.053893,182.499325,.991388,.992190,20,19,20],
 [8,-54.429820,182.708325,.989674,.987217,21,19,19],
 [9,-72.701163,182.515316,.990375,.989949,21,19,20],
 [10,-80.346126,183.020359,.986546,.986180,20,18,19],
 [11,-239.996575,181.273678,1.001333,.993507,22,19,20],
 [12,-342.8,181.5,.994,.993,21,19,19],
 [13,-350,181.7,.987,.989,22,19,20],
];
const doPoses=[
 [6,558.724907,174.863223,1.011577,1.009493,68,66,67],
 [7,535.296779,175.307520,1.009699,1.006453,42,40,41],
 [8,281.579951,175.279352,1.007732,1.005108,32,30,31],
 [9,263,175.5,1.005,1.004,23,22,22],
 [10,253.254865,175.775229,1.002919,1.003080,20,20,20],
 [11,97,176,1,1,23,20,20],
 [12,-5.280800,176.268445,.992817,.997502,21,19,19],
 [13,-10.380406,175.962607,.981549,1.001205,22,19,20],
];
const cache=new Map();
const compiledPaths=new WeakMap();
const channelCoverageCache=new WeakMap();
const pinnedArtwork=new Set(['pencil-how-rgb','stretched-how-red','yellow-how-rgb']);
function compiledPath(layer){let path=compiledPaths.get(layer);if(!path){path=new Path2D(layer.d);compiledPaths.set(layer,path)}return path}
const letterPoses={
 d:[[11,100.75,183,1,1],[12,-1.648885,183.300843,.995686,.997146],[13,-7.076226,184.054450,.987648,.988761]],
 o1:[[11,202.75,217.25,1,1],[12,99.950589,217.400759,.996490,.997721],[13,93.591183,217.885585,.990156,.988926]],
 y:[[11,334.75,219.75,1,1],[12,229.958219,219.428584,1.000729,1.001644],[13,221.692907,219.752330,.996978,.994579]],
 o2:[[11,420.75,217.25,1,1],[12,315.799300,217.448803,.997473,.997054],[13,307.012476,217.895136,.988612,.989184]],
 u:[[11,523.5,219.75,1,1],[12,418.086799,219.897340,.998392,.997124],[13,408.522437,219.513441,.990127,1.000498]],
};
const fallbackBoxes={'clean-do-you':[97,176,614,352],'red-stroke2':[296,265,554,325],underline7:[0,314,367,353],box8:[122,172,534,343],bracket9:[230,178,640,375],underline10:[340,312,720,349],exclamation10:[649,83,704,183],caret11:[623,180,634,319]};
function pose(keys,n){let i=0;while(i<keys.length-1&&keys[i+1][0]<=n)i++;const a=keys[i],b=keys[Math.min(i+1,keys.length-1)];const t=Math.max(0,Math.min(1,(n-a[0])/(b[0]-a[0]||1)));return a.slice(1).map((v,j)=>v+(b[j+1]-v)*t)}
function art(ctx,name,x,y,sx=1,sy=1,color){
 const a=openingArt.assets[name];if(!a)return;
 const box=a.box||fallbackBoxes[name],key=name+'|'+(color||a.color);let item=cache.get(key);
 if(!item){
  const w=box[2]-box[0]+4,h=box[3]-box[1]+4,c=document.createElement('canvas');c.width=Math.ceil(w*4);c.height=Math.ceil(h*4);const p=c.getContext('2d');
  if(a.channelLayers){
   // Optical colored fringes are editable channel-specific contour coverage.
   // Rasterize the contours once, then derive a conventional RGBA foreground.
   let coverage=channelCoverageCache.get(a);
   if(!coverage){const plane=document.createElement('canvas');plane.width=c.width;plane.height=c.height;const ink=plane.getContext('2d',{willReadFrequently:true});coverage=[];
    for(const layers of a.channelLayers){ink.setTransform(1,0,0,1,0,0);ink.clearRect(0,0,plane.width,plane.height);ink.setTransform(4,0,0,4,(2-box[0])*4,(2-box[1])*4);ink.fillStyle='#fff';for(const layer of layers){ink.globalAlpha=layer.alpha;ink.fill(compiledPath(layer),'evenodd')}coverage.push(ink.getImageData(0,0,plane.width,plane.height).data)}channelCoverageCache.set(a,coverage);
   }
   const pixels=p.createImageData(c.width,c.height),paper=a.referencePaperColor,core=color?.startsWith('rgb')?color.match(/[\d.]+/g).map(Number):color?.startsWith('#')?[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)):a.inkColor;
   for(let i=0;i<pixels.data.length;i+=4){const alpha=Math.max(coverage[0][i+3],coverage[1][i+3],coverage[2][i+3]);pixels.data[i+3]=alpha;if(alpha)for(let channel=0;channel<3;channel++)pixels.data[i+channel]=paper[channel]-(paper[channel]-core[channel])*coverage[channel][i+3]/alpha;}
   p.putImageData(pixels,0,0);
  }else{p.scale(4,4);p.translate(2-box[0],2-box[1]);p.fillStyle=color||a.color;for(const layer of a.layers){p.globalAlpha=layer.alpha;p.fill(compiledPath(layer),'evenodd')}}
  // Keep the complete opening's recolored glyph set after startup warming.
  // The earlier forty-entry bound evicted letters still needed within 0.6 s.
  item={canvas:c,width:w,height:h};if(cache.size>=128){const [oldKey,old]=[...cache.entries()].find(([key])=>!pinnedArtwork.has(key.split('|')[0]));cache.delete(oldKey);old.canvas.width=1;old.canvas.height=1}cache.set(key,item);
 }
 ctx.save();ctx.translate(x??box[0],y??box[1]);ctx.scale(sx,sy);ctx.drawImage(item.canvas,-2,-2,item.width,item.height);ctx.restore();
}
function guides(ctx,n){
 const sample=Math.floor(n),rows=openingArt.guides[sample];if(!rows)return;
 const next=sample>=4?openingArt.guides[sample+1]:null,mix=next?n-sample:0;
 ctx.save();ctx.filter=`blur(${.10*Math.hypot(ctx.getTransform().a,ctx.getTransform().b)}px)`;
 for(let i=0;i<rows.length;i++){const row=rows[i],b=next?.[i]||row;const lerp=(a,b)=>a+(b-a)*mix;const period=lerp(row.period,b.period);const expected=pose(howPoses,sample+1)[0]-pose(howPoses,sample)[0];const raw=b.offset-row.offset,shift=raw+Math.round((expected-raw)/period)*period;const offset=row.offset+shift*mix;const y=lerp(row.y,b.y),height=lerp(row.height,b.height),width=lerp(row.width,b.width);ctx.fillStyle=`rgb(${row.color.map((c,j)=>lerp(c,b.color[j])).join(',')})`;for(let x=((offset%period)+period)%period-period;x<720;x+=period)ctx.fillRect(x,y-height/2,width,height)}ctx.restore();
}
function cleanHow(ctx,n){const [x,y,sx,sy,r,g,b]=pose(howPoses,n),scaleX=sx/howPoses[0][3],scaleY=sy/howPoses[0][4];art(ctx,'paper-how-rgb',x+(210-howPoses[0][1])*scaleX,y+(176-howPoses[0][2])*scaleY,scaleX,scaleY,`rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`)}
function cleanDo(ctx,n,short=false){const [x,y,sx,sy,r,g,b]=pose(doPoses,n);const color=`rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;if(n>=11){for(const [name,keys]of Object.entries(letterPoses)){const p=pose(keys,n);art(ctx,'letter-rgb-'+name,...p,color)}return}ctx.save();if(short){ctx.beginPath();ctx.rect(x-2,y-2,210*sx,180*sy);ctx.clip()}art(ctx,n<10?'clean-do-you':'paper-do-you-rgb',x,y,sx,sy,color);ctx.restore()}

export function drawOpening(ctx,frame){
 const n=frame+1,sample=Math.floor(n+1e-5);
 if(sample===1){art(ctx,'pencil-how-rgb');return}
 if(sample===2){art(ctx,'red-stroke2');art(ctx,'stretched-how-red');guides(ctx,2);return}
 if(sample===3){art(ctx,'yellow-how-rgb');guides(ctx,3);return}
 if(sample===14){drawVectorType(ctx,'pixel-do-you-co',0,185.25,{color:'#161414'});return}
 guides(ctx,n);
 if(sample<=11)cleanHow(ctx,n);
 if(sample>=6&&sample!==9){
  if(sample===10){const [x,y,sx,sy]=pose(doPoses,n);art(ctx,'paper-do-you-rgb',x,y,sx,sy,'#555354');cleanDo(ctx,n,true)}
  else cleanDo(ctx,n,sample<10);
 }
 if(sample===7)art(ctx,'underline7');
 if(sample===8)art(ctx,'box8');
 if(sample===9){art(ctx,'bracket9');ctx.save();ctx.filter=`blur(${.35*Math.hypot(ctx.getTransform().a,ctx.getTransform().b)}px)`;ctx.fillStyle='#171616';ctx.fillRect(255.1,185.25,470,129.6);ctx.restore()}
 if(sample===10){ctx.save();ctx.filter=`blur(${.35*Math.hypot(ctx.getTransform().a,ctx.getTransform().b)}px)`;ctx.fillStyle='#181818';ctx.fillRect(440.9,185.75,238.3,129);ctx.restore();art(ctx,'underline10');art(ctx,'exclamation10')}
 if(sample===11)art(ctx,'caret11');
}

/** Call after the vector typography has loaded, while the loading view is visible. */
export function prewarmOpening(width=1440){
 const start=performance.now(),surface=document.createElement('canvas');surface.width=width;surface.height=width*.75;
 const painter=surface.getContext('2d');painter.scale(width/720,width/720);
 for(let i=0;i<35;i++){painter.clearRect(0,0,720,540);drawOpening(painter,i*(24000/1001)/60)}
 return{samples:35,elapsedMs:performance.now()-start};
}
