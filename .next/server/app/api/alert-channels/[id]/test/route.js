"use strict";(()=>{var a={};a.id=904,a.ids=[904],a.modules={261:a=>{a.exports=require("next/dist/shared/lib/router/utils/app-paths")},643:a=>{a.exports=require("node:perf_hooks")},3295:a=>{a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},10846:a=>{a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},17608:(a,b,c)=>{c.a(a,async(a,d)=>{try{c.r(b),c.d(b,{handler:()=>y,patchFetch:()=>x,routeModule:()=>z,serverHooks:()=>C,workAsyncStorage:()=>A,workUnitAsyncStorage:()=>B});var e=c(95736),f=c(9117),g=c(4044),h=c(39326),i=c(32324),j=c(261),k=c(54290),l=c(85328),m=c(38928),n=c(46595),o=c(3421),p=c(17679),q=c(41681),r=c(63446),s=c(86439),t=c(34679),u=c(51356),v=c(94059),w=a([v]);v=(w.then?(await w)():w)[0];let z=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/alert-channels/[id]/test/route",pathname:"/api/alert-channels/[id]/test",filename:"route",bundlePath:"app/api/alert-channels/[id]/test/route"},distDir:".next",relativeProjectDir:"..\\..\\..\\..\\PortafolioProfesional\\pulsetrack",resolvedPagePath:"C:\\Users\\Eduardomr\\PortafolioProfesional\\pulsetrack\\src\\app\\api\\alert-channels\\[id]\\test\\route.ts",nextConfigOutput:"",userland:v}),{workAsyncStorage:A,workUnitAsyncStorage:B,serverHooks:C}=z;function x(){return(0,g.patchFetch)({workAsyncStorage:A,workUnitAsyncStorage:B})}async function y(a,b,c){var d;let e="/api/alert-channels/[id]/test/route";"/index"===e&&(e="/");let g=await z.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:v,params:w,nextConfig:x,isDraftMode:y,prerenderManifest:A,routerServerContext:B,isOnDemandRevalidate:C,revalidateOnlyGenerated:D,resolvedPathname:E}=g,F=(0,j.normalizeAppPath)(e),G=!!A.routes[E]&&(z.isDev||(0,t.isRouteCacheOwner)(E,z.cacheOwner,A.routes[E])),H=!!(A.dynamicRoutes[F]||G);if(H&&!y){let a=A.dynamicRoutes[F];if(a&&!1===a.fallback&&!G)throw new s.NoFallbackError}let I=null;!H||z.isDev||y||(I=E,I="/index"===I?"/":I);let J=!0===z.isDev||!H,K=H&&!J,L=a.method||"GET",M=(0,i.getTracer)(),N=M.getActiveScopeSpan(),O={params:w,prerenderManifest:A,renderOpts:{experimental:{cacheComponents:!!x.experimental.cacheComponents,authInterrupts:!!x.experimental.authInterrupts},supportsDynamicResponse:J,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=x.experimental)?void 0:d.cacheLife,isRevalidate:K,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>z.onRequestError(a,b,d,B)},sharedContext:{buildId:v}},P=new k.NodeNextRequest(a),Q=new k.NodeNextResponse(b),R=l.NextRequestAdapter.fromNodeNextRequest(P,(0,l.signalFromNodeResponse)(b));try{let d=async c=>z.handle(R,O).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=M.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${L} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${L} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&C&&D&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=O.renderOpts.fetchMetrics;let i=O.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=O.renderOpts.collectedTags;if(!H)return await (0,o.I)(P,Q,e,O.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==O.renderOpts.collectedRevalidate&&!(O.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&O.renderOpts.collectedRevalidate,d=void 0===O.renderOpts.collectedExpire||O.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:O.renderOpts.collectedExpire;return{value:{kind:u.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await z.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:K,isOnDemandRevalidate:C})},B),b}},l=await z.handleResponse({req:a,nextConfig:x,cacheKey:I,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:A,isRoutePPREnabled:!1,isOnDemandRevalidate:C,revalidateOnlyGenerated:D,responseGenerator:k,waitUntil:c.waitUntil});if(!H)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==u.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",C?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),y&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&H||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(P,Q,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};N?await g(N):await M.withPropagatedContext(a.headers,()=>M.trace(m.BaseServerSpan.handleRequest,{spanName:`${L} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":L,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await z.onRequestError(a,b,{routerKind:"App Router",routePath:F,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:K,isOnDemandRevalidate:C})}),H)throw b;return await (0,o.I)(P,Q,new Response(null,{status:500})),null}}d()}catch(a){d(a)}})},19121:a=>{a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},28855:a=>{a.exports=import("@libsql/client")},29294:a=>{a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},33873:a=>{a.exports=require("path")},37067:a=>{a.exports=require("node:http")},41692:a=>{a.exports=require("node:tls")},44708:a=>{a.exports=require("node:https")},44870:a=>{a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},50570:(a,b,c)=>{c.a(a,async(a,d)=>{try{c.d(b,{s:()=>g});var e=c(1534),f=a([e]);async function g(){await e.p.execute(`
    CREATE TABLE IF NOT EXISTS endpoints (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      headers TEXT DEFAULT '{}',
      body TEXT,
      interval_seconds INTEGER NOT NULL DEFAULT 30,
      timeout_ms INTEGER NOT NULL DEFAULT 5000,
      expected_status_codes TEXT NOT NULL DEFAULT '[200]',
      assertions TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `),await e.p.execute(`
    CREATE TABLE IF NOT EXISTS health_checks (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      status_code INTEGER,
      status_text TEXT,
      dns_lookup_ms REAL NOT NULL DEFAULT 0,
      tcp_connect_ms REAL NOT NULL DEFAULT 0,
      tls_handshake_ms REAL NOT NULL DEFAULT 0,
      ttfb_ms REAL NOT NULL DEFAULT 0,
      content_transfer_ms REAL NOT NULL DEFAULT 0,
      total_ms REAL NOT NULL DEFAULT 0,
      ssl_info TEXT,
      error_message TEXT,
      failed_assertions TEXT NOT NULL DEFAULT '[]',
      response_headers TEXT,
      region TEXT NOT NULL DEFAULT 'primary'
    );
  `),await e.p.execute(`
    CREATE INDEX IF NOT EXISTS idx_health_checks_endpoint_time 
    ON health_checks (endpoint_id, timestamp);
  `),await e.p.execute(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      severity TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      resolved_at INTEGER,
      summary TEXT NOT NULL,
      consecutive_failures INTEGER NOT NULL DEFAULT 1
    );
  `),await e.p.execute(`
    CREATE INDEX IF NOT EXISTS idx_incidents_endpoint_status 
    ON incidents (endpoint_id, status);
  `),await e.p.execute(`
    CREATE TABLE IF NOT EXISTS alert_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '["DOWN","RECOVERED"]',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `),await e.p.execute(`
    CREATE TABLE IF NOT EXISTS notification_logs (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES alert_channels(id) ON DELETE CASCADE,
      endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
      incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      response_code INTEGER,
      error_message TEXT,
      timestamp INTEGER NOT NULL
    );
  `),await e.p.execute(`
    CREATE INDEX IF NOT EXISTS idx_notification_logs_endpoint 
    ON notification_logs (endpoint_id, timestamp);
  `),console.log("[PulseTrack DB] Tablas e \xedndices inicializados correctamente.")}e=(f.then?(await f)():f)[0],d()}catch(a){d(a)}})},55511:a=>{a.exports=require("crypto")},63033:a=>{a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},77598:a=>{a.exports=require("node:crypto")},78474:a=>{a.exports=require("node:events")},86439:a=>{a.exports=require("next/dist/shared/lib/no-fallback-error.external")},94059:(a,b,c)=>{c.a(a,async(a,d)=>{try{c.r(b),c.d(b,{POST:()=>j});var e=c(10641),f=c(43985),g=c(50570),h=a([f,g]);[f,g]=h.then?(await h)():h;let k=!1;async function i(){if(!k){for(let a of(await (0,g.s)(),await f.my.findAll()))f.bG.registerChannel(a);k=!0}}async function j(a,{params:b}){try{await i();let{id:a}=await b,c=await f.my.findById(a);if(!c)return e.NextResponse.json({success:!1,statusCode:404,error:`Canal de alerta ${a} no encontrado`},{status:404});let d=await f.bG.testChannel(c);return e.NextResponse.json({success:d.success,statusCode:d.statusCode,error:d.error})}catch(b){let a=b instanceof Error?b.message:"Error al enviar notificaci\xf3n de prueba";return e.NextResponse.json({success:!1,statusCode:500,error:a},{status:500})}}d()}catch(a){d(a)}})}};var b=require("../../../../../webpack-runtime.js");b.C(a);var c=b.X(0,[887,19,641,365],()=>b(b.s=17608));module.exports=c})();