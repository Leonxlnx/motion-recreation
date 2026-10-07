/** Articulated transport of the existing editable pigment meshes. */
export async function createThermalMotion(data, url = new URL('../assets/thermal-motion.json',import.meta.url)) {
  const response=await fetch(url);if(!response.ok)throw new Error('Thermal motion controls could not load.');
  const models=(await response.json()).frames, group=data.hand;
  const canvas=document.createElement('canvas'), gl=canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true});
  if(!gl)throw new Error('Thermal articulated motion requires WebGL.');
  const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
  const program=gl.createProgram();
  gl.attachShader(program,shader(gl.VERTEX_SHADER,`attribute vec2 position;attribute vec2 displacement;attribute vec3 color;uniform float warp;varying vec3 pigment;void main(){vec2 p=position+displacement*warp;gl_Position=vec4(p.x/360.0-1.0,1.0-p.y/270.0,0.0,1.0);pigment=color;}`));
  gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`precision highp float;varying vec3 pigment;uniform float opacity;void main(){gl_FragColor=vec4(pigment*opacity,opacity);}`));
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  const attributes={};for(const name of ['position','displacement','color']){attributes[name]=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(attributes[name]);}
  const warp=gl.getUniformLocation(program,'warp'),opacity=gl.getUniformLocation(program,'opacity');
  const composite=gl.createProgram();
  gl.attachShader(composite,shader(gl.VERTEX_SHADER,`attribute vec2 point;varying vec2 uv;void main(){gl_Position=vec4(point,0.,1.);uv=(point+1.)*.5;}`));
  gl.attachShader(composite,shader(gl.FRAGMENT_SHADER,`precision highp float;varying vec2 uv;uniform sampler2D first;uniform sampler2D second;uniform float phase;void main(){gl_FragColor=mix(texture2D(first,uv),texture2D(second,uv),phase);}`));
  gl.linkProgram(composite);if(!gl.getProgramParameter(composite,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(composite));
  const quadLocation=gl.getAttribLocation(composite,'point'),phaseLocation=gl.getUniformLocation(composite,'phase');
  const surfaces=[0,1].map(()=>{const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return{texture,framebuffer:gl.createFramebuffer()};});
  const points=new Float32Array(group.cols*group.rows*2),triangles=[];
  for(let y=0;y<group.rows;y++)for(let x=0;x<group.cols;x++){
    const i=y*group.cols+x;points[i*2]=group.x+x*group.step;points[i*2+1]=group.y+y*group.step;
    if(x<group.cols-1&&y<group.rows-1){if((x+y)%2)triangles.push(i,i+1,i+group.cols,i+1,i+group.cols+1,i+group.cols);else triangles.push(i,i+1,i+group.cols+1,i,i+group.cols+1,i+group.cols);}
  }
  const upload=(values)=>{const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,values,gl.STATIC_DRAW);return b;};
  const position=upload(points);gl.vertexAttribPointer(attributes.position,2,gl.FLOAT,false,0,0);
  const quad=upload(new Float32Array([-1,-1,1,-1,-1,1,1,1]));
  if(!gl.getExtension('OES_element_index_uint'))throw new Error('Thermal articulated mesh needs 32-bit indices.');
  const index=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array(triangles),gl.STATIC_DRAW);
  const indexCount=triangles.length;triangles.length=0;
  const colors=new Map(),flows=new Map();
  const displacement=(model)=>{
    const controls=model.controls,weights=model.weights,n=controls.length/2;
    const step=4,cols=Math.ceil((group.cols-1)*group.step/step)+1,rows=Math.ceil((group.rows-1)*group.step/step)+1;
    const grid=new Float32Array(cols*rows*2);
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const px=(group.x+x*step)/100,py=(group.y+y*step)/100;
      let dx=weights[n*2]+weights[n*2+2]*px+weights[n*2+4]*py;
      let dy=weights[n*2+1]+weights[n*2+3]*px+weights[n*2+5]*py;
      for(let i=0;i<n;i++){const xx=px-controls[i*2],yy=py-controls[i*2+1],r2=xx*xx+yy*yy,k=.5*r2*Math.log(Math.max(r2,1e-12));dx+=k*weights[i*2];dy+=k*weights[i*2+1];}
      grid[(y*cols+x)*2]=dx*100;grid[(y*cols+x)*2+1]=dy*100;
    }
    const out=new Float32Array(points.length);
    for(let i=0;i<points.length;i+=2){const gx=(points[i]-group.x)/step,gy=(points[i+1]-group.y)/step,x=Math.min(cols-2,Math.floor(gx)),y=Math.min(rows-2,Math.floor(gy)),u=gx-x,v=gy-y,p=(y*cols+x)*2;
      for(let c=0;c<2;c++)out[i+c]=(grid[p+c]*(1-u)+grid[p+2+c]*u)*(1-v)+(grid[p+cols*2+c]*(1-u)+grid[p+cols*2+2+c]*u)*v;
    }
    return out;
  };
  for(const [frame,model] of Object.entries(models)){
    flows.set(Number(frame),{forward:upload(displacement(model.forward)),backward:upload(displacement(model.backward))});
    for(const f of [Number(frame),Number(frame)+1])if(!colors.has(f))colors.set(f,upload(group.frames[f-group.start].colors));
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  // Render each pose into its own surface before blending. During a closing
  // hand gesture projected triangles can overlap; adding those fragments
  // directly would create an artificial bright flash at the fold.
  gl.disable(gl.BLEND);
  const renderer={canvas,has:frame=>flows.has(Math.floor(frame))&&frame%1>1e-6&&frame%1<1-1e-6,
    draw(frame,scale){
      const low=Math.floor(frame),mix=frame-low,flow=flows.get(low);if(!flow)return false;
      const width=Math.round(720*scale),height=Math.round(540*scale);if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);for(const surface of surfaces){gl.bindTexture(gl.TEXTURE_2D,surface.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.bindFramebuffer(gl.FRAMEBUFFER,surface.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,surface.texture,0);}}
      gl.useProgram(program);gl.clearColor(0,0,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,position);gl.vertexAttribPointer(attributes.position,2,gl.FLOAT,false,0,0);
      const paint=(sample,buffer,phase,surface)=>{gl.bindFramebuffer(gl.FRAMEBUFFER,surface.framebuffer);gl.clear(gl.COLOR_BUFFER_BIT);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.vertexAttribPointer(attributes.displacement,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,colors.get(sample));gl.vertexAttribPointer(attributes.color,3,gl.UNSIGNED_BYTE,true,0,0);gl.uniform1f(warp,phase);gl.uniform1f(opacity,1);gl.drawElements(gl.TRIANGLES,indexCount,gl.UNSIGNED_INT,0);};
      paint(low,flow.forward,mix,surfaces[0]);paint(low+1,flow.backward,1-mix,surfaces[1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.useProgram(composite);gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.enableVertexAttribArray(quadLocation);gl.vertexAttribPointer(quadLocation,2,gl.FLOAT,false,0,0);
      for(let i=0;i<2;i++){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,surfaces[i].texture);gl.uniform1i(gl.getUniformLocation(composite,i?'second':'first'),i);}
      gl.uniform1f(phaseLocation,mix);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);return true;
    }};
  renderer.draw(Number(Object.keys(models)[0])+.5,1);
  return renderer;
}
