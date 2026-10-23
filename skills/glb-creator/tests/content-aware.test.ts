import {test,expect} from 'bun:test';
import {Document,NodeIO} from '@gltf-transform/core';
import {createVariantContext,transformVariantCandidate} from '../scripts/variants';
import {adaptiveProfile,searchQualityVariants} from '../scripts/optimize-search';
import {optimizeVariants} from '../scripts/optimize';
import {createHash} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function fixture(integer=false){const d=new Document(),b=d.createBuffer(),positions=d.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0,1,0,0,0,1,0])).setBuffer(b),values=integer?new Uint8Array([25,71,202,255,99,11,232,255,10,30,40,255]):new Float32Array([.101,.283,.793,1,.387,.043,.911,1,.039,.117,.157,1]),colors=d.createAccessor().setType('VEC4').setArray(values).setNormalized(integer).setBuffer(b),p=d.createPrimitive().setAttribute('POSITION',positions).setAttribute('COLOR_0',colors).setMaterial(d.createMaterial().setMetallicFactor(0));d.createScene().addChild(d.createNode().setMesh(d.createMesh().addPrimitive(p)));return {bytes:await new NodeIO().writeBinary(d),values};}
test('geometry-only search spends no proposals reducing absent texture/coding data',async()=>{
 const profiles:any[]=[],master={profile:{...adaptiveProfile(1,1,100,false),id:'source'},sequence:0,bytes:1000000,quality:{valid:true,retention:1}};
 const result=await searchQualityVariants(master,async p=>{profiles.push(p);return {bytes:Math.ceil(10000+990000*p.ratio),quality:{valid:true,retention:1-.18*(1-p.ratio)}};},{maxEvaluations:18,activeAxes:['geometry']});
 expect(profiles.length).toBeGreaterThan(5);expect(profiles.every(p=>p.textureScale===1&&p.colorQuality===100)).toBe(true);expect(new Set(profiles.map(p=>p.id)).size).toBe(profiles.length);expect(result.selection[0].qualityAccepted).toBe(true);expect(result.selection[0].candidate.bytes).toBeLessThan(600000);
});
test('float colors pack at bounded linear precision while lossless/integer paths stay exact',async()=>{
 const f=await fixture(),context=await createVariantContext(f.bytes),packed=await transformVariantCandidate(f.bytes,adaptiveProfile(1,1,100,true),{context}),doc=await context.io.readBinary(packed.bytes),color=doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('COLOR_0')!;
 expect(color.getArray()).toBeInstanceOf(Uint16Array);expect(color.getNormalized()).toBe(true);for(let i=0;i<3;i++){const v=color.getElement(i,[]);for(let k=0;k<4;k++)expect(Math.abs(v[k]-f.values[i*4+k])).toBeLessThanOrEqual(1/131070+1e-7);expect(v[3]).toBe(1);}
 const lossless=await transformVariantCandidate(f.bytes,adaptiveProfile(1,1,100,false),{context}),decoded=await context.io.readBinary(lossless.bytes);expect(decoded.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('COLOR_0')!.getArray()).toEqual(f.values);expect(lossless.attempt.lossless).toBe(true);
 const integer=await fixture(true),same=await transformVariantCandidate(integer.bytes,adaptiveProfile(1,1,100,true)),read=await (await createVariantContext(integer.bytes)).io.readBinary(same.bytes);expect(read.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('COLOR_0')!.getArray()).toEqual(integer.values);
});
test('byte-identical candidate measurements are reused under one frozen evaluator',async()=>{
 const f=await fixture(),sourceBytes=(await transformVariantCandidate(f.bytes,adaptiveProfile(1,1,100,false))).bytes,dir=mkdtempSync(join(tmpdir(),'glb-content-search-')),source=join(dir,'master.glb');await Bun.write(source,sourceBytes);const hashes=new Set<string>();let calls=0;
 const result=await optimizeVariants(source,{outDir:join(dir,'out'),maxEvaluations:10,evaluator:{async evaluate(bytes){calls++;const sha=createHash('sha256').update(bytes).digest('hex');expect(hashes.has(sha)).toBe(false);hashes.add(sha);return {valid:true,retention:1};}}});
 expect(result.activeAxes).toEqual(['geometry']);expect(result.reusedMeasurements).toBeGreaterThan(0);expect(calls).toBe(result.renderedCandidates+1);expect(calls).toBeLessThan(result.evaluations+1);expect(new Uint8Array(await Bun.file(source).arrayBuffer())).toEqual(sourceBytes);
});
