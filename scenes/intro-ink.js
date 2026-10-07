// Editable ink silhouettes, separated from the photographic grain and color field.
// The source changes these scribbles on individual film frames, so their deliberate
// cuts are retained while the scene's other geometry continues between samples.
import {compileInkCoverage,drawInkCoverage} from './ink-coverage.js';
let frames;
export async function createIntroInk(){
 const data=await(await fetch(new URL('../assets/intro-ink.json',import.meta.url))).json();
 frames=new Map(data.frames.map(frame=>[frame.sourceFrame-1,frame.shapes.map(shape=>compileInkCoverage(shape.layers,shape.color))]));
}
export function drawIntroInk(ctx,zeroBasedFrame){
 const shapes=frames?.get(Math.floor(zeroBasedFrame+1e-5));
 if(!shapes)return false;
 ctx.save();
 for(const shape of shapes)drawInkCoverage(ctx,shape);
 ctx.restore();return true;
}
