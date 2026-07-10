// Client script for the meet result page. Reads window.__MEET__ (server-injected)
// and plots origin/midpoint/place markers on a Kakao map. Degrades to no-op when the
// Kakao SDK is absent (no KAKAO_MAP_JS_KEY); the static result list is always rendered.
export function meetInteractionScript(): string {
  return `<script>(()=>{
  var share=document.querySelector("[data-share]");
  if(share){share.addEventListener("click",function(){
    var url=location.href;
    function done(){var t=share.textContent;share.classList.add("copied");share.textContent="링크가 복사됐어요";setTimeout(function(){share.classList.remove("copied");share.textContent=t},1600)}
    function fallback(){var a=document.createElement("textarea");a.value=url;a.style.position="fixed";a.style.opacity="0";document.body.appendChild(a);a.focus();a.select();try{document.execCommand("copy");done()}catch(e){}document.body.removeChild(a)}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(done).catch(fallback)}else{fallback()}
  })}
  var data=window.__MEET__;var el=document.getElementById("map");
  if(!el||!data||!window.kakao||!kakao.maps||!kakao.maps.load)return;
  kakao.maps.load(function(){
    var LL=kakao.maps.LatLng;
    var COLORS=["#2563eb","#dc2626","#7c3aed","#d97706","#0891b2","#db2777","#4f46e5","#65a30d"];
    var mid=new LL(data.midpoint.y,data.midpoint.x);
    var map=new kakao.maps.Map(el,{center:mid,level:6});
    var bounds=new kakao.maps.LatLngBounds();
    function pin(pos,html,z){new kakao.maps.CustomOverlay({map:map,position:pos,content:html,yAnchor:1,zIndex:z});bounds.extend(pos)}
    // Colour-coded line from each origin to the midpoint, one colour per origin. When a
    // road-following route is present ([lng,lat] pairs), draw along the roads; else a straight line.
    (data.origins||[]).forEach(function(o,i){
      if(!isFinite(o.x)||!isFinite(o.y))return;
      var c=COLORS[i%COLORS.length];var pos=new LL(o.y,o.x);var path;
      if(o.route&&o.route.length>1){
        path=o.route.map(function(pt){var p=new LL(pt[1],pt[0]);bounds.extend(p);return p});
      }else{path=[pos,mid]}
      new kakao.maps.Polyline({map:map,path:path,strokeWeight:5,strokeColor:c,strokeOpacity:0.9,strokeStyle:"solid"});
      pin(pos,'<div class="pin pin-origin" style="--pin-color:'+c+'">'+(i+1)+'</div>',4);
    });
    (data.places||[]).forEach(function(p){if(!isFinite(p.x)||!isFinite(p.y))return;pin(new LL(p.y,p.x),'<div class="pin pin-place"></div>',3)});
    pin(mid,'<div class="pin pin-mid">중간</div>',6);
    if(!bounds.isEmpty())map.setBounds(bounds,48,48,48,48);
  });
})();</script>`
}
