import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
export type ReviewClip={name:string;duration:number;index:number};
export type ReviewViewerOptions={onStatus?:(message:string)=>void;onClips?:(clips:ReviewClip[])=>void};
function disposeObject(root:T.Object3D){const materials=new Set<T.Material>(),textures=new Set<T.Texture>(),geometries=new Set<T.BufferGeometry>(),skeletons=new Set<T.Skeleton>();root.traverse((o:any)=>{if(o.geometry)geometries.add(o.geometry);if(o.skeleton)skeletons.add(o.skeleton);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if((v as any)?.isTexture)textures.add(v as T.Texture);}});for(const t of textures)t.dispose();for(const m of materials)m.dispose();for(const g of geometries)g.dispose();for(const s of skeletons)s.dispose();}
/** Local, self-contained PBR/animation viewer shared by skill review and experiment dashboard. */
export class AssetReviewViewer{
  host:HTMLElement;stage:HTMLDivElement;toolbar:HTMLDivElement;status:HTMLParagraphElement;
  renderer:T.WebGLRenderer;scene=new T.Scene();camera=new T.PerspectiveCamera(36,1,.01,100);
  controls:OrbitControls;asset:T.Object3D|null=null;mixer:T.AnimationMixer|null=null;action:T.AnimationAction|null=null;
  clips:T.AnimationClip[]=[];serial=0;disposed=false;observer:ResizeObserver;last=0;playing=false;
  clipSelect:HTMLSelectElement;playButton:HTMLButtonElement;scrub:HTMLInputElement;timeText:HTMLSpanElement;
  loop:HTMLInputElement;speed:HTMLSelectElement;wire:HTMLInputElement;orbit:HTMLInputElement;
  key=new T.DirectionalLight('#fff8e9',3);envTarget:T.WebGLRenderTarget;
  constructor(host:HTMLElement,public options:ReviewViewerOptions={}){
    this.host=host;host.classList.add('glb-review-viewer');
    host.style.display='flex';host.style.flexDirection='column';host.style.minHeight='360px';
    this.toolbar=document.createElement('div');this.toolbar.style.cssText='display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px;background:#1d2724;color:#edf0e8;font:13px system-ui,sans-serif;';
    const label=(name:string,control:HTMLElement)=>{const l=document.createElement('label');l.style.cssText='display:flex;gap:6px;align-items:center';l.append(document.createTextNode(name),control);this.toolbar.append(l);return control;};
    const button=(name:string,fn:()=>void)=>{const b=document.createElement('button');b.textContent=name;b.type='button';b.style.cssText='background:#304637;color:#edf0e8;border:1px solid #69836a;border-radius:6px;padding:6px 10px;cursor:pointer';b.addEventListener('click',fn);this.toolbar.append(b);return b;};
    const checkbox=()=>{const x=document.createElement('input');x.type='checkbox';return x;};
    this.clipSelect=document.createElement('select');this.clipSelect.setAttribute('aria-label','Animation clip');this.clipSelect.style.maxWidth='250px';label('Clip',this.clipSelect);
    this.clipSelect.addEventListener('change',()=>this.selectClip(Number(this.clipSelect.value)));
    this.playButton=button('Play',()=>this.setPlaying(!this.playing));
    button('Rest',()=>{this.clipSelect.value='-1';this.selectClip(-1);});button('Fit pose',()=>this.fit());
    this.loop=checkbox();this.loop.checked=true;label('Loop',this.loop);this.loop.addEventListener('change',()=>this.updateLoop());
    this.speed=document.createElement('select');this.speed.setAttribute('aria-label','Playback speed');for(const n of [.25,.5,1,1.5,2]){const o=new Option(`${n}×`,String(n));o.selected=n===1;this.speed.add(o);}label('Speed',this.speed);
    this.wire=checkbox();label('Wireframe',this.wire);this.wire.addEventListener('change',()=>this.asset?.traverse((o:any)=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])m.wireframe=this.wire.checked;}));
    this.orbit=checkbox();label('Orbit',this.orbit);this.orbit.addEventListener('change',()=>this.controls.autoRotate=this.orbit.checked);
    const light=document.createElement('input');light.type='range';light.min='-180';light.max='180';light.value='-40';light.style.width='100px';light.setAttribute('aria-label','Light direction');label('Light',light);light.addEventListener('input',()=>{const a=Number(light.value)*Math.PI/180;this.key.position.set(Math.sin(a)*4,3,Math.cos(a)*4);});
    button('Capture PNG',()=>{this.renderer.render(this.scene,this.camera);this.renderer.domElement.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='asset-review.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},'image/png');});
    const timeline=document.createElement('div');timeline.style.cssText='display:flex;align-items:center;gap:12px;padding:8px 12px;background:#17201c;color:#b9c4b9;font:12px system-ui,sans-serif';
    this.scrub=document.createElement('input');this.scrub.type='range';this.scrub.min='0';this.scrub.max='1';this.scrub.step='.0001';this.scrub.value='0';this.scrub.style.flex='1';this.scrub.setAttribute('aria-label','Animation time');
    this.timeText=document.createElement('span');this.timeText.textContent='Rest pose';timeline.append(this.scrub,this.timeText);
    this.scrub.addEventListener('input',()=>{if(!this.action)return;this.setPlaying(false);this.action.time=Number(this.scrub.value)*this.action.getClip().duration;this.mixer!.update(0);this.updateTime();});
    this.stage=document.createElement('div');this.stage.style.cssText='position:relative;flex:1;min-height:250px;background:#555a5b;overflow:hidden';
    this.status=document.createElement('p');this.status.style.cssText='margin:0;padding:7px 12px;background:#17201c;color:#b9c4b9;font:12px system-ui,sans-serif';
    host.replaceChildren(this.toolbar,this.stage,timeline,this.status);
    this.renderer=new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor('#555a5b');this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;
    this.stage.append(this.renderer.domElement);this.renderer.domElement.style.cssText='display:block;width:100%;height:100%;touch-action:none';
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.autoRotateSpeed=1;
    const room=new RoomEnvironment(),pmrem=new T.PMREMGenerator(this.renderer);this.envTarget=pmrem.fromScene(room,.04);this.scene.environment=this.envTarget.texture;room.dispose();pmrem.dispose();
    this.scene.add(new T.HemisphereLight('#f5f3ed','#777b7e',2));this.key.position.set(-3,4,4);this.scene.add(this.key);const fill=new T.DirectionalLight('#dfe9f0',1.2);fill.position.set(4,1,-3);this.scene.add(fill);
    this.observer=new ResizeObserver(()=>{const box=this.stage.getBoundingClientRect();if(box.width&&box.height){this.renderer.setSize(box.width,box.height,false);this.camera.aspect=box.width/box.height;this.camera.updateProjectionMatrix();}});this.observer.observe(this.stage);
    this.renderer.setAnimationLoop((time:number)=>{const dt=this.last?Math.min(.1,(time-this.last)/1000):0;this.last=time;if(this.playing&&this.mixer){this.mixer.update(dt*Number(this.speed.value));if(this.action&&!this.loop.checked&&this.action.time>=this.action.getClip().duration)this.setPlaying(false);this.updateTime();}this.controls.update();this.renderer.render(this.scene,this.camera);});
    this.setClips([]);this.say('Choose a local GLB. Camera orbit and lighting are inspection tools, not scored renders.');
  }
  private say(message:string){this.status.textContent=message;this.options.onStatus?.(message);}
  private setClips(clips:T.AnimationClip[]){this.clips=clips;this.clipSelect.replaceChildren(new Option('Rest pose','-1'),...clips.map((c,i)=>new Option(c.name||`Clip ${i+1}`,String(i))));this.clipSelect.value='-1';this.scrub.disabled=true;this.playButton.disabled=true;this.options.onClips?.(clips.map((c,index)=>({name:c.name||`Clip ${index+1}`,duration:Math.max(0,c.duration),index})));}
  private updateLoop(){if(this.action){this.action.setLoop(this.loop.checked?T.LoopRepeat:T.LoopOnce,this.loop.checked?Infinity:1);this.action.clampWhenFinished=!this.loop.checked;}}
  private setPlaying(value:boolean){this.playing=value&&!!this.action;this.playButton.textContent=this.playing?'Pause':'Play';if(this.action){if(this.playing&&this.action.time>=this.action.getClip().duration){this.action.reset();this.action.play();}this.action.paused=!this.playing;}}
  private updateTime(){const duration=this.action?.getClip().duration??0,time=this.action?.time??0;this.scrub.value=String(duration>0?Math.min(1,time/duration):0);this.timeText.textContent=this.action?`${time.toFixed(2)} / ${duration.toFixed(2)} s`:'Rest pose';}
  private selectClip(index:number){this.setPlaying(false);this.mixer?.stopAllAction();this.action=null;if(this.mixer&&this.clips[index]){this.action=this.mixer.clipAction(this.clips[index]);this.action.reset().play();this.action.paused=true;this.updateLoop();this.mixer.update(0);}const usable=!!this.action&&this.action.getClip().duration>0;this.scrub.disabled=!usable;this.playButton.disabled=!usable;this.updateTime();}
  private release(){if(!this.asset)return;this.mixer?.stopAllAction();this.mixer?.uncacheRoot(this.asset);this.scene.remove(this.asset);disposeObject(this.asset);this.asset=null;this.mixer=null;this.action=null;}
  fit(){if(!this.asset)return;this.asset.updateMatrixWorld(true);this.asset.traverse((o:any)=>{if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();}});const box=new T.Box3().setFromObject(this.asset),center=box.getCenter(new T.Vector3()),size=Math.max(.001,box.getSize(new T.Vector3()).length());if(box.isEmpty())return;this.controls.target.copy(center);this.camera.position.copy(center).add(new T.Vector3(-.65,.18,.8).normalize().multiplyScalar(size*1.22));this.camera.near=size/1000;this.camera.far=size*20;this.camera.updateProjectionMatrix();this.controls.update();}
  async load(url:string){const serial=++this.serial;this.say('Loading local GLB…');this.setPlaying(false);this.release();this.setClips([]);try{await MeshoptDecoder.ready;const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);const gltf=await loader.loadAsync(url);if(this.disposed||serial!==this.serial){disposeObject(gltf.scene);return;}this.asset=gltf.scene;this.asset.traverse((o:any)=>{if(o.isMesh){o.frustumCulled=false;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)m.wireframe=this.wire.checked;}});this.scene.add(this.asset);this.mixer=new T.AnimationMixer(this.asset);this.setClips(gltf.animations);this.fit();this.say(`${gltf.animations.length} animation clip${gltf.animations.length===1?'':'s'} · drag to orbit, scroll to zoom · frame is fixed until Fit pose`);}catch(error){if(serial===this.serial&&!this.disposed){this.say(`Could not load local GLB: ${String(error)}. Meshopt and WebP are included; Draco/KTX2 require a configured decoder.`);throw error;}}}
  dispose(){if(this.disposed)return;this.disposed=true;this.serial++;this.renderer.setAnimationLoop(null);this.observer.disconnect();this.release();this.controls.dispose();this.envTarget.dispose();this.renderer.dispose();this.host.replaceChildren();}
}
