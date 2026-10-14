const TOKEN='R0I7deBujwaPlGGIdPtgys0lWQNKpZrVTZtc4tZJRPq'; const ENDPOINT='https://backboard.railway.app/graphql/v2'; const https=require('https');
const q='{ __schema { queryType { fields { name } } } }';
const body=JSON.stringify({query:q});
const req=https.request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+TOKEN}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{const j=JSON.parse(d); console.log(j.data.__schema.queryType.fields.map(f=>f.name).filter(n=>n.match(/me|user|account/i)).join('\n'))})});
req.write(body); req.end();
