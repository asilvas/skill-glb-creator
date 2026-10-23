import {test,expect} from 'bun:test';
import {createReview,serveReview} from '../scripts/review';
import {Asset} from '../scripts/geometry';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
test('portable review retains all clip names, four supplied views, missing status and escaped metadata',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'glb-review-')),master=join(folder,'master.glb'),out=join(folder,'review');
  const a=new Asset();a.joint('root',[0,0,0]);a.ell('m',[0,1,0],[1,1,1],'root');for(const name of ['idle','attack','wave']){const c=a.doc.createAnimation(name);a.channel(c,'root',[0,1],[[0,0,0],[0,0,0]]);}const bytes=await a.bytes();await Bun.write(master,bytes);
  const png=join(folder,'front.png');await Bun.write(png,await sharp({create:{width:32,height:32,channels:3,background:'#808080'}}).png().toBuffer());
  const title='Review </script><script>alert(1)</script>';
  const result=await createReview({title,outDir:out,models:[{label:'Master',glb:master,views:['front','left','rear','right'].map(label=>({label,path:png}))},{label:'Archived',glb:join(folder,'missing.glb')}]});
  expect(result.models[0].clips).toBe(3);expect(result.models[0].views).toBe(4);expect(result.models[1].available).toBe(false);
  const html=await Bun.file(result.html).text(),config=JSON.parse(html.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/)![1]);expect(config.title).toBe(title);expect(config.models[0].clips.map(c=>c.name)).toEqual(['idle','attack','wave']);
  expect(html).not.toContain('<script>alert(1)</script>');expect(await Bun.file(join(out,'review.js')).exists()).toBe(true);
  expect(createHash('sha256').update(new Uint8Array(await Bun.file(master).arrayBuffer())).digest('hex')).toBe(config.models[0].sha256);
  const server=serveReview(out);try{const url=`http://127.0.0.1:${server.port}`;expect((await fetch(url+'/')).status).toBe(200);expect((await fetch(url+'/assets/asset-01.glb')).status).toBe(200);expect((await fetch(url+'/%2e%2e%5csecret.json')).status).toBe(404);expect((await fetch(url+'/.hidden')).status).toBe(404);}finally{server.stop(true);}
  await expect(createReview({outDir:out,models:[{label:'Master',glb:master}]})).rejects.toThrow('new review folder');
},60000);
test('nonempty review output is rejected before any aliased GLB source or existing artifact is overwritten',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'glb-review-preserve-')),out=join(folder,'review'),assets=join(out,'assets');mkdirSync(assets,{recursive:true});
 const a=new Asset();a.joint('root',[0,0,0]);a.ell('wood',[0,1,0],[1,1,1],'root');const first=await a.bytes();const b=new Asset();b.joint('root',[0,0,0]);b.ell('ivory',[0,1,0],[.5,1,.5],'root');const second=await b.bytes();const one=join(assets,'asset-01.glb'),two=join(assets,'asset-02.glb');await Bun.write(one,first);await Bun.write(two,second);const hash=async(path:string)=>createHash('sha256').update(await Bun.file(path).bytes()).digest('hex'),before=await Promise.all([hash(one),hash(two)]);
 await expect(createReview({outDir:out,models:[{label:'Second input first',glb:two},{label:'First input second',glb:one}]})).rejects.toThrow('new review folder');expect(await Promise.all([hash(one),hash(two)])).toEqual(before);expect(await Bun.file(join(out,'review.json')).exists()).toBe(false);expect(await Bun.file(join(out,'review.html')).exists()).toBe(false);
 const empty=join(folder,'empty');mkdirSync(empty);const result=await createReview({outDir:empty,models:[{label:'Untouched input',glb:one}]});expect(result.ok).toBe(true);expect(await Promise.all([hash(one),hash(two)])).toEqual(before);
},60000);
