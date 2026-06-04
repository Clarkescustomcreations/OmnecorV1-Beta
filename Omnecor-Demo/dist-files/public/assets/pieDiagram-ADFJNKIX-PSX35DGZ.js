import{g as U,s as q,a as V,b as Z,q as j,p as H,_ as o,l as w,c as J,E as K,I as Q,L as X,d as Y,y as ee,F as te}from"./mermaid.core-OMwv7Hfa.js";import{p as ae}from"./chunk-4BX2VUAB-DZV3h2c5.js";import{p as re}from"./treemap-KMMF4GRG-BqUDX95k.js";import{d as G,o as ie,a as oe}from"./vendor-charts-_EGTr-y0.js";import"./index-CuiZzZwv.js";import"./vendor-react-Bhh30CDp.js";import"./vendor-data-B_WJGqzE.js";import"./vendor-radix-DLsYhpGj.js";import"./vendor-icons-A3o2_2Oj.js";import"./Chat-keNA6aEq.js";import"./OmnecorDashboardLayout-BOV8g5_w.js";import"./button-CRvjbTfw.js";import"./input-B0PcLosX.js";import"./useOmnecorSocket-uDUcT_s_.js";import"./textarea-CoCvaTdf.js";import"./aiModels-DI3c5AUE.js";import"./_baseUniq-CzRKVGGr.js";import"./_basePickBy-BNgGc2wW.js";import"./clone-CiAGjI7v.js";var se=te.pie,D={sections:new Map,showData:!1},g=D.sections,C=D.showData,le=structuredClone(se),ne=o(()=>structuredClone(le),"getConfig"),ce=o(()=>{g=new Map,C=D.showData,ee()},"clear"),pe=o(({label:e,value:a})=>{if(a<0)throw new Error(`"${e}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);g.has(e)||(g.set(e,a),w.debug(`added new section: ${e}, with value: ${a}`))},"addSection"),de=o(()=>g,"getSections"),ge=o(e=>{C=e},"setShowData"),me=o(()=>C,"getShowData"),W={getConfig:ne,clear:ce,setDiagramTitle:H,getDiagramTitle:j,setAccTitle:Z,getAccTitle:V,setAccDescription:q,getAccDescription:U,addSection:pe,getSections:de,setShowData:ge,getShowData:me},ue=o((e,a)=>{ae(e,a),a.setShowData(e.showData),e.sections.map(a.addSection)},"populateDb"),fe={parse:o(async e=>{const a=await re("pie",e);w.debug(a),ue(a,W)},"parse")},he=o(e=>`
  .pieCircle{
    stroke: ${e.pieStrokeColor};
    stroke-width : ${e.pieStrokeWidth};
    opacity : ${e.pieOpacity};
  }
  .pieOuterCircle{
    stroke: ${e.pieOuterStrokeColor};
    stroke-width: ${e.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${e.pieTitleTextSize};
    fill: ${e.pieTitleTextColor};
    font-family: ${e.fontFamily};
  }
  .slice {
    font-family: ${e.fontFamily};
    fill: ${e.pieSectionTextColor};
    font-size:${e.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${e.pieLegendTextColor};
    font-family: ${e.fontFamily};
    font-size: ${e.pieLegendTextSize};
  }
`,"getStyles"),ve=he,Se=o(e=>{const a=[...e.values()].reduce((r,s)=>r+s,0),y=[...e.entries()].map(([r,s])=>({label:r,value:s})).filter(r=>r.value/a*100>=1).sort((r,s)=>s.value-r.value);return oe().value(r=>r.value)(y)},"createPieArcs"),xe=o((e,a,y,$)=>{w.debug(`rendering pie chart
`+e);const r=$.db,s=J(),T=K(r.getConfig(),s.pie),A=40,l=18,p=4,c=450,m=c,u=Q(a),n=u.append("g");n.attr("transform","translate("+m/2+","+c/2+")");const{themeVariables:i}=s;let[b]=X(i.pieOuterStrokeWidth);b??=2;const E=T.textPosition,d=Math.min(m,c)/2-A,I=G().innerRadius(0).outerRadius(d),L=G().innerRadius(d*E).outerRadius(d*E);n.append("circle").attr("cx",0).attr("cy",0).attr("r",d+b/2).attr("class","pieOuterCircle");const f=r.getSections(),M=Se(f),O=[i.pie1,i.pie2,i.pie3,i.pie4,i.pie5,i.pie6,i.pie7,i.pie8,i.pie9,i.pie10,i.pie11,i.pie12];let h=0;f.forEach(t=>{h+=t});const _=M.filter(t=>(t.data.value/h*100).toFixed(0)!=="0"),v=ie(O);n.selectAll("mySlices").data(_).enter().append("path").attr("d",I).attr("fill",t=>v(t.data.label)).attr("class","pieCircle"),n.selectAll("mySlices").data(_).enter().append("text").text(t=>(t.data.value/h*100).toFixed(0)+"%").attr("transform",t=>"translate("+L.centroid(t)+")").style("text-anchor","middle").attr("class","slice"),n.append("text").text(r.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText");const k=[...f.entries()].map(([t,x])=>({label:t,value:x})),S=n.selectAll(".legend").data(k).enter().append("g").attr("class","legend").attr("transform",(t,x)=>{const z=l+p,R=z*k.length/2,N=12*l,B=x*z-R;return"translate("+N+","+B+")"});S.append("rect").attr("width",l).attr("height",l).style("fill",t=>v(t.label)).style("stroke",t=>v(t.label)),S.append("text").attr("x",l+p).attr("y",l-p).text(t=>r.getShowData()?`${t.label} [${t.value}]`:t.label);const P=Math.max(...S.selectAll("text").nodes().map(t=>t?.getBoundingClientRect().width??0)),F=m+A+l+p+P;u.attr("viewBox",`0 0 ${F} ${c}`),Y(u,c,F,T.useMaxWidth)},"draw"),we={draw:xe},Re={parser:fe,db:W,renderer:we,styles:ve};export{Re as diagram};
