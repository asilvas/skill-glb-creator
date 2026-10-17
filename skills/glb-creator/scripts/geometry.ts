import { Document,NodeIO,Accessor,Logger } from '@gltf-transform/core';
import { dedup,prune,weld } from '@gltf-transform/functions';
import * as T from 'three';
import { scheduleCleanup } from './cleanup';
export type V=[number,number,number];
export type Joint={name:string,at:V,parent?:string};
export const palette:Record<string,V>={basalt:[.11,.125,.115],edge:[.19,.205,.18],wood:[.18,.085,.033],grain:[.29,.16,.067],moss:[.14,.19,.042],ivory:[.6,.49,.31],eye:[1,.35,.018],mouth:[.012,.016,.012]};
type Batch={p:number[],n:number[],j:number[],w:number[],uv:number[],tan:number[]};
export type Surface={baseColor:Uint8Array,normal?:Uint8Array,roughness?:Uint8Array,normalScale?:number,tint?:V,alphaCutoff?:number};
/** Y up, +Z forward, metres. Geometry is authored in world bind space. */
export class Asset {
  doc=new Document();buffer=this.doc.createBuffer();scene=this.doc.createScene('asset');
  joints:Joint[]=[];nodes=new Map<string,any>();batches=new Map<string,Batch>();
  surfaces=new Map<string,Surface>();
  constructor(){this.doc.getRoot().setDefaultScene(this.scene);this.doc.setLogger(new Logger(Logger.Verbosity.ERROR));}
  joint(name:string,at:V,parent?:string){
    if(this.nodes.has(name)||parent&&!this.nodes.has(parent))throw Error(`Invalid joint ${name}`);
    const n=this.doc.createNode(name);const p=this.joints.find(j=>j.name===parent)?.at??[0,0,0];
    n.setTranslation(at.map((x,i)=>x-p[i]) as V);
    if(parent)this.nodes.get(parent).addChild(n);else this.scene.addChild(n);
    this.joints.push({name,at,parent});this.nodes.set(name,n);return n;
  }
  add(mat:string,bone:string,positions:V[],faces:number[][],flat=false,uvs?:[number,number][]){
    const ji=this.joints.findIndex(j=>j.name===bone);if(ji<0)throw Error(`Unknown joint ${bone}`);
    if(uvs&&uvs.length!==positions.length)throw Error('UV count must match positions');
    const b=this.batches.get(mat)??{p:[],n:[],j:[],w:[],uv:[],tan:[]};this.batches.set(mat,b);
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions.flat(),3));
    geo.setIndex(faces.flat());geo.computeVertexNormals();const smooth=geo.getAttribute('normal');
    geo.setAttribute('uv',new T.Float32BufferAttribute((uvs??positions.map(p=>[p[0],p[1]])).flat(),2));geo.computeTangents();const smoothTangent=geo.getAttribute('tangent');
    for(const f of faces){
      const normal=new T.Vector3().subVectors(new T.Vector3(...positions[f[1]]),new T.Vector3(...positions[f[0]])).cross(new T.Vector3().subVectors(new T.Vector3(...positions[f[2]]),new T.Vector3(...positions[f[0]]))).normalize();
      const uv=f.map(i=>uvs?.[i]??[positions[i][0],positions[i][1]]),e1=new T.Vector3(...positions[f[1]]).sub(new T.Vector3(...positions[f[0]])),e2=new T.Vector3(...positions[f[2]]).sub(new T.Vector3(...positions[f[0]]));
      const du1=uv[1][0]-uv[0][0],dv1=uv[1][1]-uv[0][1],du2=uv[2][0]-uv[0][0],dv2=uv[2][1]-uv[0][1],det=du1*dv2-du2*dv1;
      const tangent=Math.abs(det)>1e-9?e1.clone().multiplyScalar(dv2).addScaledVector(e2,-dv1).divideScalar(det):new T.Vector3(1,0,0);
      const bitangent=Math.abs(det)>1e-9?e2.clone().multiplyScalar(du1).addScaledVector(e1,-du2).divideScalar(det):new T.Vector3(0,1,0);
      for(const i of f){
        const n=flat?normal:new T.Vector3(smooth.getX(i),smooth.getY(i),smooth.getZ(i));let t=flat?tangent.clone().addScaledVector(n,-n.dot(tangent)):new T.Vector3(smoothTangent.getX(i),smoothTangent.getY(i),smoothTangent.getZ(i));
        if(t.lengthSq()<1e-8)t=Math.abs(n.x)<.9?new T.Vector3(1,0,0).addScaledVector(n,-n.x):new T.Vector3(0,1,0).addScaledVector(n,-n.y);t.normalize();
        b.p.push(...positions[i]);b.n.push(...n.toArray());b.j.push(ji,0,0,0);b.w.push(1,0,0,0);b.uv.push(...(uvs?.[i]??[positions[i][0],positions[i][1]]));b.tan.push(...t.toArray(),flat?(new T.Vector3().crossVectors(n,t).dot(bitangent)<0?-1:1):(smoothTangent.getW(i)<0?-1:1));
      }
    }
    geo.dispose();
  }
  /** Bevelled, fractured slab. Local +Z is the exposed stone face; UVs stay in that face's plane. */
  plate(mat:string,c:V,s:V,bone:string,seed=0,rotation:V=[0,0,0]){
    const count=7,p:V[]=[],uv:[number,number][]=[],f:number[][]=[],q=new T.Quaternion().setFromEuler(new T.Euler(...rotation));
    const put=(x:number,y:number,z:number)=>{p.push(new T.Vector3(x*s[0],y*s[1],z*s[2]).applyQuaternion(q).add(new T.Vector3(...c)).toArray() as V);uv.push([x*.48+.5+(mat==='moss'?0:seed*.173),y*.48+.5+(mat==='moss'?0:seed*.237)]);};
    for(let ring=0;ring<3;ring++)for(let i=0;i<count;i++){
      const outline=[[-.9,-.62],[.1,-1],[.84,-.48],[1,.38],[.13,1],[-.76,.7],[-1,.01]],warp=1+.14*Math.sin(i*12.719+seed*2.17),scale=[.84,1,.79][ring];
      put(outline[i][0]*warp*scale,outline[i][1]*warp*scale,[-.7,-.04,.55][ring]+.08*Math.sin(i*4.3+seed));
    }
    put(.05,-.03,.61);put(0,0,-.76);
    for(let i=0;i<count;i++){
      const next=(i+1)%count;
      for(let r=0;r<2;r++){const a=r*count+i,b=r*count+next;f.push([a,b,a+count],[b,b+count,a+count]);}
      f.push([count*3,count*2+i,count*2+next],[count*3+1,next,i]);
    }
    this.add(mat,bone,p,f,true,uv);
  }
  ell(mat:string,c:V,s:V,bone:string,seed=0,rock=false){
    const nu=rock?9:18,nv=rock?6:12,p:V[]=[[c[0],c[1]+s[1],c[2]]],f:number[][]=[],uv:[number,number][]=[[.5,0]];
    for(let j=1;j<nv;j++)for(let i=0;i<=nu;i++){
      const a=Math.PI*j/nv,t=2*Math.PI*i/nu,r=1+(rock?.14:.035)*Math.sin((i%nu)*7.13+j*5.7+seed);
      p.push([c[0]+s[0]*Math.sin(a)*Math.cos(t)*r,c[1]+s[1]*Math.cos(a)*r,c[2]+s[2]*Math.sin(a)*Math.sin(t)*r]);
      uv.push([i/nu,j/nv]);
    }
    const bottom=p.length;p.push([c[0],c[1]-s[1],c[2]]);uv.push([.5,1]);
    for(let i=0;i<nu;i++)f.push([0,2+i,1+i]);
    for(let j=0;j<nv-2;j++)for(let i=0;i<nu;i++){
      const a=1+j*(nu+1)+i,b=a+1,d=a+nu+1,e=b+nu+1;f.push([a,b,d],[b,e,d]);
    }
    for(let i=0;i<nu;i++)f.push([bottom,1+(nv-2)*(nu+1)+i,2+(nv-2)*(nu+1)+i]);
    this.add(mat,bone,p,f,rock,uv);
  }
  tube(mat:string,points:V[],radii:number[],bone:string,sides=7){
    if(points.length<2||!radii.length)throw Error('Tube requires at least two points and one radius');
    // Fewer radii than points is fine: interpolate along the path (e.g. [base, tip]).
    if(radii.length!==points.length){
      const src=radii;
      radii=points.map((_,i)=>{if(src.length===1)return src[0];const t=i/(points.length-1)*(src.length-1),k=Math.min(src.length-2,Math.floor(t));return src[k]+(src[k+1]-src[k])*(t-k);});
    }
    const p:V[]=[],f:number[][]=[],uv:[number,number][]=[];let distance=0;
    for(let j=0;j<points.length;j++){
      const t=new T.Vector3(...points[Math.min(j+1,points.length-1)]).sub(new T.Vector3(...points[Math.max(0,j-1)])).normalize();
      let u=t.clone().cross(new T.Vector3(0,0,1));if(u.length()<.01)u=t.clone().cross(new T.Vector3(1,0,0));u.normalize();const v=t.clone().cross(u);
      if(j)distance+=new T.Vector3(...points[j]).distanceTo(new T.Vector3(...points[j-1]));
      for(let i=0;i<=sides;i++){const a=2*Math.PI*i/sides;p.push(new T.Vector3(...points[j]).addScaledVector(u,radii[j]*Math.cos(a)).addScaledVector(v,radii[j]*Math.sin(a)).toArray() as V);uv.push([i/sides,distance/.65]);}
    }
    for(let j=0;j<points.length-1;j++)for(let i=0;i<sides;i++){
      const a=j*(sides+1)+i,b=a+1,c=a+sides+1,d=b+sides+1;f.push([a,b,c],[b,d,c]);
    }
    // End caps need their own planar UV islands and normals, not a line of side-wall UVs.
    for(const end of [0,1]){
      const offset=p.length,source=(end?points.length-1:0)*(sides+1);
      for(let i=0;i<sides;i++){p.push([...p[source+i]] as V);const a=2*Math.PI*i/sides;uv.push([.5+.45*Math.cos(a),.5+.45*Math.sin(a)]);}
      const center=p.length;p.push([...points[end?points.length-1:0]] as V);uv.push([.5,.5]);
      for(let i=0;i<sides;i++)f.push(end?[center,offset+i,offset+(i+1)%sides]:[center,offset+(i+1)%sides,offset+i]);
    }
    this.add(mat,bone,p,f,false,uv);
  }
  channel(clip:any,bone:string,times:number[],rotations:V[]){
    if(times.length!==rotations.length||times.some((t,i)=>i>0&&t<=times[i-1]))throw Error('Animation times must increase');
    const values=rotations.flatMap(r=>new T.Quaternion().setFromEuler(new T.Euler(...r)).toArray());
    const input=this.access('SCALAR',new Float32Array(times));const output=this.access('VEC4',new Float32Array(values));
    const sampler=this.doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    clip.addSampler(sampler).addChannel(this.doc.createAnimationChannel().setTargetNode(this.nodes.get(bone)).setTargetPath('rotation').setSampler(sampler));
  }
  access(type:string,array:Float32Array|Uint16Array|Uint32Array){return this.doc.createAccessor().setType(type as any).setArray(array).setBuffer(this.buffer);}
  scaleFactor=1;
  /** Uniformly resize the whole asset (geometry, joints, bind poses) at export. */
  scale(factor:number){if(!Number.isFinite(factor)||factor<=0)throw Error('scale factor must be positive');this.scaleFactor=factor;return this;}
  async bytes(){
    for(const [name,s] of this.surfaces){
      if(s.tint&&s.tint.some(c=>c<0||c>1))throw Error(`Surface "${name}": tint components must be within 0..1 (glTF baseColorFactor range)`);
      if(s.alphaCutoff!==undefined&&(s.alphaCutoff<0||s.alphaCutoff>1))throw Error(`Surface "${name}": alphaCutoff must be within 0..1`);
    }
    if(this.scaleFactor!==1){
      const f=this.scaleFactor;
      for(const b of this.batches.values())for(let i=0;i<b.p.length;i++)b.p[i]*=f;
      for(const j of this.joints)j.at=j.at.map(x=>x*f) as V;
      for(const j of this.joints){const p=this.joints.find(q=>q.name===j.parent)?.at??[0,0,0];this.nodes.get(j.name).setTranslation(j.at.map((x,i)=>x-p[i]) as V);}
      this.scaleFactor=1;
    }
    // Rebase the complete bind pose, including joints and inverse binds, onto ground.
    let minimum=Infinity;for(const b of this.batches.values())for(let i=1;i<b.p.length;i+=3)minimum=Math.min(minimum,b.p[i]);
    const lift=Math.max(0,-minimum);
    if(lift){for(const b of this.batches.values())for(let i=1;i<b.p.length;i+=3)b.p[i]+=lift;for(const j of this.joints)j.at[1]+=lift;for(const j of this.joints.filter(j=>!j.parent)){const root=this.nodes.get(j.name),t=root.getTranslation();root.setTranslation([t[0],t[1]+lift,t[2]]);}}
    const skin=this.doc.createSkin('rig');const ibm:number[]=[];
    for(const j of this.joints){skin.addJoint(this.nodes.get(j.name));ibm.push(...new T.Matrix4().makeTranslation(-j.at[0],-j.at[1],-j.at[2]).toArray());}
    skin.setInverseBindMatrices(this.access('MAT4',new Float32Array(ibm))).setSkeleton(this.nodes.get(this.joints[0].name));
    const mesh=this.doc.createMesh('body');
    for(const [name,b] of this.batches){
      const m=this.doc.createMaterial(name).setBaseColorFactor([...(palette[name]??[.7,.7,.7]),1]).setRoughnessFactor(.87).setMetallicFactor(0);
      const surface=this.surfaces.get(name);
      if(surface){
        const texture=(suffix:string,bytes:Uint8Array)=>this.doc.createTexture(`${name}-${suffix}`).setImage(bytes).setMimeType(bytes[0]===255?'image/jpeg':'image/png');
        m.setBaseColorFactor([...(surface.tint??[1,1,1]),1]).setBaseColorTexture(texture('albedo',surface.baseColor));
        if(surface.alphaCutoff!==undefined)m.setAlphaMode('MASK').setAlphaCutoff(surface.alphaCutoff);
        if(surface.normal)m.setNormalTexture(texture('normal',surface.normal)).setNormalScale(surface.normalScale??.65);
        if(surface.roughness)m.setMetallicRoughnessTexture(texture('roughness',surface.roughness)).setRoughnessFactor(1);
      }
      if(name==='eye')m.setEmissiveFactor(palette.eye.map(c=>c*.7) as V);
      mesh.addPrimitive(this.doc.createPrimitive().setMaterial(m)
        .setAttribute('POSITION',this.access('VEC3',new Float32Array(b.p)))
        .setAttribute('NORMAL',this.access('VEC3',new Float32Array(b.n)))
        .setAttribute('TEXCOORD_0',this.access('VEC2',new Float32Array(b.uv)))
        .setAttribute('TANGENT',this.access('VEC4',new Float32Array(b.tan)))
        .setAttribute('JOINTS_0',this.access('VEC4',new Uint16Array(b.j)))
        .setAttribute('WEIGHTS_0',this.access('VEC4',new Float32Array(b.w))));
    }
    this.scene.addChild(this.doc.createNode('body').setMesh(mesh).setSkin(skin));
    await this.doc.transform(weld(),dedup(),prune());
    const bytes=await new NodeIO().writeBinary(this.doc);scheduleCleanup();return bytes;
  }
}
