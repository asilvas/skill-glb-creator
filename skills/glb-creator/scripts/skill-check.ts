import { resolve,dirname } from 'node:path';
import { ROOT } from './paths';
// Bun equivalent of skill-creator's quick_validate.py. Repository policy forbids Python tooling.
const text=await Bun.file(resolve(ROOT,'SKILL.md')).text(),match=text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if(!match)throw Error('Missing YAML frontmatter');
const meta=Bun.YAML.parse(match[1]) as Record<string,unknown>;
const allowed=new Set(['name','description','license','allowed-tools','metadata']);
if(!meta||typeof meta!=='object'||Array.isArray(meta)||Object.keys(meta).some(k=>!allowed.has(k)))throw Error('Invalid frontmatter keys');
if(typeof meta.name!=='string'||meta.name.length>64||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.name))throw Error('Invalid skill name');
if(typeof meta.description!=='string'||!meta.description.trim()||meta.description.length>1024||/[<>]/.test(meta.description)||meta.description.startsWith('[TODO:'))throw Error('Invalid description');
let fence:string|undefined;
for(const line of text.slice(match[0].length).split(/\r?\n/)){
  const f=line.match(/^\s*(`{3,}|~{3,})(.*)$/);
  if(f){if(!fence)fence=f[1];else if(f[1][0]===fence[0]&&f[1].length>=fence.length&&!f[2].trim())fence=undefined;continue;}
  if(!fence&&/^ {0,3}\[TODO:.*\]\s*$/.test(line))throw Error('Unfinished scaffold');
}
const manifest=await Bun.file(resolve(ROOT,'package.json')).json();
if(typeof manifest.version!=='string'||!/^\d+\.\d+\.\d+$/.test(manifest.version))throw Error('Invalid package version');
for(const [name,path]of Object.entries(manifest.exports??{})){
  if(typeof path!=='string'||!path.startsWith('./')||!await Bun.file(resolve(ROOT,path)).exists())throw Error(`Missing package export ${name}`);
}
for(const link of text.matchAll(/\]\(([^)]+\.md)\)/g)){
  if(!await Bun.file(resolve(ROOT,link[1])).exists())throw Error(`Missing skill reference ${link[1]}`);
}
const repoManifest=Bun.file(resolve(ROOT,'../../package.json'));
if(await repoManifest.exists()){
  const repo=await repoManifest.json();
  if(repo.name===manifest.name&&(repo.version!==manifest.version||JSON.stringify(repo.dependencies)!==JSON.stringify(manifest.dependencies)))throw Error('Root and installed-skill version/dependencies differ');
}
console.log(`Skill/package ${manifest.version} frontmatter, exports, references and consistency checks pass.`);
