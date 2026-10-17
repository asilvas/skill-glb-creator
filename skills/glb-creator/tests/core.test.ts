import {test,expect} from 'bun:test';
import {mkdirSync,readdirSync} from 'node:fs';
import {Asset} from '../scripts/geometry';
import {Preview,capturePath} from '../scripts/preview';
import {validate} from '../scripts/validate';
import {TMP} from '../scripts/paths';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
process.env.GLB_CREATOR_CLEANUP='off';mkdirSync(TMP,{recursive:true});
async function fixture(){
  const a=new Asset();a.joint('root',[0,0,0]);a.joint('arm',[.5,1,0],'root');
  // A spatially varying image survives solid-texture folding during export.
  const pixels=new Uint8Array(48).fill(140);pixels[0]=255;
  const image=await sharp(pixels,{raw:{width:4,height:4,channels:3}}).png().toBuffer();
  a.surfaces.set('surface',{baseColor:image});a.ell('surface',[0,.7,0],[.45,.7,.4],'root');a.tube('surface',[[.5,1,0],[1,1,0]],[.16,.08],'arm');
  const clip=a.doc.createAnimation('attack');a.channel(clip,'arm',[0,.4,.8],[[0,0,0],[0,0,1],[0,0,0]]);return a.bytes();
}
test('generic textured skin is valid and deterministic',async()=>{
  const b=await fixture(),v=await validate(b);expect(v.errors).toBe(0);expect(v.textures.length).toBe(1);expect(v.clips[0].duration).toBeCloseTo(.8);expect(v.skins[0].joints).toEqual(['root','arm']);expect(await fixture()).toEqual(b);
});
test('translated roots retain their location when grounded',async()=>{
  const a=new Asset();a.joint('root',[2,-1,3]);a.add('new-material','root',[[2,-2,3],[3,-2,3],[2,-1,3]],[[0,1,2]],true,[[0,0],[1,0],[0,1]]);
  const b=await a.bytes();expect((await validate(b)).errors).toBe(0);const d=await new NodeIO().readBinary(b);expect(d.getRoot().listSkins()[0].listJoints()[0].getTranslation()).toEqual([2,1,3]);
});
test('memory frames show deformation, repeat absolute times and return to rest',async()=>{
  const p=await Preview.create(),before=readdirSync(TMP,{recursive:true}).sort();
  try{await p.load(await fixture());const rest=await p.frame({size:128,time:0,analyze:true}),attack=await p.frame({size:128,time:.4}),end=await p.frame({size:128,time:.8});expect(rest.stats!.channels[0].stdev).toBeGreaterThan(5);expect(attack.bytes).not.toEqual(rest.bytes);expect(end.bytes).toEqual(rest.bytes);expect((await p.frame({size:128,time:.4})).bytes).toEqual(attack.bytes);expect(readdirSync(TMP,{recursive:true}).sort()).toEqual(before);}finally{await p.dispose();}
},30000);
test('scale resizes geometry and skeleton together; invalid tint fails early',async()=>{
  const a=new Asset();a.joint('root',[0,0,0]);a.joint('arm',[.5,1,0],'root');
  a.ell('m',[0,.7,0],[.45,.7,.4],'root');a.scale(2);
  const d=await new NodeIO().readBinary(await a.bytes());
  expect(d.getRoot().listSkins()[0].listJoints()[1].getTranslation()).toEqual([1,2,0]);
  const bad=new Asset();bad.joint('root',[0,0,0]);bad.ell('m',[0,.7,0],[.4,.6,.4],'root');
  bad.surfaces.set('m',{baseColor:new Uint8Array([137,80,78,71]),tint:[1.4,1,1]});
  await expect(bad.bytes()).rejects.toThrow('0..1');
});
test('tube interpolates short radii lists along the path',async()=>{
  const a=new Asset();a.joint('root',[0,0,0]);
  a.tube('m',[[0,0,0],[0,1,0],[0,2,0],[0,3,0],[0,4,0]],[.4,.1],'root');
  expect((await validate(await a.bytes())).errors).toBe(0);
});
test('contact sheet tiles cover rest views and animation phases in one image',async()=>{
  const p=await Preview.create();
  try{
    await p.load(await fixture());
    const s=await p.sheet({tile:96});
    expect(s.tiles.length).toBe(6);expect(s.width).toBe(288);expect(s.height).toBe(192);
    expect(s.tiles.map(t=>t.label)).toEqual(['front','left','back','t=0.24s','t=0.44s','t=0.68s']);
    expect(s.tiles.every(t=>!t.blank)).toBe(true);
    const meta=await sharp(s.bytes).metadata();expect(meta.format).toBe('webp');
  }finally{await p.dispose();}
},30000);
test('capture is confined and actual custom shader hooks remain rejected',async()=>{
  expect(()=>capturePath('../SKILL.md')).toThrow();expect(capturePath('history/a.png')).toBe(resolve(TMP,'history/a.png'));
  const p=await Preview.create();try{await p.load(await fixture());p.scene.traverse((o:any)=>{if(o.material)o.material.onBeforeCompile=()=>{throw Error('custom');};});await expect(p.frame({size:64})).rejects.toThrow();}finally{await p.dispose();}
},30000);
