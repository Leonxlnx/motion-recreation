/** Two finite, continuously animated diffuse lights; no raster frame assets. */
function monotoneValue(values, i, t) {
  const delta = j => values[j + 1] - values[j];
  const slope = j => {
    if (!j || j === values.length - 1) return 0;
    const a = delta(j - 1), b = delta(j);
    return a * b <= 0 ? 0 : 2 * a * b / (a + b);
  };
  return (2*t**3-3*t*t+1)*values[i]+(t**3-2*t*t+t)*slope(i)
    +(-2*t**3+3*t*t)*values[i+1]+(t**3-t*t)*slope(i+1);
}

function covariance(item) {
  const [sx,sy] = item.sigmaDesign, c = Math.cos(item.angleRadians), s = Math.sin(item.angleRadians);
  return [c*c*sx*sx+s*s*sy*sy,c*s*(sx*sx-sy*sy),s*s*sx*sx+c*c*sy*sy];
}

function sampleTrack(track, frame) {
  const local = frame - track[0].frame;
  if (local <= 0 || local >= track.length - 1) return null;
  const i = Math.floor(local), t = local - i;
  if (t < 1e-7) return track[i];
  if (1-t < 1e-7) return track[i+1];
  const property = (name,index) => monotoneValue(track.map(item => item[name][index]),i,t);
  const a = covariance(track[i]), b = covariance(track[i+1]), blend = t*t*(3-2*t);
  return {
    centerDesign: [property('centerDesign',0),property('centerDesign',1)],
    amplitudeBGR8bit: [0,1,2].map(k => Math.max(0,property('amplitudeBGR8bit',k))),
    covariance: a.map((value,k) => value+(b[k]-value)*blend),
  };
}

export async function createThermalLights() {
  const data=await(await fetch(new URL('../assets/thermal-exterior-lights.json',import.meta.url))).json();
  return {
    draw(ctx,zeroFrame) {
      const frame=zeroFrame+1,lights=data.tracks.map(track=>sampleTrack(track,frame)).filter(Boolean);
      if(!lights.length)return;
      ctx.save();ctx.globalCompositeOperation='lighter';
      for(const light of lights){
        ctx.save();ctx.translate(...light.centerDesign);
        if(light.covariance){
          const [xx,xy,yy]=light.covariance,a=Math.sqrt(xx),b=xy/a;
          ctx.transform(a,b,0,Math.sqrt(Math.max(1e-6,yy-b*b)),0,0);
        }else{ctx.rotate(light.angleRadians);ctx.scale(...light.sigmaDesign);}
        const [b,g,r]=light.amplitudeBGR8bit,gradient=ctx.createRadialGradient(0,0,0,0,0,5);
        for(let i=0;i<=128;i++){const radius=5*i/128;gradient.addColorStop(i/128,`rgba(${r},${g},${b},${i===128?0:Math.exp(-radius*radius/2)})`);}
        ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fill();ctx.restore();
      }
      ctx.restore();
    },
  };
}
