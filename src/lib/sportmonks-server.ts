const BASE='https://api.sportmonks.com/v3/football/';
export async function sportmonks(path:string,parameters:Record<string,string>={}) {
 const token=process.env.SPORTMONKS_API_TOKEN;
 if(!token)throw new Error('SPORTMONKS_API_TOKEN is not configured.');
 if(!/^[a-zA-Z0-9/\-]+$/.test(path))throw new Error('Invalid SportMonks path.');
 const url=new URL(path,BASE);
 for(const [key,value] of Object.entries(parameters))url.searchParams.set(key,value);
 const response=await fetch(url,{headers:{Authorization:token,Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`SportMonks returned HTTP ${response.status}.`);
 const body=await response.json();
 if(!Object.hasOwn(body,'data'))throw new Error('SportMonks did not return a data payload.');
 return {data:body.data,pagination:body.pagination?{current_page:body.pagination.current_page,has_more:body.pagination.has_more,per_page:body.pagination.per_page}:null};
}
