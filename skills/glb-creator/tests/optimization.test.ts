import {test,expect} from 'bun:test';
import {Asset} from '../scripts/geometry';
import {NodeIO,Accessor} from '@gltf-transform/core';
import {validate} from '../scripts/validate';
import {resolve} from 'node:path';
import {mkdirSync} from 'node:fs';
import {TMP,ROOT} from '../scripts/paths';
import sharp from 'sharp';
process.env.GLB_CREATOR_CLEANUP='off';

test('rigid skin encodings are exact, indexed, valid and grounded',async()=>{
  const a=new Asset();a.joint('root',[0,0,0]);a.ell('m',[0,2,0],[1,1,1],'root');
  const bytes=await a.bytes(),doc=await new NodeIO().readBinary(bytes),p=doc.getRoot().listMeshes()[0].listPrimitives()[0];
  expect((await validate(bytes)).errors).toBe(0);
  expect(p.getAttribute('JOINTS_0')!.getComponentType()).toBe(Accessor.ComponentType.UNSIGNED_BYTE);
  const w=p.getAttribute('WEIGHTS_0')!;expect(w.getNormalized()).toBe(true);expect(w.getComponentType()).toBe(Accessor.ComponentType.UNSIGNED_BYTE);
  const v:number[]=[];for(let i=0;i<w.getCount();i++){w.getElement(i,v);expect(v).toEqual([1,0,0,0]);}
  expect(p.getIndices()!.getCount()).toBeGreaterThan(p.getAttribute('POSITION')!.getCount());
  const xyz=p.getAttribute('POSITION')!,ys=[];for(let i=0;i<xyz.getCount();i++){xyz.getElement(i,v);ys.push(v[1]);}expect(Math.min(...ys)).toBeCloseTo(0,6);
});

test('joint index 256 falls back to ushort and retains exact binding',async()=>{
  const a=new Asset();a.joint('j0',[0,0,0]);for(let i=1;i<=256;i++)a.joint(`j${i}`,[0,i*.01,0],'j0');
  a.ell('m',[0,1,0],[1,1,1],'j256');const bytes=await a.bytes();
  expect((await validate(bytes)).errors).toBe(0);
  const d=await new NodeIO().readBinary(bytes),j=d.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('JOINTS_0')!;
  expect(j.getComponentType()).toBe(Accessor.ComponentType.UNSIGNED_SHORT);const v:number[]=[];j.getElement(0,v);expect(v[0]).toBe(256);
});

test('unused source vertices cannot change grounding or visible geometry',async()=>{
  const a=new Asset();a.joint('root',[0,0,0]);
  a.add('m','root',[[0,0,0],[1,0,0],[0,1,0],[0,-100,0]],[[0,1,2]],false,[[0,0],[1,0],[0,1],[0,0]]);
  const bytes=await a.bytes(),doc=await new NodeIO().readBinary(bytes),p=doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION')!;
  const values:number[]=[],ys=[];for(let i=0;i<p.getCount();i++){p.getElement(i,values);ys.push(values[1]);}
  expect(p.getCount()).toBe(3);expect(Math.min(...ys)).toBe(0);expect(Math.max(...ys)).toBe(1);
  expect((await validate(bytes)).errors).toBe(0);
});

test('explicit accent resolution reduces triangles while retaining a valid skin',async()=>{
  const make=async(segments?:[number,number])=>{const a=new Asset();a.joint('root',[0,0,0]);a.ell('m',[0,1,0],[.1,.1,.1],'root',0,false,[0,0,0],segments);return validate(await a.bytes());};
  const full=await make(),accent=await make([10,6]);expect(accent.errors).toBe(0);expect(accent.report.info.totalTriangleCount).toBeLessThan(full.report.info.totalTriangleCount/2);
});

test('manifest aliases embed original bytes; curve and rotation remain valid',async()=>{
  const a=new Asset();a.joint('root',[0,0,0]);
  const folder=resolve(TMP,'manifest-fixture');mkdirSync(folder,{recursive:true});
  const image=new Uint8Array(await sharp({create:{width:4,height:4,channels:3,background:'#8a431f'}}).png().toBuffer());
  await Bun.write(resolve(folder,'color.png'),image);
  const manifest=resolve(folder,'materials.json');
  await Bun.write(manifest,JSON.stringify({materials:{bark:{baseColor:'color.png'}}}));
  await a.loadSurfaces(manifest,{hide:'bark'});
  expect(a.surfaces.get('hide')!.baseColor).toEqual(image);
  a.curve('hide',[[0,.2,0],[.5,1,.2],[0,2,0]],[.2,.05],'root');
  a.ell('hide',[0,1,0],[.2,.5,.2],'root',1,false,[0,0,.5]);
  expect((await validate(await a.bytes())).errors).toBe(0);
});

test('dev fails when requested preview cannot render a valid GLB',async()=>{
  const a=new Asset();a.joint('root',[0,0,0]);a.ell('m',[0,1,0],[.5,1,.5],'root');
  const path=resolve(TMP,'preview-failure.glb');await Bun.write(path,await a.bytes());
  const p=Bun.spawn([process.execPath,resolve(ROOT,'scripts/dev.ts'),path,'--size=1'],{cwd:ROOT,stdout:'pipe',stderr:'pipe',windowsHide:true,env:{...process.env,GLB_CREATOR_CLEANUP:'off'}});
  const [out,code]=await Promise.all([new Response(p.stdout).text(),p.exited]);
  expect(code).toBe(1);const summary=JSON.parse(out.trim().split('\n').at(-1)!);expect(summary.ok).toBe(false);expect(summary.errors).toBe(0);expect(summary.sheet.error).toContain('Invalid frame');
},30000);
