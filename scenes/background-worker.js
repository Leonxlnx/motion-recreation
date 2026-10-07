// The same measured cubic field and paper arithmetic as background.js.
// Surfaces are generated here, never decoded from source video frames.
let settings,surface,context,pixels;
const SW=240,SH=180;
function grainStrength(frame) {
  if(frame===1)return 2.67/1.75;if(frame===2)return 2.92/1.75;
  const n=frame+1,keys=[[51,0],[52,1.5],[60,1.74],[70,2],[83,2],[89,1.9],[90,2.8],[91,1.99],[93,.97]];
  for(let i=1;i<keys.length;i++)if(n<=keys[i][0]){const[a,av]=keys[i-1],[b,bv]=keys[i];return(av+(bv-av)*(n-a)/(b-a))/1.75}return 0;
}
function buildField(frame) {
  const {fit,xIndices,yIndices,xWeights,yWeights}=settings;
  const colors=fit.frames[frame].c,nx=fit.columns,data=pixels.data,rowColors=new Float64Array(nx*3);
  for(let y=0;y<SH;y++){
    for(let x=0;x<nx;x++)for(let c=0;c<3;c++){
      let value=0;for(let yy=0;yy<4;yy++)value+=colors[(yIndices[y*4+yy]*nx+x)*3+c]*yWeights[y*4+yy];rowColors[x*3+c]=value;
    }
    for(let x=0;x<SW;x++){
      const p=(y*SW+x)*4;let r=0,g=0,b=0;
      for(let xx=0;xx<4;xx++){const j=xIndices[x*4+xx]*3,w=xWeights[x*4+xx];r+=rowColors[j]*w;g+=rowColors[j+1]*w;b+=rowColors[j+2]*w}
      data[p]=r;data[p+1]=g;data[p+2]=b;data[p+3]=255;
    }
  }
  context.putImageData(pixels,0,0);
}
function finishField(frame,recoveredReady) {
  const {fit,paperTextures,lowPaperTextures,lensGrainFields,openingGrainFields}=settings;
  const textures=recoveredReady?lowPaperTextures:paperTextures;
  let texture=null;
  if(frame>=419)texture=textures.outro;
  else if(fit.frames[frame].k==='paper')texture=textures[frame<=47?'intro':'icons'];
  else if(fit.frames[frame].k==='black')texture=textures.dark;
  const lensGrain=!recoveredReady&&(frame===1||frame===2||(frame>=51&&frame<=92));
  const canvas=new OffscreenCanvas(texture||lensGrain?720:SW,texture||lensGrain?540:SH);
  // Keep even untextured 240px fields on the CPU. A GPU-backed temporary here
  // can block this worker behind the visible thermal blur command queue.
  const painter=canvas.getContext('2d',{willReadFrequently:true});
  painter.imageSmoothingEnabled=true;painter.imageSmoothingQuality='high';painter.drawImage(surface,0,0,canvas.width,canvas.height);
  if(texture||lensGrain){
    const data=painter.getImageData(0,0,720,540),p=data.data;
    const strength=lensGrain?grainStrength(frame):0,grainFields=frame<3?openingGrainFields:lensGrainFields;
    const offsetX=(frame*137)&255,offsetY=(frame*79)&255;
    for(let i=0;i<720*540;i++){
      const j=i*4,delta=texture?texture[i]:0;let r=delta,g=delta,b=delta;
      if(lensGrain){
        const x=i%720,y=(i/720)|0,index=(((y+offsetY)&255)*256)+((x+offsetX)&255);
        const illumination=frame<3?1:.6+.4*Math.min(1,(p[j]*.2126+p[j+1]*.7152+p[j+2]*.0722)/220),amplitude=strength*illumination,shared=grainFields[0][index]*1.63;
        r+=amplitude*(shared+grainFields[1][index]*.55);g+=amplitude*(shared+grainFields[2][index]*.88);b+=amplitude*(shared+grainFields[3][index]*1.45);
      }
      p[j]+=r;p[j+1]+=g;p[j+2]+=b;
    }
    painter.putImageData(data,0,0);
  }
  return canvas.transferToImageBitmap();
}
self.onmessage=({data})=>{
  if(data.settings){settings=data.settings;surface=new OffscreenCanvas(SW,SH);context=surface.getContext('2d',{willReadFrequently:true});pixels=context.createImageData(SW,SH);self.postMessage({ready:true});return;}
  const start=performance.now();buildField(data.frame);const field=performance.now();
  const first=finishField(data.frame,false),middle=performance.now(),second=finishField(data.frame,true),end=performance.now();
  const surfaces=[first,second];self.postMessage({frame:data.frame,surfaces,timing:{field:field-start,first:middle-field,second:end-middle,total:end-start},finishedAt:Date.now()},surfaces);
};
