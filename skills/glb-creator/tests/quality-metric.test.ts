import {test,expect} from 'bun:test';
import {compareQualityFrames,createQualityEvaluator,QUALITY_METRIC_VERSION,type QualityImage} from '../scripts/quality-metric';
import {Asset} from '../scripts/geometry';
import {Preview} from '../scripts/preview';
import {partitionRenderMeshes} from '../scripts/quality-metric-renderer';
import * as T from 'three';
import sharp from 'sharp';
function fixture():QualityImage{
 const width=64,height=64,pixels=new Uint8Array(width*height*4);
 for(let y=10;y<54;y++)for(let x=10;x<54;x++){const i=(y*width+x)*4,v=(Math.floor(x/3)+Math.floor(y/3))%2?210:45;pixels.set([v,Math.round(v*.7),30,255],i);}
 return {width,height,pixels};
}
test('foreground quality ignores hidden RGB but rejects empty, opaque-background and mismatched frames',()=>{
 const a=fixture(),b={...a,pixels:a.pixels.slice()};for(let i=0;i<b.pixels.length;i+=4)if(!b.pixels[i+3])b.pixels.set([230,70,130,0],i);
 expect(compareQualityFrames(a,b).retention).toBe(1);
 const empty={...a,pixels:new Uint8Array(a.pixels.length)};expect(compareQualityFrames(empty,empty).valid).toBe(false);
 const opaque={...a,pixels:new Uint8Array(a.pixels.length).fill(255)};expect(compareQualityFrames(opaque,opaque).valid).toBe(false);
 expect(compareQualityFrames(a,{...b,width:32}).valid).toBe(false);
});
test('geometry, color, blur and small focal loss cannot be hidden by a similar background',async()=>{
 const a=fixture(),color={...a,pixels:a.pixels.slice()},shift={...a,pixels:new Uint8Array(a.pixels.length)},focal={...a,pixels:a.pixels.slice()};
 for(let i=0;i<color.pixels.length;i+=4)if(color.pixels[i+3])color.pixels.set([20,40,240,255],i);
 for(let y=0;y<64;y++)for(let x=0;x<54;x++){const src=(y*64+x)*4,dst=(y*64+x+10)*4;shift.pixels.set(a.pixels.slice(src,src+4),dst);}
 for(let y=10;y<26;y++)for(let x=10;x<26;x++)focal.pixels.set([0,0,0,255],(y*64+x)*4);
 const blurred=await sharp(a.pixels,{raw:{width:64,height:64,channels:4}}).blur(2).raw().toBuffer();const blur={...a,pixels:new Uint8Array(blurred)};
 expect(compareQualityFrames(a,color).retention!).toBeLessThan(.9);
 expect(compareQualityFrames(a,shift).metrics!.silhouetteIoU).toBeLessThan(.9);
 expect(compareQualityFrames(a,blur).retention!).toBeLessThan(.9);
 const f=compareQualityFrames(a,focal);expect(f.retention!).toBeLessThan(.9);expect(f.metrics!.focalP10).toBeLessThan(.9);
});
test('independent detail guard rejects low-contrast texture blur that passed every v1 guard',async()=>{
 const width=128,height=128,pixels=new Uint8Array(width*height*4);
 // Subtle surface detail over a broad, almost unchanged tonal structure. A
 // weighted mean and local SSIM alone miss the removal of this fine texture.
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const v=Math.round(135+3*Math.sin(x*1.2)*Math.sin(y*1.3)+25*Math.sin(x*.035));
  pixels.set([v,Math.round(v*.8),Math.round(v*.6),x>=12&&x<116&&y>=12&&y<116?255:0],(y*width+x)*4);
 }
 const blurred=new Uint8Array(await sharp(pixels,{raw:{width,height,channels:4}}).blur(1.5).raw().toBuffer());
 for(let i=3;i<blurred.length;i+=4)blurred[i]=pixels[i];
 const reference={width,height,pixels},score=compareQualityFrames(reference,{width,height,pixels:blurred}),m=score.metrics!;
 expect(compareQualityFrames(reference,reference).retention).toBe(1);
 expect(score.valid).toBe(true);expect(m.silhouetteIoU).toBe(1);
 expect(Math.min(m.silhouetteIoU,m.meanAppearance,m.focalP10)).toBeGreaterThan(.9);
 expect(m.edge).toBeLessThan(.9);expect(score.retention).toBe(Math.min(m.edge,m.rgbEdge));
 expect(QUALITY_METRIC_VERSION).toBe('foreground-ssim-color-edge-patch-v2');
});
test('independent RGB detail guard rejects texture loss at nearly equal luminance',()=>{
 const width=128,height=128,pixels=new Uint8Array(width*height*4),flat=new Uint8Array(pixels.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,s=12*Math.sin(x*1.2)*Math.sin(y*1.3),alpha=x>=12&&x<116&&y>=12&&y<116?255:0;
  pixels.set([Math.round(140+s),Math.round(120-s*.2126/.7152),80,alpha],i);flat.set([140,120,80,alpha],i);
 }
 const reference={width,height,pixels},score=compareQualityFrames(reference,{width,height,pixels:flat}),m=score.metrics!;
 expect(compareQualityFrames(reference,reference).retention).toBe(1);expect(score.valid).toBe(true);
 expect(Math.min(m.silhouetteIoU,m.meanAppearance,m.focalP10,m.edge)).toBeGreaterThan(.9);
 expect(m.rgbEdge).toBeLessThan(.9);expect(score.retention).toBe(m.rgbEdge);
});
async function model(secondSwing=.7,green=false){
 const a=new Asset();a.joint('root',[0,0,0]);a.joint('arm',[.6,1.1,0],'root');
 a.surfaces.set('m',{baseColor:new Uint8Array(await sharp({create:{width:16,height:16,channels:3,background:green?'#08f020':'#945527'}}).png().toBuffer())});
 a.ell('m',[0,1,0],[.5,1,.4],'root',0,false,[0,0,0],[10,6]);a.ell('m',[.8,1.1,0],[.25,.6,.2],'arm',0,false,[0,0,0],[10,6]);
 for(const [name,swing] of [['idle',.12],['attack',secondSwing]] as const){const c=a.doc.createAnimation(name);a.channel(c,'arm',[0,.5,1],[[0,0,0],[0,0,swing],[0,0,0]]);}
 return a.bytes();
}
test('render partitions retain every raw corner attribute, morph control, skin pose and native pixels',async()=>{
 const bytes=await model(),preview=await Preview.create();
 try{
  for(const flat of [false,true]){
  await preview.load(bytes);const sources:any[]=[];
  preview.asset.traverse((mesh:any)=>{
   if(!mesh.isMesh)return;const geometry=mesh.geometry,n=geometry.getAttribute('position').count,delta=new Float32Array(n*3);for(let i=0;i<n;i++)delta[i*3]=.04;
   if(flat){geometry.deleteAttribute('normal');for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){m.flatShading=true;m.needsUpdate=true;}}
   geometry.morphAttributes.position=[new T.BufferAttribute(delta,3)];geometry.morphTargetsRelative=true;mesh.updateMorphTargets();mesh.morphTargetInfluences[0]=.35;sources.push({mesh,geometry});
  });
  const before=await preview.frame({time:.5,size:96,format:'rgba'});
  const report=partitionRenderMeshes(preview.asset,{maxTriangles:16,force:true});expect(report.length).toBeGreaterThan(0);
  for(const {mesh,geometry} of sources){
   let corner=0,maximumAttributeDelta=0,maximumMorphDelta=0;const originalIndex=geometry.getIndex();
   for(const child of mesh.children){if(!child.name.includes('__render_partition_'))continue;
    expect(child.morphTargetInfluences).toBe(mesh.morphTargetInfluences);if(mesh.isSkinnedMesh)expect(child.skeleton).toBe(mesh.skeleton);
    const idx=child.geometry.getIndex();for(let i=0;i<idx.count;i++,corner++){
     const source=originalIndex?originalIndex.getX(corner):corner,target=idx.getX(i);
     for(const [name,attribute] of Object.entries(geometry.attributes) as any)for(let c=0;c<attribute.itemSize;c++)maximumAttributeDelta=Math.max(maximumAttributeDelta,Math.abs(child.geometry.getAttribute(name).getComponent(target,c)-attribute.getComponent(source,c)));
     for(let c=0;c<3;c++)maximumMorphDelta=Math.max(maximumMorphDelta,Math.abs(child.geometry.morphAttributes.position[0].getComponent(target,c)-geometry.morphAttributes.position[0].getComponent(source,c)));
    }
   }
   expect(corner).toBe(originalIndex?.count??geometry.getAttribute('position').count);
   expect(maximumAttributeDelta).toBe(0);expect(maximumMorphDelta).toBe(0);
  }
  const after=await preview.frame({time:.5,size:96,format:'rgba'});expect(after.bytes).toEqual(before.bytes);
  }
 }finally{await preview.dispose();}
},60000);
test('native retention freezes source framing, samples every clip and detects second-clip/color changes',async()=>{
 const master=await model(),evaluator=await createQualityEvaluator(master,{size:64,maxAnimationSamples:3});
 try{
  expect(evaluator.protocol.metricVersion).toBe(QUALITY_METRIC_VERSION);expect(evaluator.protocol.aggregation).toContain('independent luma edgeRetention');expect(evaluator.protocol.aggregation).toContain('independent RGB edgeRetention');
  expect(evaluator.protocol.clips.map(c=>c.name)).toEqual(['idle','attack']);expect(evaluator.protocol.frames.some(f=>f.id==='focal-1'&&f.width===512)).toBe(true);
  const identity=await evaluator.evaluate(master);expect(identity.valid).toBe(true);expect(identity.retention!).toBeGreaterThan(.9999);expect(identity.frames!.length).toBe(evaluator.protocol.frameCount);
  const changed=await evaluator.evaluate(await model(1.8));expect(changed.valid).toBe(true);expect(changed.retention!).toBeLessThan(.9);expect(changed.frames!.some(f=>f.id.startsWith('clip-2-')&&f.retention<.9)).toBe(true);
  const recolor=await evaluator.evaluate(await model(.7,true));expect(recolor.valid).toBe(true);expect(recolor.retention!).toBeLessThan(.9);
  const missingAnimation=await model();const {assetIO}=await import('../scripts/io');const io=await assetIO(),doc=await io.readBinary(missingAnimation);doc.getRoot().listAnimations()[1].dispose();
  expect((await evaluator.evaluate(await io.writeBinary(doc))).valid).toBe(false);
 }finally{await evaluator.dispose();}
 expect((await evaluator.evaluate(master)).valid).toBe(false);
 // A stock inspection floor atY=-.01 would occlude this entire below-ground
 // source. The metric removes that floor and still compares the complete asset.
 const {assetIO}=await import('../scripts/io'),io=await assetIO(),negative=await io.readBinary(master);
 for(const scene of negative.getRoot().listScenes())for(const node of scene.listChildren()){const t=node.getTranslation();node.setTranslation([t[0],t[1]-4,t[2]]);}
 const below=await io.writeBinary(negative),ungrounded=await createQualityEvaluator(below,{size:64,maxAnimationSamples:3});
 try{expect(ungrounded.protocol.bounds[1][1]).toBeLessThan(0);const actual=await ungrounded.evaluate(below);expect(actual.valid).toBe(true);expect(actual.retention!).toBeGreaterThan(.9999);}finally{await ungrounded.dispose();}
},120000);
