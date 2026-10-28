const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8'),expected=['basic','intention','education','experience','project','games','ai','skills','extras','family','compliance'].map(x=>'resume-'+x);
const sections=[...html.matchAll(/<section class="form-section content-card" id="([^"]+)">\s*<div class="section-heading"><span>([^<]+)<\/span><div><h3>([^<]+)<\/h3>/g)].map(m=>({id:m[1],number:m[2],title:m[3]}));
const nav=html.match(/<aside class="resume-nav content-card">([\s\S]*?)<\/aside>/)?.[1]||'',links=[...nav.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)].map(m=>({target:m[1],text:m[2]}));
test('resume has11 stable section ids in physical document order',()=>assert.deepEqual(sections.map(x=>x.id),expected));
test('resume body ordinals stay unique and sequential01..11',()=>assert.deepEqual(sections.map(x=>x.number),expected.map((_,i)=>String(i+1).padStart(2,'0'))));
test('resume directory covers all sections once in matching order',()=>assert.deepEqual(links.map(x=>x.target),expected));
test('resume directory labels match their actual headings including AI',()=>assert.deepEqual(links,sections.map(x=>({target:x.id,text:x.number+' '+x.title}))));
