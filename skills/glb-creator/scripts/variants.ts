import {Document,Logger,PropertyType} from '@gltf-transform/core';
import {EXTMeshoptCompression,EXTTextureWebP} from '@gltf-transform/extensions';
import {dedup,prune,quantize,simplify,weld,listTextureSlots} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';
import validator from 'gltf-validator';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {assetIO} from './io';
import {parseVariantTarget,type VariantTarget} from './variant-target';
export {parseVariantTarget};export type {VariantTarget};
export type VariantStrategy='auto';
export type VariantOptions={outDir:string;targets?:string[];strategy?:VariantStrategy;maxEvaluations?:number;minRetention?:number;imageFormat?:'webp'|'core';baseStrategy?:string;qualityOptions?:Record<string,unknown>;evaluator?:{evaluate:(bytes:Uint8Array)=>Promise<import('./optimize-search').QualityObservation>;dispose?:()=>Promise<void>|void;protocol?:unknown};onProgress?:(event:any)=>void};
export type VariantProfile={id:string;ratio:number;error:number;textureScale:number;colorQuality:number;quantize:boolean};
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const bytesOf=(a:any)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const accessors=(doc:Document)=>doc.getRoot().listAccessors().map(a=>({type:a.getType(),component:a.getComponentType(),normalized:a.getNormalized(),sha256:sha(bytesOf(a.getArray()!))}));
const structure=(doc:Document)=>{
  const root=doc.getRoot();return{
    skins:root.listSkins().map(s=>({name:s.getName(),joints:s.listJoints().map(n=>n.getName())})),
    clips:root.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().map(c=>({node:c.getTargetNode()?.getName(),path:c.getTargetPath(),interpolation:c.getSampler()?.getInterpolation(),times:sha(bytesOf(c.getSampler()?.getInput()?.getArray()!))}))})),
    materials:root.listMaterials().map(m=>({name:m.getName(),baseColorFactor:m.getBaseColorFactor(),metallicFactor:m.getMetallicFactor(),roughnessFactor:m.getRoughnessFactor(),normalScale:m.getNormalScale(),emissiveFactor:m.getEmissiveFactor(),alphaMode:m.getAlphaMode(),alphaCutoff:m.getAlphaCutoff(),doubleSided:m.getDoubleSided(),slots:['BaseColor','Normal','MetallicRoughness','Occlusion','Emissive'].map(role=>({role,present:!!(m as any)[`get${role}Texture`](),texCoord:(m as any)[`get${role}TextureInfo`]()?.getTexCoord()}))})),
    morphs:root.listMeshes().map(m=>m.listPrimitives().map(p=>p.listTargets().length))};
};
const inventory=(doc:Document)=>{const root=doc.getRoot();return{triangles:root.listMeshes().reduce((s,m)=>s+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION')?.getCount()??0)/3,0),0),vertices:root.listMeshes().reduce((s,m)=>s+m.listPrimitives().reduce((s,p)=>s+(p.getAttribute('POSITION')?.getCount()??0),0),0),skins:root.listSkins().length,clips:root.listAnimations().map(a=>({name:a.getName(),duration:Math.max(0,...a.listSamplers().map(s=>{const x=s.getInput()?.getArray();return x?.length?Number(x[x.length-1]):0;}))})),extensions:root.listExtensionsRequired().map(e=>e.extensionName)};};
async function optimizeTextures(doc:Document,profile:VariantProfile,format:'webp'|'core'){
  const receipts=[];
  for(const [index,texture] of doc.getRoot().listTextures().entries()){
    const input=texture.getImage();if(!input)continue;
    const slots=listTextureSlots(texture),isColor=slots.length>0&&slots.every(s=>s==='baseColorTexture'||s==='emissiveTexture'),isNormal=slots.includes('normalTexture');
    const metadata=await sharp(input).metadata();if(!metadata.width||!metadata.height)throw Error('Texture dimensions unavailable');
    const w=Math.max(4,Math.round(metadata.width*profile.textureScale)),h=Math.max(4,Math.round(metadata.height*profile.textureScale));
    let image=sharp(input);if(profile.textureScale!==1)image=image.resize(w,h,{fit:'inside',withoutEnlargement:true,kernel:'lanczos3'});
    let output:Buffer,mime:string;
    // Keep packed data maps lossless in channel values. Renormalize resized tangent normals.
    if(isNormal&&profile.textureScale!==1){
      const raw=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
      for(let i=0;i<raw.data.length;i+=4){const x=raw.data[i]/127.5-1,y=raw.data[i+1]/127.5-1,z=raw.data[i+2]/127.5-1,l=Math.hypot(x,y,z)||1;raw.data[i]=Math.round((x/l+1)*127.5);raw.data[i+1]=Math.round((y/l+1)*127.5);raw.data[i+2]=Math.round((z/l+1)*127.5);}
      image=sharp(raw.data,{raw:{width:raw.info.width,height:raw.info.height,channels:4}});
    }
    const lossless=!isColor||profile.colorQuality===100;
    if(format==='webp'){output=await image.webp({lossless,quality:profile.colorQuality,effort:4}).toBuffer();mime='image/webp';}
    else if(isColor&&!metadata.hasAlpha&&profile.colorQuality<100){output=await image.jpeg({quality:profile.colorQuality,chromaSubsampling:'4:4:4'}).toBuffer();mime='image/jpeg';}
    else{output=await image.png({compressionLevel:9}).toBuffer();mime='image/png';}
    let pixelsExact:boolean|null=null;
    if(profile.textureScale===1&&lossless){
      const before=await sharp(input).ensureAlpha().raw().toBuffer(),after=await sharp(output).ensureAlpha().raw().toBuffer();pixelsExact=before.equals(after);
      if(!pixelsExact){output=await sharp(input).png({compressionLevel:9}).toBuffer();mime='image/png';pixelsExact=before.equals(await sharp(output).ensureAlpha().raw().toBuffer());}
      if(!pixelsExact)throw Error('Lossless texture pixel invariant failed');
    }
    texture.setImage(new Uint8Array(output)).setMimeType(mime);
    receipts.push({index,name:texture.getName(),slots,inputBytes:input.length,outputBytes:output.length,width:metadata.width,height:metadata.height,outputWidth:w,outputHeight:h,mime,pixelsExact,colorLossy:isColor&&!lossless,normalRenormalized:isNormal&&profile.textureScale!==1});
  }
  if(doc.getRoot().listTextures().some(t=>t.getMimeType()==='image/webp'))doc.createExtension(EXTTextureWebP).setRequired(true);
  return receipts;
}
export async function createVariantContext(sourceBytes:Uint8Array){
  const io=await assetIO(),original=await io.readBinary(sourceBytes.slice());original.setLogger(new Logger(Logger.Verbosity.ERROR));
  const textureCapabilities=await Promise.all(original.getRoot().listTextures().map(async texture=>{const input=texture.getImage();if(!input)return {resizable:false,color:false,opaque:false};const metadata=await sharp(input).metadata(),slots=listTextureSlots(texture);return {resizable:(metadata.width??0)>4||(metadata.height??0)>4,color:slots.length>0&&slots.every(s=>s==='baseColorTexture'||s==='emissiveTexture'),opaque:!metadata.hasAlpha};}));
  return {io,originalStructure:structure(original),sourceInventory:inventory(original),sourceAccessorSignatures:accessors(original),textureCapabilities};
}
export type VariantContext=Awaited<ReturnType<typeof createVariantContext>>;
/** Build one candidate from original bytes, with structural and decoded checks. */
export async function transformVariantCandidate(sourceBytes:Uint8Array,profile:VariantProfile,options:{imageFormat?:'webp'|'core';baseStrategy?:string;context?:VariantContext}={}){
  const {io,originalStructure,sourceAccessorSignatures}=options.context??await createVariantContext(sourceBytes),imageFormat=options.imageFormat??'webp',baseStrategy=options.baseStrategy??'master';
  const t=performance.now();let attempt:any={profile,baseStrategy,subStrategy:profile.id,status:'running'};
      const doc=await io.readBinary(sourceBytes.slice());doc.setLogger(new Logger(Logger.Verbosity.ERROR));
      // Compressed glTF accessors can decode without a writable buffer binding.
      // Assign a real output buffer before repacking; preserve all array bytes.
      const previousBuffers=doc.getRoot().listBuffers(),liveBuffer=doc.createBuffer('variant-data');
      for(const accessor of doc.getRoot().listAccessors())accessor.setBuffer(liveBuffer);
      for(const buffer of previousBuffers)buffer.dispose();
      if(profile.ratio<1)await doc.transform(weld(),simplify({simplifier:MeshoptSimplifier,ratio:profile.ratio,error:profile.error,lockBorder:true}));
      // glTF permits normalized ushort colors. Only floating colors are packed;
      // existing byte/ushort precision is never expanded. Max linear error1/131070.
      if(profile.quantize){const seen=new Set();let count=0,maxError=0;for(const mesh of doc.getRoot().listMeshes())for(const prim of mesh.listPrimitives())for(const semantic of prim.listSemantics().filter(s=>/^COLOR_\d+$/.test(s))){const color=prim.getAttribute(semantic)!;if(seen.has(color)||!(color.getArray() instanceof Float32Array))continue;seen.add(color);const values=color.getArray()!,packed=new Uint16Array(values.length);for(let i=0;i<values.length;i++){const v=Number(values[i]);if(!Number.isFinite(v)||v<0||v>1)throw Error('Float vertex colors must be finite0..1 before precision packing');packed[i]=Math.round(v*65535);maxError=Math.max(maxError,Math.abs(v-packed[i]/65535));}color.setArray(packed).setNormalized(true);count++;}attempt.colorAttributes={packedFloatAccessors:count,bits:16,maxAbsoluteLinearError:maxError,existingIntegerPrecisionUnchanged:true};}
      if(profile.quantize)await doc.transform(quantize({pattern:/^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+)$/,quantizePosition:16,quantizeNormal:12,quantizeTexcoord:16,cleanup:false}));
      if(profile.ratio<1||profile.quantize)await doc.transform(dedup({propertyTypes:[PropertyType.ACCESSOR]}),prune({propertyTypes:[PropertyType.ACCESSOR,PropertyType.BUFFER,PropertyType.SKIN],keepLeaves:true,keepAttributes:true,keepSolidTextures:true,keepExtras:true}));
      attempt.textures=await optimizeTextures(doc,profile,imageFormat);
      // No encoder filters: raw floats and animation samples stay lossless unless an explicit preceding transform changed them.
      doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
      const bytes=await io.writeBinary(doc),decoded=await io.readBinary(bytes);
      if(JSON.stringify(structure(decoded))!==JSON.stringify(originalStructure))throw Error('Skin, clip timing, morph or material semantic invariant changed');
      const lossless=!profile.quantize&&profile.ratio===1&&profile.textureScale===1&&profile.colorQuality===100;
      if(lossless&&JSON.stringify(accessors(decoded))!==JSON.stringify(sourceAccessorSignatures))throw Error('Lossless decoded accessor bytes changed');
      const compressedReport=await validator.validateBytes(bytes,{maxIssues:50});
      // Validator cannot inspect compressed streams. Decode for a separate complete-data validation.
      decoded.getRoot().listExtensionsUsed().filter(e=>e.extensionName==='EXT_meshopt_compression').forEach(e=>e.dispose());
      const inspectionBuffer=decoded.getRoot().listBuffers()[0]??decoded.createBuffer('decoded');
      decoded.getRoot().listAccessors().forEach(a=>a.setBuffer(inspectionBuffer));
      decoded.getRoot().listBuffers().slice(1).forEach(b=>b.dispose());
      const fullReport=await validator.validateBytes(await io.writeBinary(decoded),{maxIssues:50});
      if(fullReport.issues.numErrors)throw Error(`Decoded glTF validation failed: ${fullReport.issues.messages.filter(m=>m.severity===0).map(m=>m.code).join(',')}`);
      attempt={...attempt,status:'complete',bytes:bytes.length,sha256:sha(bytes),seconds:(performance.now()-t)/1000,lossless,inventory:inventory(doc),containerValidation:{errors:compressedReport.issues.numErrors,warnings:compressedReport.issues.numWarnings,messages:compressedReport.issues.messages},decodedValidation:{errors:fullReport.issues.numErrors,warnings:fullReport.issues.numWarnings,messages:fullReport.issues.messages},semanticInvariant:true};
  return {bytes,attempt};
}
/** Every delivery uses measured adaptive search from immutable master bytes. */
export async function generateVariants(masterPath:string,options:VariantOptions){
  if(options.strategy!==undefined&&options.strategy!=='auto')throw Error('Only adaptive quality-guided strategy auto is supported');
  return (await import('./optimize')).optimizeVariants(masterPath,options);
}
if(import.meta.main){
  const args=process.argv.slice(2),get=(name:string)=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3),input=args.find(a=>!a.startsWith('--'));
  if(!input||!get('out')){console.error('Usage: bun run variants -- MASTER.glb --out=FOLDER [--targets=10MB,25MB,25%,50%] [--strategy=auto] [--min-retention=.9] [--max-evaluations=18] [--image-format=webp|core]');process.exit(2);}
  try{const r=await generateVariants(input,{outDir:get('out')!,targets:get('targets')?.split(',').filter(Boolean),strategy:get('strategy') as VariantStrategy,imageFormat:get('image-format') as any,maxEvaluations:get('max-evaluations')?Number(get('max-evaluations')):undefined,minRetention:get('min-retention')?Number(get('min-retention')):undefined,baseStrategy:get('base-strategy'),onProgress:e=>console.error(JSON.stringify(e))});console.log(JSON.stringify({ok:r.status==='complete',receipt:join(resolve(get('out')!),'variants.json'),masterUnchanged:r.master.unchanged,totalSeconds:r.totalSeconds,variants:r.variants.map(v=>({target:v.target.label,status:v.status,bytes:v.bytes,profile:v.profile,path:v.path}))}));}
  catch(error){console.error(String(error));process.exit(1);}
}
