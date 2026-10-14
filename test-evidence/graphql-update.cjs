const TOKEN='I70bYCIHT-ac5vlqxboqQWA-1Tp3ataxGykQwJex6HC'; const ENDPOINT='https://backboard.railway.app/graphql/v2'; const https=require('https');
const q='mutation Update($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }';
const variables={serviceId:'0b2b4ce3-d5a5-4400-ad6b-5356e4931cf5',environmentId:'7e6c890a-b180-4b49-a42e-dd804ea39cac',input:{builder:'DOCKERFILE',dockerfilePath:'Dockerfile'}};
const body=JSON.stringify({query:q,variables});
const req=https.request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+TOKEN}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log('HTTP',res.statusCode,d))});
req.on('error',e=>console.error('ERR',e.message)); req.write(body); req.end();
