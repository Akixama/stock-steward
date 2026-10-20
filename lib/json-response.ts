export async function jsonResponse<T>(response:Response,fallback:string):Promise<T>{
  if(!response.headers.get('content-type')?.toLowerCase().includes('application/json'))throw Error(fallback);
  try{return await response.json() as T;}
  catch{throw Error(fallback);}
}
