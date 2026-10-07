/** Exact squared Euclidean transform of a code-generated binary shape. */
export function codedDistance(features,width,height){
 const length=width*height,intermediate=new Float32Array(length),vertical=new Int32Array(length),distances=new Float32Array(length),nearest=new Int32Array(length),maximum=Math.max(width,height),f=new Float64Array(maximum),out=new Float64Array(maximum),arg=new Int32Array(maximum),v=new Int32Array(maximum),z=new Float64Array(maximum+1),infinity=1e20;
 const line=n=>{let k=-1;for(let q=0;q<n;q++){if(f[q]>=infinity)continue;let s=-infinity;while(k>=0){const p=v[k];s=((f[q]+q*q)-(f[p]+p*p))/(2*(q-p));if(s>z[k])break;k--;}k++;v[k]=q;z[k]=k?s:-infinity;z[k+1]=infinity;}if(k<0){for(let q=0;q<n;q++){out[q]=infinity;arg[q]=-1;}return;}let j=0;for(let q=0;q<n;q++){while(j<k&&z[j+1]<q)j++;const p=v[j];out[q]=(q-p)**2+f[p];arg[q]=p;}};
 for(let x=0;x<width;x++){for(let y=0;y<height;y++)f[y]=features[y*width+x]?0:infinity;line(height);for(let y=0;y<height;y++){const i=y*width+x;intermediate[i]=out[y];vertical[i]=arg[y]<0?-1:arg[y]*width+x;}}
 for(let y=0;y<height;y++){const row=y*width;for(let x=0;x<width;x++)f[x]=intermediate[row+x];line(width);for(let x=0;x<width;x++){const i=row+x;distances[i]=out[x];nearest[i]=arg[x]<0?-1:vertical[row+arg[x]];}}
 return{distances,nearest};
}
