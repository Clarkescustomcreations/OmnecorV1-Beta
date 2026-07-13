import{g as q,s as H,a as J,b as Q,p as Y,o as tt,_ as s,l as w,c as et,D as at,I as it,K as rt,d as st,x as ot,E as nt}from"./mermaid.core-BuhcpVBK.js";import{p as lt}from"./chunk-4BX2VUAB-DdJVRl4o.js";import{p as ct}from"./wardley-L42UT6IY-CHH7Zwu9.js";import{i as M,o as dt,j as pt}from"./vendor-viz-mX_9Y65Z.js";import"./vendor-react-Dm3MaKgN.js";import"./purify.es-DdwdxIb1.js";import"./mermaid-VLURNSYL-BrxJoJ66.js";import"./index-DBbkzoXV.js";import"./vendor-data-B9ImIvYV.js";import"./vendor-radix-DC2vEgJG.js";import"./vendor-icons-B4q2izsf.js";var gt=nt.pie,D={sections:new Map,showData:!1},u=D.sections,C=D.showData,ht=structuredClone(gt),ut=s(()=>structuredClone(ht),"getConfig"),mt=s(()=>{u=new Map,C=D.showData,ot()},"clear"),ft=s(({label:t,value:a})=>{if(a<0)throw new Error(`"${t}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);u.has(t)||(u.set(t,a),w.debug(`added new section: ${t}, with value: ${a}`))},"addSection"),vt=s(()=>u,"getSections"),xt=s(t=>{C=t},"setShowData"),St=s(()=>C,"getShowData"),G={getConfig:ut,clear:mt,setDiagramTitle:tt,getDiagramTitle:Y,setAccTitle:Q,getAccTitle:J,setAccDescription:H,getAccDescription:q,addSection:ft,getSections:vt,setShowData:xt,getShowData:St},wt=s((t,a)=>{lt(t,a),a.setShowData(t.showData),t.sections.map(a.addSection)},"populateDb"),Dt={parse:s(async t=>{const a=await ct("pie",t);w.debug(a),wt(a,G)},"parse")},Ct=s(t=>`
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
`,"getStyles"),$t=Ct,yt=s(t=>{const a=[...t.values()].reduce((r,n)=>r+n,0),$=[...t.entries()].map(([r,n])=>({label:r,value:n})).filter(r=>r.value/a*100>=1);return pt().value(r=>r.value).sort(null)($)},"createPieArcs"),Tt=s((t,a,$,y)=>{w.debug(`rendering pie chart
`+t);const r=y.db,n=et(),T=at(r.getConfig(),n.pie),A=40,o=18,p=4,c=450,d=c,m=it(a),l=m.append("g");l.attr("transform","translate("+d/2+","+c/2+")");const{themeVariables:i}=n;let[b]=rt(i.pieOuterStrokeWidth);b??=2;const E=T.textPosition,g=Math.min(d,c)/2-A,L=M().innerRadius(0).outerRadius(g),B=M().innerRadius(g*E).outerRadius(g*E);l.append("circle").attr("cx",0).attr("cy",0).attr("r",g+b/2).attr("class","pieOuterCircle");const h=r.getSections(),I=yt(h),O=[i.pie1,i.pie2,i.pie3,i.pie4,i.pie5,i.pie6,i.pie7,i.pie8,i.pie9,i.pie10,i.pie11,i.pie12];let f=0;h.forEach(e=>{f+=e});const _=I.filter(e=>(e.data.value/f*100).toFixed(0)!=="0"),v=dt(O).domain([...h.keys()]);l.selectAll("mySlices").data(_).enter().append("path").attr("d",L).attr("fill",e=>v(e.data.label)).attr("class","pieCircle"),l.selectAll("mySlices").data(_).enter().append("text").text(e=>(e.data.value/f*100).toFixed(0)+"%").attr("transform",e=>"translate("+B.centroid(e)+")").style("text-anchor","middle").attr("class","slice");const P=l.append("text").text(r.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),k=[...h.entries()].map(([e,S])=>({label:e,value:S})),x=l.selectAll(".legend").data(k).enter().append("g").attr("class","legend").attr("transform",(e,S)=>{const F=o+p,V=F*k.length/2,X=12*o,Z=S*F-V;return"translate("+X+","+Z+")"});x.append("rect").attr("width",o).attr("height",o).style("fill",e=>v(e.label)).style("stroke",e=>v(e.label)),x.append("text").attr("x",o+p).attr("y",o-p).text(e=>r.getShowData()?`${e.label} [${e.value}]`:e.label);const N=Math.max(...x.selectAll("text").nodes().map(e=>e?.getBoundingClientRect().width??0)),U=d+A+o+p+N,R=P.node()?.getBoundingClientRect().width??0,j=d/2-R/2,K=d/2+R/2,W=Math.min(0,j),z=Math.max(U,K)-W;m.attr("viewBox",`${W} 0 ${z} ${c}`),st(m,c,z,T.useMaxWidth)},"draw"),At={draw:Tt},It={parser:Dt,db:G,renderer:At,styles:$t};export{It as diagram};
