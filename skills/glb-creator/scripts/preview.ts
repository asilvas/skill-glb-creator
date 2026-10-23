import * as T from 'three';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { resolve,dirname,relative,isAbsolute } from 'node:path';
import { ROOT,TMP } from './paths';
import { scheduleCleanup } from './cleanup';
export type Frame={time?:number,yaw?:number,size?:number,format?:'png'|'jpeg'|'webp'|'rgba',capture?:string,analyze?:boolean,framing?:'clip'|'pose',clip?:string|number|false};
export type View={time?:number,yaw?:number,label?:string,framing?:'clip'|'pose',clip?:string|number|false};
export type Sheet={views?:View[],tile?:number,format?:'webp'|'png',capture?:string};
export function capturePath(path:string){
  const target=resolve(TMP,path),rel=relative(TMP,target);
  if(!rel||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))throw Error('Capture must be inside tmp');
  return target;
}
/** Persistent GLB + renderer session. No screenshot I/O unless capture is specified. */
export class Preview {
  scene=new T.Scene();camera=new T.OrthographicCamera(-2.9,2.9,2.9,-2.9,.01,100);
  asset:any;mixer:any;action:any;renderer:any;size=512;
  renderRGBA?: (size:number)=>Promise<Uint8Array>;
  bounds=new T.Box3();restBounds=new T.Box3();clips:{name:string,duration:number}[]=[];
  animations:T.AnimationClip[]=[];
  selectedClip:number|false=false;
  constructor(){this.scene.background=new T.Color(.55,.51,.43);
    this.scene.add(new T.HemisphereLight(0xffffff,0x554a35,1.2));
    for(const [pos,power,color] of [[[4,8,6],3,0xffe3bd],[[-4,4,2],1.5,0xe1ebff],[[0,6,-4],2,0xffffff]] as const){const l=new T.DirectionalLight(color,power);l.position.set(...pos);if(pos[0]===4){l.castShadow=true;l.shadow.mapSize.set(2048,2048);Object.assign(l.shadow.camera,{left:-5,right:5,top:6,bottom:-5,near:.1,far:30});l.shadow.bias=-.0003;l.shadow.normalBias=.01;}this.scene.add(l);}
    const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:0x9d917a,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.01;floor.receiveShadow=true;this.scene.add(floor);
  }
  static async create(){
    const p=new Preview(),{Renderer}=await import('@headless-three/renderer');
    p.renderer=new Renderer();p.renderer.shadowMap.enabled=true;return p;
  }
  async load(bytes:Uint8Array){
    // GLTFLoader accepts ArrayBuffer directly; no intermediate GLB file is needed.
    // The renderer's maintained loader decodes embedded PNG/JPEG from bufferViews in
    // memory. Stock Three's browser Image loader cannot do this under Bun.
    const {createNodeGltfLoader}=await import('@headless-three/renderer');
    const {loader}=await createNodeGltfLoader(TMP);
    const header=new TextDecoder().decode(bytes.subarray(20,20+new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(12,true)));
    if(header.includes('EXT_meshopt_compression')){const {MeshoptDecoder}=await import('meshoptimizer/decoder');await MeshoptDecoder.ready;loader.setMeshoptDecoder(MeshoptDecoder);}
    const gltf:any=await new Promise((resolve,reject)=>loader.parse(bytes.slice().buffer,'',resolve,reject));
    this.releaseAsset();this.asset=gltf.scene;this.animations=gltf.animations;this.scene.add(this.asset);
    this.asset.traverse((o:any)=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    this.mixer=new T.AnimationMixer(this.asset);
    // Freeze one common camera union over rest and EVERY clip. Finite sampling
    // is inspection evidence, not proof that every possible pose is inside it.
    this.asset.updateMatrixWorld(true);
    this.restBounds.setFromObject(this.asset,true);this.bounds.copy(this.restBounds);
    for(let clip=0;clip<this.animations.length;clip++){
      this.setClip(clip);const duration=this.animations[clip].duration;
      for(let i=0;i<17;i++){
      this.applyPose(duration*i/16);this.asset.updateMatrixWorld(true);
      this.asset.traverse((m:any)=>{if(m.isSkinnedMesh)m.skeleton.update();});
      const box=new T.Box3().setFromObject(this.asset,true);
      this.bounds.union(box);
      }
    }
    if(this.bounds.isEmpty())throw Error('Asset contains no renderable geometry');
    this.setClip(this.animations.length?0:false);this.applyPose(0);this.asset.updateMatrixWorld(true);
    scheduleCleanup();
    this.clips=gltf.animations.map((a:any)=>({name:a.name,duration:a.duration}));
    return {clips:this.clips,nodes:this.asset.children.length};
  }
  /** Select a named/indexed clip or false for the original bind/rest state. */
  setClip(clip:string|number|false){
    const index=typeof clip==='string'?this.animations.findIndex(a=>a.name===clip):clip;
    if(index!==false&&(!Number.isInteger(index)||index<0||index>=this.animations.length))throw Error(`Unknown animation ${clip}`);
    if(this.selectedClip===index&&this.action)return;
    this.mixer.stopAllAction();this.action=undefined;this.selectedClip=index;
    if(index!==false){this.action=this.mixer.clipAction(this.animations[index]);this.applyPose(0);}
  }
  /** Absolute, non-wrapping sampling includes the true endpoint of non-looping clips. */
  applyPose(time:number){
    if(!Number.isFinite(time)||time<0)throw Error('Invalid animation time');
    if(this.action){this.action.reset().setLoop(T.LoopOnce,1);this.action.clampWhenFinished=true;this.action.play();this.action.paused=true;this.action.time=Math.min(time,this.action.getClip().duration);}
    this.mixer.update(0);
  }
  releaseAsset(){
    if(!this.asset)return;this.mixer?.stopAllAction();this.mixer?.uncacheRoot(this.asset);this.scene.remove(this.asset);
    const textures=new Set<any>(),materials=new Set<any>(),geometries=new Set<any>();
    this.asset.traverse((o:any)=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if((v as any)?.isTexture)textures.add(v);}});
    for(const t of textures)t.dispose();for(const m of materials)m.dispose();for(const g of geometries)g.dispose();this.asset=null;this.animations=[];this.clips=[];this.selectedClip=false;this.action=undefined;
  }
  async frame(options:Frame={}){
    if(!this.asset)throw Error('Load an asset first');
    const size=options.size??512,time=options.time??0,yaw=options.yaw??Math.atan2(6,10);
    if(!Number.isInteger(size)||size<32||size>2048||!Number.isFinite(time)||time<0||!Number.isFinite(yaw))throw Error('Invalid frame parameters');
    const capture=options.capture?capturePath(options.capture):undefined;
    if(options.clip!==undefined)this.setClip(options.clip);
    const start=performance.now();this.applyPose(time);this.asset.updateMatrixWorld(true);
    if(!this.renderRGBA)this.scene.traverse((o:any)=>{
      for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){
        // Bun strips comments from Three's empty prototype hook. Native 0.4.5 compares
        // its source to a literal containing that comment. Preserve all real hooks.
        if(typeof m.onBeforeCompile==='function'&&/^[^{]*\{\s*\}\s*$/.test(String(m.onBeforeCompile).replace(/\/\*[\s\S]*?\*\//g,'')))m.onBeforeCompile=undefined;
      }
    });
    this.asset.traverse((m:any)=>{if(m.isSkinnedMesh)m.skeleton.update();});
    const bounds=options.framing==='pose'?new T.Box3().setFromObject(this.asset,true):this.bounds;
    const center=bounds.getCenter(new T.Vector3()),distance=bounds.getSize(new T.Vector3()).length()*2+1;
    this.camera.position.copy(center).add(new T.Vector3(Math.sin(yaw)*distance,distance*3.25/11.662,Math.cos(yaw)*distance));
    this.camera.near=Math.max(.0001,distance/10000);this.camera.far=distance*5;
    this.camera.lookAt(center);this.camera.updateMatrixWorld(true);
    let extent=0;
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
      const q=new T.Vector3(x,y,z).applyMatrix4(this.camera.matrixWorldInverse);extent=Math.max(extent,Math.abs(q.x),Math.abs(q.y));
    }
    const half=Math.max(.01,extent*1.06);Object.assign(this.camera,{left:-half,right:half,top:half,bottom:-half});this.camera.updateProjectionMatrix();
    let pixels:Uint8Array;
    pixels=this.renderRGBA?await this.renderRGBA(size):this.renderer.render(this.scene,this.camera,{width:size,height:size,format:'rgba'});
    this.size=size;const renderMs=performance.now()-start;
    const encodeStart=performance.now();
    const encoder=sharp(pixels,{raw:{width:size,height:size,channels:4}});
    const bytes=options.format==='rgba'?pixels:options.format==='webp'?await encoder.webp({quality:82}).toBuffer():options.format==='jpeg'?await encoder.jpeg({quality:86}).toBuffer():await encoder.png().toBuffer();
    const encodeMs=performance.now()-encodeStart;
    const analyzeStart=performance.now();
    const stats=options.analyze?await sharp(pixels,{raw:{width:size,height:size,channels:4}}).stats():undefined;
    const analysisMs=performance.now()-analyzeStart;
    const writeStart=performance.now();if(capture){mkdirSync(dirname(capture),{recursive:true});await Bun.write(capture,bytes);}
    return {bytes,width:size,height:size,mime:options.format==='rgba'?'application/octet-stream':options.format==='webp'?'image/webp':options.format==='jpeg'?'image/jpeg':'image/png',stats,timing:{renderMs,encodeMs,analysisMs,writeMs:performance.now()-writeStart,totalMs:performance.now()-start}};
  }
  /** Standard inspection views: silhouette from three sides plus animation phases. */
  defaultViews():View[]{
    const base:View[]=[{time:0,yaw:0,label:'front',clip:false},{time:0,yaw:Math.PI/2,label:'left',clip:false},{time:0,yaw:Math.PI,label:'back',clip:false}];
    if(!this.clips.length)return [...base,{time:0,yaw:-Math.PI/4,label:'3/4'}];
    return [...base,...this.clips.flatMap((c,clip)=>[.3,.55,.85].map(f=>({clip,time:Math.round(c.duration*f*100)/100,yaw:-.6,label:`${this.clips.length>1?c.name+' ':''}t=${(c.duration*f).toFixed(2)}s`})) )];
  }
  /** One labeled grid image covering several poses/angles: a whole revision review in a single image read. */
  async sheet(options:Sheet={}){
    if(!this.asset)throw Error('Load an asset first');
    const start=performance.now(),tile=options.tile??416,views=options.views?.length?options.views:this.defaultViews();
    const cols=views.length<=4?2:3,rows=Math.ceil(views.length/cols);
    const cells:{pixels:Uint8Array,view:View,stdev:number}[]=[];
    for(const view of views){
      const f=await this.frame({time:view.time,yaw:view.yaw,size:tile,format:'rgba',framing:view.framing,clip:view.clip});
      const s=await sharp(f.bytes,{raw:{width:tile,height:tile,channels:4}}).stats();
      cells.push({pixels:f.bytes,view,stdev:Math.max(...s.channels.slice(0,3).map(c=>c.stdev))});
    }
    const width=cols*tile,height=rows*tile;
    const esc=(s:string)=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!));
    const labels=cells.map((c,i)=>{
      const x=(i%cols)*tile+8,y=Math.floor(i/cols)*tile+24,text=esc(c.view.label??`t=${c.view.time??0} yaw=${(c.view.yaw??0).toFixed(2)}`);
      return `<text x="${x}" y="${y}" font-family="sans-serif" font-size="20" font-weight="bold" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${text}</text>`;
    }).join('');
    const overlay=Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${labels}</svg>`);
    const image=sharp({create:{width,height,channels:4,background:{r:20,g:20,b:20,alpha:1}}}).composite([
      ...cells.map((c,i)=>({input:Buffer.from(c.pixels),raw:{width:tile,height:tile,channels:4 as const},left:(i%cols)*tile,top:Math.floor(i/cols)*tile})),
      {input:overlay,left:0,top:0}
    ]);
    const bytes=options.format==='png'?await image.png().toBuffer():await image.webp({quality:82}).toBuffer();
    const capture=options.capture?capturePath(options.capture):undefined;
    if(capture){mkdirSync(dirname(capture),{recursive:true});await Bun.write(capture,bytes);}
    return {bytes,width,height,mime:options.format==='png'?'image/png':'image/webp',
      tiles:cells.map(c=>({label:c.view.label,time:c.view.time??0,yaw:c.view.yaw??0,blank:c.stdev<4})),
      timing:{totalMs:performance.now()-start}};
  }
  async dispose(){this.releaseAsset();this.scene.traverse((o:any)=>{o.geometry?.dispose();o.material?.dispose();});await this.renderer?.dispose();}
}
if(import.meta.main){
  const args=process.argv.slice(2),backend='native';
  const preview=await Preview.create();const input=args.find(a=>a.endsWith('.glb'));const asset=input?resolve(ROOT,input):resolve(TMP,'bun.glb');
  console.log(await preview.load(new Uint8Array(await Bun.file(asset).arrayBuffer())));
  const capture=args.find(a=>a.startsWith('--capture='))?.slice(10);
  if(args.includes('--serve')){
    // Serialized GPU work; bind only loopback. Stop by receipt PID or Ctrl+C.
    let queue=Promise.resolve();
    const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
      let release!:()=>void;const prior=queue;queue=new Promise(r=>release=r);await prior;
      try{
        const u=new URL(req.url);
        if(u.pathname==='/health')return Response.json({backend,pid:process.pid});
        if(req.method==='POST'&&u.pathname==='/asset')return Response.json(await preview.load(new Uint8Array(await req.arrayBuffer())));
        const opts=req.method==='POST'?await req.json():{time:Number(u.searchParams.get('time')??0),yaw:Number(u.searchParams.get('yaw')??Math.atan2(6,10))};
        if(u.pathname==='/frame'){const r=await preview.frame(opts);return new Response(r.bytes,{headers:{'Content-Type':r.mime,'X-Render-Ms':String(r.timing.renderMs)}});}
        if(u.pathname==='/sheet'){const r=await preview.sheet(req.method==='POST'?opts:{});return new Response(r.bytes,{headers:{'Content-Type':r.mime,'X-Tiles':JSON.stringify(r.tiles)}});}
        if(u.pathname==='/analyze'){const r=await preview.frame({...opts,analyze:true});return Response.json({stats:r.stats,timing:r.timing});}
        return new Response('Unknown endpoint',{status:404});
      }catch(e){return new Response(String(e),{status:400});}finally{release();}
    }});
    const receipt={pid:process.pid,url:`http://127.0.0.1:${server.port}`,backend};await Bun.write(resolve(TMP,'preview-server.json'),JSON.stringify(receipt));console.log(receipt);
    process.on('SIGINT',async()=>{server.stop(true);await preview.dispose();process.exit(0);});
  }else{const r=await preview.frame({capture,analyze:true});console.log(JSON.stringify({timing:r.timing,bytes:r.bytes.length,stats:r.stats}));await preview.dispose();}
}
