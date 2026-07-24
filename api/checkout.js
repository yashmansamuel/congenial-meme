import { getAuthenticatedUser } from '../lib/auth.js';
import { setJsonHeaders, isAllowedOrigin } from '../lib/http.js';

export default async function handler(req,res){
  setJsonHeaders(res);
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method Not Allowed'});}
  try{if(!isAllowedOrigin(req))return res.status(403).json({error:'Request origin is not allowed.'});}catch(error){return res.status(500).json({error:'Checkout is not configured safely.'});}
  const user=getAuthenticatedUser(req); if(!user?.userId)return res.status(401).json({error:'Authentication required.'});
  const apiKey=process.env.LEMON_SQUEEZY_API_KEY,storeId=process.env.LEMON_SQUEEZY_STORE_ID,variantId=process.env.LEMON_SQUEEZY_VARIANT_ID;
  if(!apiKey||!storeId||!variantId)return res.status(503).json({error:'NEO Pro checkout is not available yet.'});
  try{
    const attributes={checkout_data:{custom:{user_id:String(user.userId),bean_id:String(user.username||'')}},product_options:{redirect_url:process.env.LEMON_SQUEEZY_SUCCESS_URL||process.env.APP_ORIGIN}};
    const response=await fetch('https://api.lemonsqueezy.com/v1/checkouts',{method:'POST',headers:{Accept:'application/vnd.api+json','Content-Type':'application/vnd.api+json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({data:{type:'checkouts',attributes,relationships:{store:{data:{type:'stores',id:String(storeId)}},variant:{data:{type:'variants',id:String(variantId)}}}}})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data?.errors?.[0]?.detail||'Checkout provider request failed.');
    const url=data?.data?.attributes?.url; if(!url)throw new Error('Checkout URL was not returned.');
    return res.status(200).json({success:true,url});
  }catch(error){console.error('Checkout error:',error.message);return res.status(502).json({error:'Unable to start checkout. Please try again.'});}
}
