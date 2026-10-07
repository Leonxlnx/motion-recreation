// A finite quadratic deformation of the existing cap artwork. No video pixels.
// Coordinates below refer to the cap's measured native-332 world homography.
const H=[-15.297357254017147,-49.38906475324834,291.3360681252443,-49.79398743830743,34.345365241385984,158.0337399064043,-.2887919385401706,-.1553183394923617,1.0101294733851343];
const I=[.014785642001531355,.0011579946398216378,-4.4455618289281,.0011629836647024197,.017142904475488996,-3.017411604745785,.004405976684282568,.0029669730990213986,-.7449557688566941];
const Q=[-.19365543124811319,-.5444155927715506,4.246324168203802,-8.53042729577884,3.633545921001272,-8.999999999999996,-.9588250530671222,.1751177011832508,5.966111352090074,-8.999999999999998,8.999999999999998,-8.999999999999988];
const cache=new WeakMap();
const clamp=v=>Math.max(-.65,Math.min(.65,v));

export function capWarp(image,amount=1){
 if(amount<=0)return {image,bounds:[-.5,-.5,1,1]};
 let entries=cache.get(image);if(!entries){entries=new Map();cache.set(image,entries);}
 if(entries.has(amount))return entries.get(amount);
 const w=image.width,h=image.height,px=Math.ceil(w*64/848),pt=Math.ceil(h*128/654),pb=Math.ceil(h*64/654);
 const W=w+2*px,T=h+pt+pb,left=-.5-px/w,top=-.5-pt/h;
 const read=new OffscreenCanvas(w,h),r=read.getContext('2d',{willReadFrequently:true});r.drawImage(image,0,0);
 const src=r.getImageData(0,0,w,h).data,canvas=new OffscreenCanvas(W,T),c=canvas.getContext('2d'),out=c.createImageData(W,T),dst=out.data;
 for(let y=0;y<T;y++)for(let x=0;x<W;x++){
  const u=left+(x+.5)/w,v=top+(y+.5)/h,z=H[6]*u+H[7]*v+H[8];
  const wx=(H[0]*u+H[1]*v+H[2])/z,wy=(H[3]*u+H[4]*v+H[5])/z;
  let X=wx,Y=wy;
  for(let n=0;n<12;n++){
   const d=I[6]*X+I[7]*Y+I[8],a=clamp((I[0]*X+I[1]*Y+I[2])/d),b=clamp((I[3]*X+I[4]*Y+I[5])/d);
   X=wx-amount*(Q[0]+Q[1]*a+Q[2]*b+Q[3]*a*b+Q[4]*a*a+Q[5]*b*b);
   Y=wy-amount*(Q[6]+Q[7]*a+Q[8]*b+Q[9]*a*b+Q[10]*a*a+Q[11]*b*b);
  }
  const d=I[6]*X+I[7]*Y+I[8],sx=((I[0]*X+I[1]*Y+I[2])/d+.5)*w-.5,sy=((I[3]*X+I[4]*Y+I[5])/d+.5)*h-.5;
  const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
  if(ix< -1||iy< -1||ix>=w||iy>=h)continue;
  let red=0,green=0,blue=0,alpha=0;
  for(let j=0;j<2;j++)for(let k=0;k<2;k++){
   const xx=ix+k,yy=iy+j;if(xx<0||yy<0||xx>=w||yy>=h)continue;
   const p=(yy*w+xx)*4,weight=(k?fx:1-fx)*(j?fy:1-fy)*src[p+3];
   alpha+=weight;red+=src[p]*weight;green+=src[p+1]*weight;blue+=src[p+2]*weight;
  }
  if(alpha>0){const p=(y*W+x)*4;dst[p]=red/alpha;dst[p+1]=green/alpha;dst[p+2]=blue/alpha;dst[p+3]=alpha;}
 }
 c.putImageData(out,0,0);const result={image:canvas,bounds:[left,top,W/w,T/h]};entries.set(amount,result);
 // Keep generated texture memory bounded during arbitrary fractional playback.
 while(entries.size>2)entries.delete(entries.keys().next().value);
 return result;
}

export function capWarpPose(p,bounds){
 const[x,y,w,h,r,s,px,py]=p,c=Math.cos(r),sn=Math.sin(r),[left,top,sx,sy]=bounds;
 const A=[w*c+x*px,h*(s*c-sn)+x*py,x,w*sn+y*px,h*(s*sn+c)+y*py,y,px,py,1];
 const B=[sx,0,left+sx/2,0,sy,top+sy/2,0,0,1],M=Array(9).fill(0);
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)M[i*3+j]+=A[i*3+k]*B[k*3+j];
 const z=M[8];for(let i=0;i<9;i++)M[i]/=z;
 const X=M[2],Y=M[5],PX=M[6],PY=M[7],a=M[0]-X*PX,b=M[3]-Y*PX,e=M[1]-X*PY,d=M[4]-Y*PY,W=Math.hypot(a,b),R=Math.atan2(b,a),C=Math.cos(R),S=Math.sin(R),height=-S*e+C*d;
 return[X,Y,W,height,R,(C*e+S*d)/height,PX,PY];
}
