import{g as q,s as J,a as K,b as Q,p as Y,o as tt,_ as o,l as w,c as et,D as at,G as it,H as rt,d as ot,x as st,E as nt}from"./mermaid.core-cPTHV3af.js";import{p as lt}from"./chunk-4BX2VUAB-B2TGKnYV.js";import{p as ct}from"./wardley-L42UT6IY-BD_IXjFL.js";import{d as G,o as dt,a as pt}from"./vendor-viz-CFmBlvIC.js";import"./vendor-react-Dm3MaKgN.js";import"./mermaid-VLURNSYL-CqtYlYKs.js";import"./vendor-icons-DS1QaEQ0.js";import"./index-DkhlcWXM.js";import"./vendor-data-B9ImIvYV.js";import"./vendor-radix-CcIGs0Vk.js";import"./separator-B0i9Evy6.js";import"./select-YEOKfeFG.js";import"./tabs-DYg4CKES.js";import"./label-C7zoZ_K6.js";import"./LoadingQuote-YUeWinkO.js";import"./badge-DlW-YKS5.js";var gt=nt.pie,D={sections:new Map,showData:!1},h=D.sections,C=D.showData,mt=structuredClone(gt),ht=o(()=>structuredClone(mt),"getConfig"),ut=o(()=>{h=new Map,C=D.showData,st()},"clear"),ft=o(({label:t,value:a})=>{if(a<0)throw new Error(`"${t}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);h.has(t)||(h.set(t,a),w.debug(`added new section: ${t}, with value: ${a}`))},"addSection"),vt=o(()=>h,"getSections"),xt=o(t=>{C=t},"setShowData"),St=o(()=>C,"getShowData"),M={getConfig:ht,clear:ut,setDiagramTitle:tt,getDiagramTitle:Y,setAccTitle:Q,getAccTitle:K,setAccDescription:J,getAccDescription:q,addSection:ft,getSections:vt,setShowData:xt,getShowData:St},wt=o((t,a)=>{lt(t,a),a.setShowData(t.showData),t.sections.map(a.addSection)},"populateDb"),Dt={parse:o(async t=>{const a=await ct("pie",t);w.debug(a),wt(a,M)},"parse")},Ct=o(t=>`
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
`,"getStyles"),$t=Ct,yt=o(t=>{const a=[...t.values()].reduce((r,n)=>r+n,0),$=[...t.entries()].map(([r,n])=>({label:r,value:n})).filter(r=>r.value/a*100>=1);return pt().value(r=>r.value).sort(null)($)},"createPieArcs"),Tt=o((t,a,$,y)=>{w.debug(`rendering pie chart
`+t);const r=y.db,n=et(),T=at(r.getConfig(),n.pie),A=40,s=18,p=4,c=450,d=c,u=it(a),l=u.append("g");l.attr("transform","translate("+d/2+","+c/2+")");const{themeVariables:i}=n;let[b]=rt(i.pieOuterStrokeWidth);b??=2;const E=T.textPosition,g=Math.min(d,c)/2-A,L=G().innerRadius(0).outerRadius(g),B=G().innerRadius(g*E).outerRadius(g*E);l.append("circle").attr("cx",0).attr("cy",0).attr("r",g+b/2).attr("class","pieOuterCircle");const m=r.getSections(),O=yt(m),P=[i.pie1,i.pie2,i.pie3,i.pie4,i.pie5,i.pie6,i.pie7,i.pie8,i.pie9,i.pie10,i.pie11,i.pie12];let f=0;m.forEach(e=>{f+=e});const _=O.filter(e=>(e.data.value/f*100).toFixed(0)!=="0"),v=dt(P).domain([...m.keys()]);l.selectAll("mySlices").data(_).enter().append("path").attr("d",L).attr("fill",e=>v(e.data.label)).attr("class","pieCircle"),l.selectAll("mySlices").data(_).enter().append("text").text(e=>(e.data.value/f*100).toFixed(0)+"%").attr("transform",e=>"translate("+B.centroid(e)+")").style("text-anchor","middle").attr("class","slice");const I=l.append("text").text(r.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),k=[...m.entries()].map(([e,S])=>({label:e,value:S})),x=l.selectAll(".legend").data(k).enter().append("g").attr("class","legend").attr("transform",(e,S)=>{const F=s+p,X=F*k.length/2,Z=12*s,j=S*F-X;return"translate("+Z+","+j+")"});x.append("rect").attr("width",s).attr("height",s).style("fill",e=>v(e.label)).style("stroke",e=>v(e.label)),x.append("text").attr("x",s+p).attr("y",s-p).text(e=>r.getShowData()?`${e.label} [${e.value}]`:e.label);const N=Math.max(...x.selectAll("text").nodes().map(e=>e?.getBoundingClientRect().width??0)),U=d+A+s+p+N,R=I.node()?.getBoundingClientRect().width??0,H=d/2-R/2,V=d/2+R/2,W=Math.min(0,H),z=Math.max(U,V)-W;u.attr("viewBox",`${W} 0 ${z} ${c}`),ot(u,c,z,T.useMaxWidth)},"draw"),At={draw:Tt},Ht={parser:Dt,db:M,renderer:At,styles:$t};export{Ht as diagram};
