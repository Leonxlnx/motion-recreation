// Build coverage in white before tinting once. Repeated translucent colored
// fills otherwise accumulate rounding errors in an 8-bit premultiplied canvas.
export function compileInkCoverage(layers,color,bounds){
 if(!bounds){let x0=720,y0=540,x1=0,y1=0;for(const layer of layers){const values=(layer.d.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number);for(let i=0;i<values.length;i+=2){x0=Math.min(x0,values[i]);y0=Math.min(y0,values[i+1]);x1=Math.max(x1,values[i]);y1=Math.max(y1,values[i+1])}}bounds=[x0,y0,x1,y1]}
 const [x0,y0,x1,y1]=bounds,x=Math.floor(x0)-2,y=Math.floor(y0)-2,width=Math.max(1,Math.ceil(x1)-x+2),height=Math.max(1,Math.ceil(y1)-y+2);
 const canvas=document.createElement('canvas');canvas.width=width*4;canvas.height=height*4;
 const ctx=canvas.getContext('2d');ctx.scale(4,4);ctx.translate(-x,-y);ctx.fillStyle='#ffffff';
 for(const layer of layers){ctx.globalAlpha=layer.alpha;ctx.fill(new Path2D(layer.d),'evenodd')}
 ctx.globalAlpha=1;ctx.globalCompositeOperation='source-in';ctx.fillStyle=color;ctx.fillRect(x,y,width,height);
 return {canvas,x,y,width,height};
}
export function drawInkCoverage(ctx,ink,opacity=1){ctx.save();ctx.globalAlpha*=opacity;ctx.drawImage(ink.canvas,ink.x,ink.y,ink.width,ink.height);ctx.restore()}
