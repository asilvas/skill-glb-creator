import {resolve} from 'node:path';
import {mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {assetIO} from './io';
/** Lossless codec decoding for tools lacking Meshopt/WebP support; keeps the delivery artifact intact. */
export async function decodeForInspection(input:string,output:string){
  const source=resolve(input),target=resolve(output);if(source.toLowerCase()===target.toLowerCase()||existsSync(target))throw Error('Use a new inspection output path');
  const bytes=new Uint8Array(await Bun.file(source).arrayBuffer()),io=await assetIO(),doc=await io.readBinary(bytes);
  for(const texture of doc.getRoot().listTextures())if(texture.getMimeType()!=='image/png'&&texture.getMimeType()!=='image/jpeg')texture.setImage(new Uint8Array(await sharp(texture.getImage()!).png().toBuffer())).setMimeType('image/png');
  for(const ext of doc.getRoot().listExtensionsUsed())if(ext.extensionName==='EXT_meshopt_compression'||ext.extensionName==='EXT_texture_webp')ext.dispose();
  const buffer=doc.getRoot().listBuffers()[0]??doc.createBuffer('decoded');doc.getRoot().listAccessors().forEach(a=>a.setBuffer(buffer));doc.getRoot().listBuffers().slice(1).forEach(b=>b.dispose());
  const decoded=await io.writeBinary(doc);mkdirSync(dirname(target),{recursive:true});await Bun.write(target,decoded);
  return{source,target,sourceSHA256:createHash('sha256').update(bytes).digest('hex'),bytes:decoded.length,scope:'Codec-decoded inspection derivative; decoded geometry and PNG pixels represent the actual variant, not its original master.'};
}
if(import.meta.main){const args=process.argv.slice(2),input=args.find(a=>!a.startsWith('--')),out=args.find(a=>a.startsWith('--out='))?.slice(6);if(!input||!out)throw Error('Usage: bun run decode -- asset.glb --out=inspection.glb');console.log(JSON.stringify(await decodeForInspection(input,out)));}
