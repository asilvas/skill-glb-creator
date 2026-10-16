import { NodeIO } from '@gltf-transform/core';
import validator from 'gltf-validator';
import { createHash } from 'node:crypto';
export async function validate(bytes:Uint8Array){
  const report=await validator.validateBytes(bytes,{maxIssues:100});
  const doc=await new NodeIO().readBinary(bytes),root=doc.getRoot();
  const clips=root.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().length,duration:Math.max(...a.listSamplers().map(s=>{const t=s.getInput()!.getArray()!;return Number(t[t.length-1]);}))}));
  const skins=root.listSkins().map(s=>({name:s.getName(),joints:s.listJoints().map(n=>n.getName())}));
  const textures=root.listTextures().map(t=>({name:t.getName(),mime:t.getMimeType(),bytes:t.getImage()?.length,sha256:t.getImage()?createHash('sha256').update(t.getImage()!).digest('hex'):null}));
  const materials=root.listMaterials().map(m=>({name:m.getName(),baseColor:!!m.getBaseColorTexture(),normal:!!m.getNormalTexture(),roughness:!!m.getMetallicRoughnessTexture(),alphaMode:m.getAlphaMode()}));
  return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),errors:report.issues.numErrors,warnings:report.issues.numWarnings,clips,skins,textures,materials,report};
}
