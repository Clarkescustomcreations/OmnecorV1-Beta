import{f as p,r as w}from"./vendor-react-Bhh30CDp.js";import{f as x,g as v,h as E,R as V,B as M,C as j,M as k}from"./vendor-charts-_EGTr-y0.js";import{u as C}from"./useOmnecorSocket-uDUcT_s_.js";import{m as P}from"./index-CuiZzZwv.js";const c=new BroadcastChannel("omnecor_brain_map_store"),i=P((n,r)=>({nodes:[],edges:[],projectId:null,windowMode:"embedded",windowPosition:{x:100,y:100},windowSize:{width:800,height:600},setProjectId:e=>{n({projectId:e}),c.postMessage({type:"setProjectId",payload:e})},setNodes:e=>{const t=typeof e=="function"?e(r().nodes):e;n({nodes:t}),c.postMessage({type:"setNodes",payload:t})},setEdges:e=>{const t=typeof e=="function"?e(r().edges):e;n({edges:t}),c.postMessage({type:"setEdges",payload:t})},onNodesChange:e=>{const t=E(e,r().nodes);n({nodes:t}),c.postMessage({type:"setNodes",payload:t})},onEdgesChange:e=>{const t=v(e,r().edges);n({edges:t}),c.postMessage({type:"setEdges",payload:t})},onConnect:e=>{const t=x(e,r().edges);n({edges:t}),c.postMessage({type:"setEdges",payload:t})},setWindowMode:e=>{n({windowMode:e}),c.postMessage({type:"setWindowMode",payload:e})},setWindowPosition:e=>n({windowPosition:e}),setWindowSize:e=>n({windowSize:e})}));c.onmessage=n=>{const{type:r,payload:e}=n.data,t=i.getState();switch(r){case"setProjectId":t.projectId!==e&&i.setState({projectId:e});break;case"setNodes":i.setState({nodes:e});break;case"setEdges":i.setState({edges:e});break;case"setWindowMode":t.windowMode!==e&&i.setState({windowMode:e});break}};function _({onNodeClick:n,onNodeDoubleClick:r,onEdgeClick:e,readOnly:t=!1}){const{nodes:l,edges:h,onNodesChange:f,onEdgesChange:g,onConnect:u}=i();return p.jsxDEV("div",{"data-loc":"client/src/components/neural/NeuralGraphView.tsx:38",className:"w-full h-full relative",children:[p.jsxDEV(V,{"data-loc":"client/src/components/neural/NeuralGraphView.tsx:39",nodes:l,edges:h,onNodesChange:f,onEdgesChange:g,onConnect:u,onNodeClick:(o,s)=>n?.(s.id),onNodeDoubleClick:(o,s)=>r?.(s.id),onEdgeClick:(o,s)=>e?.(s.id),fitView:!0,className:"bg-background/50",children:[p.jsxDEV(M,{"data-loc":"client/src/components/neural/NeuralGraphView.tsx:51",color:"#333",gap:20},void 0,!1,{fileName:"/home/ubuntu/omnecor-permanent/client/src/components/neural/NeuralGraphView.tsx",lineNumber:51,columnNumber:9},this),p.jsxDEV(j,{"data-loc":"client/src/components/neural/NeuralGraphView.tsx:52"},void 0,!1,{fileName:"/home/ubuntu/omnecor-permanent/client/src/components/neural/NeuralGraphView.tsx",lineNumber:52,columnNumber:9},this),p.jsxDEV(k,{"data-loc":"client/src/components/neural/NeuralGraphView.tsx:53",nodeColor:o=>o.data?.type==="project"?"var(--accent-purple)":o.data?.type==="folder"?"var(--bg-elevated)":"var(--bg-secondary)",maskColor:"rgba(0, 0, 0, 0.4)"},void 0,!1,{fileName:"/home/ubuntu/omnecor-permanent/client/src/components/neural/NeuralGraphView.tsx",lineNumber:53,columnNumber:9},this)]},void 0,!0,{fileName:"/home/ubuntu/omnecor-permanent/client/src/components/neural/NeuralGraphView.tsx",lineNumber:39,columnNumber:7},this),p.jsxDEV("style",{"data-loc":"client/src/components/neural/NeuralGraphView.tsx:63",children:`
        .node-pulse { 
          box-shadow: 0 0 20px 5px var(--accent-cyan); 
          border-color: var(--accent-cyan);
          transition: all 0.3s ease; 
        }
        .node-new {
          animation: node-appear 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        @keyframes node-appear {
          from { opacity: 0; transform: scale(0.5); }
          to { opacity: 1; transform: scale(1); }
        }
        .react-flow__node {
          background: var(--bg-secondary);
          color: var(--foreground);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 11px;
          font-weight: 500;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
          transition: border-color 0.18s cubic-bezier(.2,.8,.2,1);
        }
        .react-flow__node:hover {
          border-color: var(--accent-cyan);
        }
        .react-flow__edge-path {
          stroke: var(--border);
          stroke-width: 1.5;
        }
        .react-flow__controls-button {
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border);
          fill: var(--muted-foreground);
        }
        .react-flow__controls-button:hover {
          background: var(--bg-secondary);
        }
      `},void 0,!1,{fileName:"/home/ubuntu/omnecor-permanent/client/src/components/neural/NeuralGraphView.tsx",lineNumber:63,columnNumber:7},this)]},void 0,!0,{fileName:"/home/ubuntu/omnecor-permanent/client/src/components/neural/NeuralGraphView.tsx",lineNumber:38,columnNumber:5},this)}function T(n){const{network:r,projectId:e}=n,t=i(o=>o.setNodes),l=i(o=>o.setEdges),h=i(o=>o.setProjectId),f=w.useMemo(()=>r.nodes.map(o=>({id:o.id,data:{label:o.label,type:o.type,path:o.data.path},position:o.position,className:o.type==="project"?"border-accent border-2":""})),[r.nodes]),g=w.useMemo(()=>r.edges.map(o=>({id:o.id,source:o.source,target:o.target,type:"smoothstep",animated:o.type==="folder-connection"})),[r.edges]);w.useEffect(()=>{h(e||null),t(f),l(g)},[f,g,e,t,l,h]);const{fileEvents:u}=C({projectId:e});return w.useEffect(()=>{if(!e||!u.length)return;const o=u[u.length-1],s=`node-${o.relativePath}`;if(o.eventType==="add"||o.eventType==="addDir"){t(a=>{if(a.some(m=>m.id===s))return a;const b={id:s,data:{label:o.relativePath.split("/").pop()??o.relativePath,type:o.eventType==="addDir"?"folder":"file",path:o.relativePath},position:{x:Math.random()*200-100,y:Math.random()*200-100},className:"node-new"};return[...a,b]});const d=o.relativePath.split("/");if(d.length>1){d.pop();const b=`node-${d.join("/")}`;l(m=>{const N=`edge-${b}-${s}`;return m.some(y=>y.id===N)?m:[...m,{id:N,source:b,target:s,type:"smoothstep",animated:o.eventType==="addDir"}]})}}else o.eventType==="unlink"||o.eventType==="unlinkDir"?(t(d=>d.filter(a=>a.id!==s)),l(d=>d.filter(a=>a.source!==s&&a.target!==s))):o.eventType==="change"&&(t(d=>d.map(a=>a.id===s?{...a,className:"node-pulse"}:a)),setTimeout(()=>{t(d=>d.map(a=>a.id===s?{...a,className:""}:a))},1500))},[u,e,t,l]),p.jsxDEV(_,{"data-loc":"client/src/components/neural/NeuralGraphView.tsx:210",...n},void 0,!1,{fileName:"/home/ubuntu/omnecor-permanent/client/src/components/neural/NeuralGraphView.tsx",lineNumber:210,columnNumber:10},this)}export{_ as B,T as N,i as u};
