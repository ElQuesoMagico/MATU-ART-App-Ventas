import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'
export function precachePaths(files:string[]):string[] {
  return [...new Set([...files,'index.html','manifest.webmanifest','./','fonts/Fraunces-Variable.ttf','icons.svg','favicon.svg'])]
}
/** Cache the exact production build, including export workers and local artwork.
 * Public build assets are identical across Origin headers. Vite's Vary: Origin
 * must not make module-script requests miss their precached copy when offline.
 */
export function offlineWorkerSource(paths:string[]):string {
    const version=createHash('sha256').update(paths.join('|')).digest('hex').slice(0,16)
    return `const SCOPE=new URL(self.registration.scope).pathname;
const PREFIX='matu-art-shell-'+encodeURIComponent(SCOPE)+'-';
const CACHE=PREFIX+'${version}'; const FILES=${JSON.stringify(paths)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(SCOPE)||url.pathname==='/api'||url.pathname.startsWith('/api/')||url.pathname.startsWith(SCOPE+'api/'))return;event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(event.request,{ignoreVary:true});if(cached)return cached;if(event.request.mode==='navigate'){try{return await fetch(event.request)}catch{return await cache.match('index.html')}}return fetch(event.request)}))});
`
}
export function offlinePlugin():Plugin {
  return {name:'matu-offline-shell',apply:'build',enforce:'post',generateBundle(_options,bundle){
    const logo=Object.keys(bundle).find(path=>/matu-art-official.*\.png$/.test(path))
    if(!logo)throw new Error('Falta el logo oficial para el manifiesto PWA.')
    this.emitFile({type:'asset',fileName:'manifest.webmanifest',source:JSON.stringify({id:'./',name:'MATU ART',short_name:'MATU ART',lang:'es',start_url:'./#inicio',scope:'./',display:'standalone',background_color:'#FFF8EE',theme_color:'#FFF8EE',icons:[{src:logo,sizes:'any',type:'image/png',purpose:'any'}]})})
    this.emitFile({type:'asset',fileName:'sw.js',source:offlineWorkerSource(precachePaths(Object.keys(bundle)))})
  }}
}
