import{g as Z,s as j,a as J,b as Q,q as Y,p as tt,_ as o,l as w,c as et,G as at,K as it,L as rt,d as ot,z as st,H as nt}from"./mermaid.core-CS9SCNKn.js";import{p as lt}from"./chunk-4BX2VUAB-DgwM7atM.js";import{p as ct}from"./wardley-L42UT6IY-DIae3KG2.js";import{d as G,o as pt,a as dt}from"./vendor-charts-CP5RxuOL.js";import"./index-BUDzoAT9.js";import"./vendor-react-Bhh30CDp.js";import"./vendor-data-B2g5Jvuq.js";import"./vendor-radix-DbQvScMD.js";import"./vendor-icons-teAETbNX.js";import"./Chat-BF81eU7d.js";import"./OmnecorDashboardLayout-Dvu7LgX1.js";import"./input-BjqFBOCg.js";import"./useOmnecorSocket-CgEKkpQo.js";import"./integrations-E6SoJVA7.js";import"./textarea-BAfdbswf.js";import"./aiModels-BG1du8VA.js";import"\0tiktoken/lite?commonjs-external";var gt=nt.pie,C={sections:new Map,showData:!1},h=C.sections,D=C.showData,mt=structuredClone(gt),ht=o(()=>structuredClone(mt),"getConfig"),ut=o(()=>{h=new Map,D=C.showData,st()},"clear"),ft=o(({label:t,value:a})=>{if(a<0)throw new Error(`"${t}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);h.has(t)||(h.set(t,a),w.debug(`added new section: ${t}, with value: ${a}`))},"addSection"),vt=o(()=>h,"getSections"),xt=o(t=>{D=t},"setShowData"),St=o(()=>D,"getShowData"),L={getConfig:ht,clear:ut,setDiagramTitle:tt,getDiagramTitle:Y,setAccTitle:Q,getAccTitle:J,setAccDescription:j,getAccDescription:Z,addSection:ft,getSections:vt,setShowData:xt,getShowData:St},wt=o((t,a)=>{lt(t,a),a.setShowData(t.showData),t.sections.map(a.addSection)},"populateDb"),Ct={parse:o(async t=>{const a=await ct("pie",t);w.debug(a),wt(a,L)},"parse")},Dt=o(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),$t=Dt,yt=o(t=>{const a=[...t.values()].reduce((r,n)=>r+n,0),$=[...t.entries()].map(([r,n])=>({label:r,value:n})).filter(r=>r.value/a*100>=1);return dt().value(r=>r.value).sort(null)($)},"createPieArcs"),Tt=o((t,a,$,y)=>{w.debug(`rendering pie chart
`+t);const r=y.db,n=et(),T=at(r.getConfig(),n.pie),A=40,s=18,d=4,c=450,p=c,u=it(a),l=u.append("g");l.attr("transform","translate("+p/2+","+c/2+")");const{themeVariables:i}=n;let[b]=rt(i.pieOuterStrokeWidth);b??=2;const _=T.textPosition,g=Math.min(p,c)/2-A,M=G().innerRadius(0).outerRadius(g),B=G().innerRadius(g*_).outerRadius(g*_);l.append("circle").attr("cx",0).attr("cy",0).attr("r",g+b/2).attr("class","pieOuterCircle");const m=r.getSections(),O=yt(m),P=[i.pie1,i.pie2,i.pie3,i.pie4,i.pie5,i.pie6,i.pie7,i.pie8,i.pie9,i.pie10,i.pie11,i.pie12];let f=0;m.forEach(e=>{f+=e});const E=O.filter(e=>(e.data.value/f*100).toFixed(0)!=="0"),v=pt(P).domain([...m.keys()]);l.selectAll("mySlices").data(E).enter().append("path").attr("d",M).attr("fill",e=>v(e.data.label)).attr("class","pieCircle"),l.selectAll("mySlices").data(E).enter().append("text").text(e=>(e.data.value/f*100).toFixed(0)+"%").attr("transform",e=>"translate("+B.centroid(e)+")").style("text-anchor","middle").attr("class","slice");const I=l.append("text").text(r.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),k=[...m.entries()].map(([e,S])=>({label:e,value:S})),x=l.selectAll(".legend").data(k).enter().append("g").attr("class","legend").attr("transform",(e,S)=>{const F=s+d,K=F*k.length/2,V=12*s,X=S*F-K;return"translate("+V+","+X+")"});x.append("rect").attr("width",s).attr("height",s).style("fill",e=>v(e.label)).style("stroke",e=>v(e.label)),x.append("text").attr("x",s+d).attr("y",s-d).text(e=>r.getShowData()?`${e.label} [${e.value}]`:e.label);const N=Math.max(...x.selectAll("text").nodes().map(e=>e?.getBoundingClientRect().width??0)),U=p+A+s+d+N,R=I.node()?.getBoundingClientRect().width??0,q=p/2-R/2,H=p/2+R/2,z=Math.min(0,q),W=Math.max(U,H)-z;u.attr("viewBox",`${z} 0 ${W} ${c}`),ot(u,c,W,T.useMaxWidth)},"draw"),At={draw:Tt},Ht={parser:Ct,db:L,renderer:At,styles:$t};export{Ht as diagram};
