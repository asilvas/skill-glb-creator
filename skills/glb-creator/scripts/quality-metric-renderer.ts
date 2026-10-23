import * as T from 'three';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {mkdirSync} from 'node:fs';
import {Preview} from './preview';
import {TMP} from './paths';
import {compareQualityFrames,QUALITY_METRIC_VERSION,type QualityImage,type QualityEvaluatorOptions,type QualityObservation} from './quality-metric';

type Spec={id:string;yaw:number;clip:number;time:number;light:'studio'|'opposite';focus?:'upper-center';size?:number};
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const limits=['Rendered similarity is a deterministic image proxy, not calibrated human perceived quality or an absolute reference-fidelity score.','The retention is the minimum required-frame guard; silhouette IoU, foreground appearance and focal-patch lower tail must all pass.','Finite cameras and sampled key/phase times cannot prove invisible-surface fidelity, mip behavior, continuous motion or target-engine acceptance.','Per-clip key-time quantiles and phases are bounded; no clip is silently omitted. Increase sample/frame budgets for complex motion.'];
/** Render-only partitioning bounds submitted geometry chunks for native0.4.5.
 * Flat/missing-normal geometry can expand to72bytes per triangle corner. No
 * source normals, triangles or texture samples are invented or discarded.
 */
export function partitionRenderMeshes(asset:T.Object3D,options:{maxTriangles?:number;force?:boolean}={}){
 const maxTriangles=options.maxTriangles??200000;
 if(!Number.isInteger(maxTriangles)||maxTriangles<1)throw Error('maxTriangles must be positive');
 const originals:T.Mesh[]=[];asset.traverse((o:any)=>{if(o.isMesh&&o.geometry?.getAttribute('position'))originals.push(o);});
 const reports:any[]=[];
 for(const original of originals){
  const geometry=original.geometry,position=geometry.getAttribute('position'),index=geometry.getIndex(),count=index?.count??position.count;
  const materials=Array.isArray(original.material)?original.material:[original.material],flat=!geometry.getAttribute('normal')||materials.some(m=>m.flatShading===true);
  const estimatedBytes=(flat?count:position.count)*72;
  if(count<=maxTriangles*3||!options.force&&estimatedBytes<=128*1024*1024)continue;
  if(count%3)throw Error('Cannot partition a non-triangle render mesh');
  const raw=(attribute:any,vertex:number,c:number)=>attribute.isInterleavedBufferAttribute?attribute.data.array[vertex*attribute.data.stride+attribute.offset+c]:attribute.array[vertex*attribute.itemSize+c];
  const copy=(attribute:any,vertices:number[])=>{
   const array=attribute.isInterleavedBufferAttribute?attribute.data.array:attribute.array;
   const values=new (array.constructor as any)(vertices.length*attribute.itemSize);
   for(let i=0;i<vertices.length;i++)for(let c=0;c<attribute.itemSize;c++)values[i*attribute.itemSize+c]=raw(attribute,vertices[i],c);
   const out=new T.BufferAttribute(values,attribute.itemSize,attribute.normalized);out.name=attribute.name;out.gpuType=attribute.gpuType;return out;
  };
  let partitions=0,copiedCorners=0;
  for(let start=0;start<count;start+=maxTriangles*3){
   const end=Math.min(count,start+maxTriangles*3),map=new Map<number,number>(),vertices:number[]=[],indices=new Uint32Array(end-start);
   for(let i=start;i<end;i++){const source=index?index.getX(i):i;let target=map.get(source);if(target===undefined){target=vertices.length;vertices.push(source);map.set(source,target);}indices[i-start]=target;}
   const chunk=new T.BufferGeometry();for(const [name,attribute] of Object.entries(geometry.attributes))chunk.setAttribute(name,copy(attribute,vertices));chunk.setIndex(new T.BufferAttribute(indices,1));
   for(const [name,attributes] of Object.entries(geometry.morphAttributes))chunk.morphAttributes[name]=attributes!.map(attribute=>copy(attribute,vertices));chunk.morphTargetsRelative=geometry.morphTargetsRelative;
   for(const group of geometry.groups){const lo=Math.max(start,group.start),hi=Math.min(end,group.start+group.count);if(hi>lo)chunk.addGroup(lo-start,hi-lo,group.materialIndex);}
   const drawStart=Math.max(start,geometry.drawRange.start),drawEnd=Math.min(end,geometry.drawRange.start+geometry.drawRange.count);chunk.setDrawRange(Math.max(0,drawStart-start),Math.max(0,drawEnd-drawStart));
   const mesh:any=(original as any).isSkinnedMesh?new T.SkinnedMesh(chunk,original.material):new T.Mesh(chunk,original.material);
   mesh.name=`${original.name||'mesh'}__render_partition_${partitions+1}`;mesh.castShadow=original.castShadow;mesh.receiveShadow=original.receiveShadow;mesh.frustumCulled=false;mesh.renderOrder=original.renderOrder;mesh.layers.mask=original.layers.mask;
   original.add(mesh);
   if((original as any).isSkinnedMesh){const skinned=original as T.SkinnedMesh;mesh.bindMode=skinned.bindMode;mesh.bind(skinned.skeleton,skinned.bindMatrix);}
   if(original.morphTargetInfluences){mesh.morphTargetInfluences=original.morphTargetInfluences;mesh.morphTargetDictionary=original.morphTargetDictionary;}
   copiedCorners+=indices.length;partitions++;
  }
  // Keep the original object/UUID as an animation target and transform parent.
  // An empty render geometry avoids re-uploading its oversized original buffer.
  original.geometry=new T.BufferGeometry();original.geometry.boundingBox=new T.Box3();original.geometry.boundingSphere=new T.Sphere(new T.Vector3(),0);original.frustumCulled=false;
  if((original as any).isSkinnedMesh){(original as any).boundingBox=new T.Box3();(original as any).boundingSphere=new T.Sphere(new T.Vector3(),0);}
  geometry.dispose();
  if(copiedCorners!==count)throw Error('Render partition lost triangle corners');
  reports.push({name:original.name,sourceVertices:position.count,triangleCorners:count,triangles:count/3,partitions,schedulingVertexByteEstimate:estimatedBytes,opaqueNativePackedStrideKnown:false,maxTrianglesPerPartition:maxTriangles,sourceNormalsPresent:!!geometry.getAttribute('normal'),flatShading:flat,surfaceAndAttributes:'Each original corner/index is copied in order with every raw attribute, normalization, material group, morph and skin binding; source/delivery GLB bytes are unchanged.'});
 }
 return reports;
}
function sampleTimes(clip:T.AnimationClip,max:number){
 const d=clip.duration;if(!(d>0))return [0];
 const keys=[...new Set(clip.tracks.flatMap(t=>Array.from(t.times).filter(v=>Number.isFinite(v)&&v>=0&&v<=d)))].sort((a,b)=>a-b);
 const selected=new Set<number>([0,d]);
 if(keys.length<=max)for(const t of keys)selected.add(t);
 else for(let i=1;i<max-1;i++)selected.add(keys[Math.round((keys.length-1)*i/(max-1))]);
 for(let i=1;selected.size<max&&i<max-1;i++)selected.add(d*i/(max-1));
 return [...selected].sort((a,b)=>a-b);
}

