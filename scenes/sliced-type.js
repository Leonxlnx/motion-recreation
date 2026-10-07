import {compileInkCoverage,drawInkCoverage} from './ink-coverage.js';
let frames;
export async function createSlicedType(){const data=await(await fetch(new URL('../assets/sliced-type.json',import.meta.url))).json();frames=Object.fromEntries(Object.entries(data.frames).map(([n,item])=>[n,compileInkCoverage(item.layers,data.color,item.box)]))}
export function drawSlicedType(ctx,f){if(!frames)return false;const n=f+1,a=Math.floor(n),item=frames[a];if(!item)return false;const next=frames[a+1],t=next?n-a:0;drawInkCoverage(ctx,item,1-t);if(t)drawInkCoverage(ctx,next,t);return true}
