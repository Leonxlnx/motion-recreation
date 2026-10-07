// Four reusable sprites in the brief graded flash, with measured optical blur.
let data,cluster;const artwork=new Map(),RESOLUTION=4,SIZE=128;
export async function loadFlashIcons(){
 const [tracks,art]=await Promise.all(['flash-icon-tracks.json','flash-cluster49.json'].map(async name=>(await fetch(new URL('../assets/'+name,import.meta.url))).json()));data=tracks;
 const [x0,y0,x1,y1]=art.box,c=document.createElement('canvas');c.width=(x1-x0+2)*RESOLUTION;c.height=(y1-y0+2)*RESOLUTION;
 const x=c.getContext('2d');x.scale(RESOLUTION,RESOLUTION);x.translate(1-x0,1-y0);x.fillStyle=art.base.color;x.fill(new Path2D(art.base.d),'evenodd');
 for(const region of art.regions){const p=new Path2D(region.d);x.fillStyle=x.strokeStyle=region.color;x.lineWidth=.10;x.fill(p,'evenodd');x.stroke(p);}
 cluster={canvas:c,x:x0-1,y:y0-1,width:c.width/RESOLUTION,height:c.height/RESOLUTION};
}
function painted(name,entry,drawIcon){
 const key=name+JSON.stringify(entry);if(artwork.has(key))return artwork.get(key);
 const c=document.createElement('canvas');c.width=c.height=SIZE*RESOLUTION;const x=c.getContext('2d',{willReadFrequently:true});
 x.setTransform(RESOLUTION,0,0,RESOLUTION,c.width/2,c.height/2);const p=entry.pose;drawIcon(x,name,0,0,p[2],p[3],p[4]);
 const image=x.getImageData(0,0,c.width,c.height),pixels=image.data;
 for(let j=0;j<pixels.length;j+=4){if(!pixels[j+3])continue;for(let k=0;k<3;k++)pixels[j+k]=pixels[j+k]*entry.rgbGain[k]+255*entry.rgbOffset[k];}
 x.putImageData(image,0,0);artwork.set(key,c);return c;
}
export function drawFlashIcons(ctx,frame,drawIcon){
 const entries=data?.frames[String(frame)];if(!entries)return false;
 const t=ctx.getTransform(),scale=Math.hypot(t.a,t.b);
 for(const [name,entry]of Object.entries(entries)){const p=entry.pose;ctx.save();ctx.filter=`blur(${p[5]*scale}px)`;ctx.drawImage(painted(name,entry,drawIcon),p[0]-SIZE/2,p[1]-SIZE/2,SIZE,SIZE);ctx.restore();}
 return true;
}
// This graded overlap is a finite artwork state, separate from the stretched type.
export function drawFlashCluster(ctx){if(!cluster)return false;ctx.save();ctx.filter='none';ctx.drawImage(cluster.canvas,cluster.x,cluster.y,cluster.width,cluster.height);ctx.restore();return true;}
