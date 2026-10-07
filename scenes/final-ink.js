// A transparent source-art cutout preserves optical color fringes where the
// final black lettering and red pen strokes intersect. Paper is drawn separately;
// this captured material is composited after grain to avoid adding texture twice.
// The editable vector versions remain in typography.json and outro-marks.json.
let image;
export async function loadFinalInk(){
  image=new Image();
  image.src=new URL('../assets/final-ink.png',import.meta.url).href;
  await image.decode();
}
export function drawFinalInk(ctx){
  ctx.drawImage(image,211.5,43.5,363,329);
}
