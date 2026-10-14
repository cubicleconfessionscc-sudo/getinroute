const TOKEN='R0I7deBujwaPlGGIdPtgys0lWQNKpZrVTZtc4tZJRPq'; const ENDPOINT='https://backboard.railway.app/graphql/v2'; const https=require('https');
const q='mutation Redeploy($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }';
const variables={serviceId:'0b2b4ce3-d5a5-4400-ad6b-5356e4931cf5',environmentId:'7e6c890a-b180-4b49-a42e-dd804ea39cac'};
const body=JSON.stringify({query:q,variables});
const req=https.request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+TOKEN}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log('HTTP',res.statusCode,d))});
req.on('error',e=>console.error('ERR',e.message)); req.write(body); req.end();
