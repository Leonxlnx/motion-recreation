export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const lerp=(a,b,t)=>a+(b-a)*t;
export const smooth=t=>{t=clamp(t);return t*t*(3-2*t)};
export function keyframe(keys,f){if(f<=keys[0][0])return keys[0].slice(1);for(let i=1;i<keys.length;i++){if(f<=keys[i][0]){let t=(f-keys[i-1][0])/(keys[i][0]-keys[i-1][0]);return keys[i-1].slice(1).map((v,j)=>lerp(v,keys[i][j+1],t));}}return keys.at(-1).slice(1)}
export function star(ctx,x,y,r,rot=0,thin=.18){ctx.save();ctx.translate(x,y);ctx.rotate(rot);ctx.beginPath();ctx.moveTo(0,-r);for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.bezierCurveTo(Math.sin(a)*r*thin,-Math.cos(a)*r*thin,Math.sin(a+Math.PI/2)*r*thin,-Math.cos(a+Math.PI/2)*r*thin,Math.sin(a+Math.PI/2)*r,-Math.cos(a+Math.PI/2)*r)}ctx.closePath();ctx.fill();ctx.restore()}
export function text(ctx,value,x,y,size=23,color='#1c1917',align='left',maxWidth){ctx.fillStyle=color;ctx.font=`700 ${size}px FilmSans,Arial,sans-serif`;ctx.textAlign=align;ctx.textBaseline='alphabetic';if(maxWidth)ctx.fillText(value,x,y,maxWidth);else ctx.fillText(value,x,y)}
export function line(ctx,points,color='#eee9da',width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke()}
