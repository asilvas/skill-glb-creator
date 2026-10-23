import {test,expect} from 'bun:test';
import {Asset} from '../scripts/geometry';
import {Preview} from '../scripts/preview';
process.env.GLB_CREATOR_CLEANUP='off';
async function model(animated=true){const a=new Asset();a.joint('root',[0,0,0]);a.joint('arm',[.4,1,0],'root');a.ell('wood',[0,.8,0],[.4,.8,.3],'root');a.tube('ivory',[[.4,1,0],[2.8,1,0]],[.12,.1],'arm');if(animated){for(const [name,angle] of [['idle',.15],['attack',-1.4]] as const){const clip=a.doc.createAnimation(name);a.channel(clip,'arm',[0,.5,1],[[0,0,0],[0,0,angle],[0,0,0]]);}}return a.bytes();}
test('every animation is independently selectable, sampled and released on reload',async()=>{
 const p=await Preview.create();try{await p.load(await model());expect(p.animations.length).toBe(2);expect(p.defaultViews().length).toBe(9);expect(p.defaultViews().filter(v=>v.clip===1).length).toBe(3);
 const rest=await p.frame({size:96,clip:false}),idle=await p.frame({size:96,clip:'idle',time:.5}),attack=await p.frame({size:96,clip:1,time:.5});expect(attack.bytes).not.toEqual(idle.bytes);expect(idle.bytes).not.toEqual(rest.bytes);
 expect((await p.frame({size:96,clip:'attack',time:.5})).bytes).toEqual(attack.bytes);expect((await p.frame({size:96,clip:false})).bytes).toEqual(rest.bytes);expect(()=>p.setClip('absent')).toThrow('Unknown');
 // The second clip extends below/left of the modest first animation.
 expect(p.bounds.min.y).toBeLessThan(p.restBounds.min.y-.05);
 await p.load(await model(false));expect(p.animations).toEqual([]);expect(p.clips).toEqual([]);expect(p.defaultViews().length).toBe(4);await p.frame({size:64});
 }finally{await p.dispose();}
},30000);
