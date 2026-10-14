const TOKEN='R0I7deBujwaPlGGIdPtgys0lWQNKpZrVTZtc4tZJRPq'; const ENDPOINT='https://backboard.railway.app/graphql/v2'; const https=require('https');
const q='{ __type(name: "Mutation") { fields { name args { name type { name ofType { name } } } } } }';
const body=JSON.stringify({query:q});
const req=https.request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+TOKEN}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{const j=JSON.parse(d); console.log(j.data.__type.fields.filter(f=>f.name.match(/github|service|source|connect/i)).map(f=>f.name+'('+f.args.map(a=>a.name+':'+a.type.name+(a.type.ofType?'['+a.type.ofType.name+']':'')).join(',')+')').join('\n'))})});
req.write(body); req.end();
