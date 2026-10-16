export function createQueueNotificationProvider(environment=process.env){
  const endpoint=environment.QUEUE_NOTIFICATION_PROVIDER_URL?.trim();
  const apiKey=environment.QUEUE_NOTIFICATION_PROVIDER_API_KEY?.trim();
  if(endpoint&&!/^https:\/\//.test(endpoint)&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(endpoint))throw new Error('QUEUE_NOTIFICATION_PROVIDER_URL must use HTTPS (localhost is allowed for development).');
  return {
    configured:!!endpoint,
    async send(message){
      if(!endpoint)throw Object.assign(new Error('Queue notification provider is not configured.'),{permanent:true});
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      try{
        const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})},body:JSON.stringify(message),signal:controller.signal});
        if(!response.ok){const error=Object.assign(new Error('Notification provider rejected the message.'),{permanent:response.status>=400&&response.status<500});throw error;}
        const result=await response.json().catch(()=>({}));
        return {reference:typeof result.reference==='string'?result.reference.slice(0,120):''};
      }finally{clearTimeout(timer);}
    }
  };
}
