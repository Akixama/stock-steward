self.addEventListener('push',event=>{
 let message={};
 try{message=event.data?.json()??{}}catch{message={}}
 const title=typeof message.title==='string'?message.title:'Stock Steward price alert';
 const body=typeof message.body==='string'?message.body:'A price alert has triggered.';
 event.waitUntil(self.registration.showNotification(title,{body,icon:'/favicon.svg',badge:'/favicon.svg',tag:typeof message.id==='string'?`stock-steward-${message.id}`:'stock-steward-price-alert',data:{url:'/workspace'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const url=new URL('/workspace',self.location.origin).href;
  const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
  const match=windows.find(client=>client.url.startsWith(self.location.origin+'/workspace'));
  if(match){await match.focus();return;}
  await clients.openWindow(url);
 })());
});
