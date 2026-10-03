/** Fixed-member HTTPS storage proxy. No DSH RPC framing or session implementation. */
import {createServer} from 'node:http';import {request} from 'node:https';
export async function startSessionBridge(user,{backendUrl,serviceKey}){
 const backend=new URL(backendUrl);if(backend.protocol!=='https:'||serviceKey.length<32)throw Error('Trusted database backend required');
 const reject=(res,status)=>{res.writeHead(status,{'cache-control':'no-store'});res.end();};
 const verify=authorization=>new Promise((resolve,reject)=>{const q=request(new URL('/api/auth/me',backend),{headers:{authorization}},r=>{let body='';r.on('data',b=>{body+=b;if(body.length>16000)q.destroy(Error('Identity too large'));});r.on('end',()=>{try{const a=r.statusCode===200?JSON.parse(body):undefined;resolve(a?.id===user.id&&a?.organizationId===user.org&&a?.mustChangePassword===false);}catch(e){reject(e);}});});q.setTimeout(5000,()=>q.destroy(Error('Identity timeout')));q.on('error',reject);q.end();});
 const server=createServer(async(req,res)=>{try{
  if(req.method!=='POST'||req.url!=='/api/internal/member-sessions')return reject(res,403);
  const authorization=req.headers.authorization;if(!/^Bearer [A-Za-z0-9_-]{16,512}$/.test(authorization??'')||!await verify(authorization))return reject(res,403);
  const q=request(new URL('/api/internal/member-sessions',backend),{method:'POST',headers:{authorization,'content-type':'application/json','x-workdsh-service-key':serviceKey}},r=>{res.writeHead(r.statusCode,{'content-type':'application/json','cache-control':'no-store'});r.pipe(res);});
  let bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>64*1024*1024){q.destroy();req.destroy();res.destroy();}});q.setTimeout(15000,()=>q.destroy(Error('Storage timeout')));q.on('error',()=>{if(!res.headersSent)reject(res,502);else res.destroy();});res.on('close',()=>q.destroy());req.pipe(q);
 }catch{if(!res.headersSent)reject(res,503);else res.destroy();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(user.bridgePort,'127.0.0.1',resolve);});return server;
}