/** One native session, one cached baseline, serial candidate work and explicit disposal. */
export async function createRenderedQualityEvaluator(masterBytes:Uint8Array,options:QualityEvaluatorOptions={}){
 const size=options.size??384,maxAnimationSamples=options.maxAnimationSamples??5,maxFrames=options.maxFrames??512;
 if(!Number.isInteger(size)||size<64||size>512)throw Error('Quality size must be an integer64..512');
 if(!Number.isInteger(maxAnimationSamples)||maxAnimationSamples<3||maxAnimationSamples>33)throw Error('maxAnimationSamples must be3..33');
 if(!Number.isInteger(maxFrames)||maxFrames<8)throw Error('maxFrames must be at least8');
 const start=performance.now(),preview=await Preview.create();let current:any,disposed=false;
 for(const o of [...preview.scene.children])if((o as any).isMesh){preview.scene.remove(o);(o as any).geometry?.dispose();(o as any).material?.dispose();}
 preview.scene.background=null;
 const lights=preview.scene.children.filter((o:any)=>o.isDirectionalLight).map((o:any)=>({object:o,position:o.position.clone()}));
 async function load(bytes:Uint8Array){
  preview.releaseAsset();current=null;
  const {createNodeGltfLoader}=await import('@headless-three/renderer'),{loader}=await createNodeGltfLoader(TMP);
  const {MeshoptDecoder}=await import('meshoptimizer/decoder');await MeshoptDecoder.ready;loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf:any=await new Promise((yes,no)=>loader.parse(bytes.slice().buffer,'',yes,no));
  current=gltf;preview.asset=gltf.scene;preview.scene.add(gltf.scene);preview.mixer=new T.AnimationMixer(gltf.scene);
  gltf.scene.traverse((o:any)=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  gltf.renderPartitions=partitionRenderMeshes(gltf.scene);
  return gltf;
 }
 function pose(clip:number,time:number){
  preview.mixer.stopAllAction();
  if(clip>=0){const action=preview.mixer.clipAction(current.animations[clip]);action.reset();action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;action.time=time;preview.mixer.update(0);}
  preview.asset.updateMatrixWorld(true);preview.asset.traverse((o:any)=>{if(o.isSkinnedMesh)o.skeleton.update();});
 }
 let specs:Spec[]=[],sourceClips:any[]=[],bounds=new T.Box3();
 try{
  const gltf=await load(masterBytes);
  const yaws=[-Math.PI/4,Math.PI/4,3*Math.PI/4,5*Math.PI/4];
  specs=yaws.map((yaw,i)=>({id:`rest-${i+1}`,yaw,clip:-1,time:0,light:'studio'}));
  specs.push(...yaws.map((yaw,i)=>({id:`opposite-${i+1}`,yaw,clip:-1,time:0,light:'opposite' as const})));
  specs.push(...yaws.slice(0,2).map((yaw,i)=>({id:`focal-${i+1}`,yaw,clip:-1,time:0,light:'studio' as const,focus:'upper-center' as const,size:512})));
  sourceClips=gltf.animations.map((clip:T.AnimationClip,index:number)=>{
   const times=sampleTimes(clip,maxAnimationSamples),keys=[...new Set(clip.tracks.flatMap(t=>Array.from(t.times)))].sort((a,b)=>a-b);
   for(const [i,time] of times.entries())specs.push({id:`clip-${index+1}-phase-${i+1}`,yaw:-Math.PI/4,clip:index,time,light:'studio'});
   specs.push({id:`clip-${index+1}-opposite`,yaw:3*Math.PI/4,clip:index,time:times[Math.floor(times.length/2)]??0,light:'opposite'});
   return {index,name:clip.name,duration:clip.duration,trackCount:clip.tracks.length,sourceKeyTimes:keys,sampleTimes:times};
  });
  if(specs.length>maxFrames)throw Error(`Quality protocol requires${specs.length} frames, above maxFrames=${maxFrames}; increase the explicit budget. No clips were omitted.`);
  bounds.makeEmpty();for(const spec of specs){pose(spec.clip,spec.time);bounds.union(new T.Box3().setFromObject(preview.asset,true));}
  if(bounds.isEmpty()||!Number.isFinite(bounds.min.x)||bounds.getSize(new T.Vector3()).length()<=1e-8)throw Error('Master has no finite renderable bounds');
 }catch(e){await preview.dispose();throw e;}
 const center=bounds.getCenter(new T.Vector3()),radius=bounds.getSize(new T.Vector3()).length()/2;
 const protocol={metricVersion:QUALITY_METRIC_VERSION,rendererPreparation:'exact-render-partition-v1',masterRenderPartitions:current.renderPartitions,size,focalResolution:512,masterSHA256:hash(masterBytes),masterCaptureDir:options.captureDir?resolve(options.captureDir,'master'):undefined,frameCount:specs.length,frames:specs.map(s=>({...s,width:s.size??size,height:s.size??size,masterCapturePath:options.captureDir?resolve(options.captureDir,'master',s.id+'.png'):undefined})),clips:sourceClips,bounds:[bounds.min.toArray(),bounds.max.toArray()],framing:'Source-only union across every required rest/clip sample; same orthographic camera bounds per view for every candidate',focalRegion:'Two true512px camera closeups of upper55%height and center72%width, derived from source bounds; generic region, not semantic face detection.',elevationDegrees:12,foreground:'RGBA alpha>=128; no floor or background contribution',aggregation:'minimum over all frames of silhouetteIoU, .55 foregroundSSIM + .25 RGBretention + .20 lumaEdgeRetention, focal4x4-patchP10, independent luma edgeRetention, and independent RGB edgeRetention',edgeFormula:{gradient:'central difference in x/y; only centers and four neighbors foreground in both images',lumaWeights:[.2126,.7152,.0722],rgb:'mean absolute channel errors and energies in normalized0..1 RGB',retention:'clamp01(1 - sum(abs(masterGradient-candidateGradient)) / (.65*sum(abs(masterGradient)+abs(candidateGradient)) + .01*sampleCount + 1e-9))'},calibration:'Independent luma and RGB edge guards supplement silhouette/color/structure. Threshold is an image proxy, not a calibrated human-quality percentage; independent review remains required.',maxAnimationSamples,maxFrames,limits};
 function setCamera(spec:Spec){
  const region=bounds.clone(),extent3=bounds.getSize(new T.Vector3());
  if(spec.focus){region.min.y=bounds.min.y+extent3.y*.45;region.min.x=center.x-extent3.x*.36;region.max.x=center.x+extent3.x*.36;}
  const target=region.getCenter(new T.Vector3()),elevation=12*Math.PI/180,distance=radius*4+1,delta=new T.Vector3(Math.sin(spec.yaw)*Math.cos(elevation),Math.sin(elevation),Math.cos(spec.yaw)*Math.cos(elevation));
  preview.camera.position.copy(target).addScaledVector(delta,distance);preview.camera.lookAt(target);preview.camera.near=Math.max(1e-5,distance/10000);preview.camera.far=distance*4;preview.camera.updateMatrixWorld(true);
  let extent=0;for(const x of [region.min.x,region.max.x])for(const y of [region.min.y,region.max.y])for(const z of [region.min.z,region.max.z]){const p=new T.Vector3(x,y,z).applyMatrix4(preview.camera.matrixWorldInverse);extent=Math.max(extent,Math.abs(p.x),Math.abs(p.y));}
  const half=Math.max(.001,extent*1.08);Object.assign(preview.camera,{left:-half,right:half,top:half,bottom:-half});preview.camera.updateProjectionMatrix();
  for(const {object,position} of lights){object.position.copy(position);if(spec.light==='opposite'){object.position.x*=-1;object.position.z*=-1;}}
 }
 async function render(spec:Spec):Promise<QualityImage>{
  pose(spec.clip,spec.time);setCamera(spec);
  // Preserve genuine custom shaders; normalize only Three's unchanged empty hook.
  preview.scene.traverse((o:any)=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])if(m.onBeforeCompile===T.Material.prototype.onBeforeCompile)m.onBeforeCompile=undefined;});
  const frameSize=spec.size??size,pixels=await preview.renderer.render(preview.scene,preview.camera,{width:frameSize,height:frameSize,format:'rgba',background:[0,0,0,0]});
  if(!(pixels instanceof Uint8Array)||pixels.length!==frameSize*frameSize*4)throw Error('Native renderer returned invalid RGBA');
  return {pixels:Uint8Array.from(pixels),width:frameSize,height:frameSize};
 }
 async function capture(frame:QualityImage,folder:string,name:string){if(!options.captureDir)return;const path=resolve(options.captureDir,folder);mkdirSync(path,{recursive:true});await sharp(frame.pixels,{raw:{width:frame.width,height:frame.height,channels:4}}).png().toFile(join(path,`${name}.png`));}
 const baseline:QualityImage[]=[];
 try{
  for(const spec of specs){const frame=await render(spec),self=compareQualityFrames(frame,frame,{allowFullForeground:!!spec.focus});if(!self.valid)throw Error(`Invalid master frame ${spec.id}: ${self.reason}`);baseline.push(frame);await capture(frame,'master',spec.id);}
  if(options.captureDir){mkdirSync(resolve(options.captureDir),{recursive:true});await Bun.write(resolve(options.captureDir,'protocol.json'),JSON.stringify(protocol,null,2));}
 }catch(e){await preview.dispose();throw e;}
 let queue=Promise.resolve();
 return {
  protocol:{...protocol,baselineSeconds:(performance.now()-start)/1000},
  async evaluate(candidateBytes:Uint8Array):Promise<QualityObservation>{
   let release!:()=>void;const previous=queue;queue=new Promise<void>(r=>release=r);await previous;const begin=performance.now();
   try{
    if(disposed)return {valid:false,retention:null,reason:'Quality evaluator disposed',metricVersion:QUALITY_METRIC_VERSION};
    const gltf=await load(candidateBytes);
    if(gltf.animations.length!==sourceClips.length||sourceClips.some((s,i)=>{const c=gltf.animations[i];return !c||c.name!==s.name||Math.abs(c.duration-s.duration)>1e-4||c.tracks.length!==s.trackCount;}))return {valid:false,retention:null,reason:'Candidate animation inventory differs from master',metricVersion:QUALITY_METRIC_VERSION};
    const scores:any[]=[],candidateHash=hash(candidateBytes);
    for(const [i,spec] of specs.entries()){
     const frame=await render(spec),score=compareQualityFrames(baseline[i],frame,{allowFullForeground:!!spec.focus});scores.push({id:spec.id,width:frame.width,height:frame.height,capturePath:options.captureDir?resolve(options.captureDir,candidateHash.slice(0,16),spec.id+'.png'):undefined,...score});await capture(frame,candidateHash.slice(0,16),spec.id);
     if(!score.valid)return {valid:false,retention:null,reason:`Invalid candidate frame ${spec.id}: ${score.reason}`,frames:scores,metricVersion:QUALITY_METRIC_VERSION,seconds:(performance.now()-begin)/1000};
    }
    const retention=Math.min(...scores.map(s=>s.retention));
    return {valid:Number.isFinite(retention),retention:Number.isFinite(retention)?retention:null,frames:scores,metrics:{meanFrameRetention:scores.reduce((s,f)=>s+f.retention,0)/scores.length,worstFrame:scores.reduce((a,b)=>a.retention<=b.retention?a:b).id,masterSHA256:protocol.masterSHA256,candidateSHA256:candidateHash,renderPartitions:current.renderPartitions},metricVersion:QUALITY_METRIC_VERSION,seconds:(performance.now()-begin)/1000};
   }catch(e){return {valid:false,retention:null,reason:String(e),metricVersion:QUALITY_METRIC_VERSION,seconds:(performance.now()-begin)/1000};}
   finally{release();}
  },
  async dispose(){if(disposed)return;disposed=true;await queue;baseline.length=0;await preview.dispose();}
 };
}
