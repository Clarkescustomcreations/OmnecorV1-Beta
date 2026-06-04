import{f as p,r as b}from"./vendor-react-Bhh30CDp.js";import{f as x,g as v,h as V,R as M,B as k,C as E,M as C}from"./vendor-charts-CP5RxuOL.js";import{u as j}from"./useOmnecorSocket-CgEKkpQo.js";import{l as D}from"./index-BUDzoAT9.js";const c=new BroadcastChannel("omnecor_brain_map_store"),d=D((a,r)=>({nodes:[],edges:[],projectId:null,windowMode:"embedded",windowPosition:{x:100,y:100},windowSize:{width:800,height:600},setProjectId:e=>{a({projectId:e}),c.postMessage({type:"setProjectId",payload:e})},setNodes:e=>{const t=typeof e=="function"?e(r().nodes):e;a({nodes:t}),c.postMessage({type:"setNodes",payload:t})},setEdges:e=>{const t=typeof e=="function"?e(r().edges):e;a({edges:t}),c.postMessage({type:"setEdges",payload:t})},onNodesChange:e=>{const t=V(e,r().nodes);a({nodes:t}),c.postMessage({type:"setNodes",payload:t})},onEdgesChange:e=>{const t=v(e,r().edges);a({edges:t}),c.postMessage({type:"setEdges",payload:t})},onConnect:e=>{const t=x(e,r().edges);a({edges:t}),c.postMessage({type:"setEdges",payload:t})},setWindowMode:e=>{a({windowMode:e}),c.postMessage({type:"setWindowMode",payload:e})},setWindowPosition:e=>a({windowPosition:e}),setWindowSize:e=>a({windowSize:e})}));c.onmessage=a=>{const{type:r,payload:e}=a.data,t=d.getState();switch(r){case"setProjectId":t.projectId!==e&&d.setState({projectId:e});break;case"setNodes":d.setState({nodes:e});break;case"setEdges":d.setState({edges:e});break;case"setWindowMode":t.windowMode!==e&&d.setState({windowMode:e});break}};function I({onNodeClick:a,onNodeDoubleClick:r,onEdgeClick:e,readOnly:t=!1}){const{nodes:l,edges:h,onNodesChange:f,onEdgesChange:g,onConnect:m}=d();return p.jsxDEV("div",{className:"w-full h-full relative",children:[p.jsxDEV(M,{nodes:l,edges:h,onNodesChange:f,onEdgesChange:g,onConnect:m,onNodeClick:(o,n)=>a?.(n.id),onNodeDoubleClick:(o,n)=>r?.(n.id),onEdgeClick:(o,n)=>e?.(n.id),fitView:!0,className:"bg-background/50",children:[p.jsxDEV(k,{color:"#333",gap:20},void 0,!1,{fileName:"/home/linux/Documents/Omnecor (AltV1)/Omnecor-HMCI-ai-workstation-AltV1/client/src/components/neural/NeuralGraphView.tsx",lineNumber:51,columnNumber:9},this),p.jsxDEV(E,{},void 0,!1,{fileName:"/home/linux/Documents/Omnecor (AltV1)/Omnecor-HMCI-ai-workstation-AltV1/client/src/components/neural/NeuralGraphView.tsx",lineNumber:52,columnNumber:9},this),p.jsxDEV(C,{nodeColor:o=>o.data?.type==="project"?"var(--accent-purple)":o.data?.type==="folder"?"var(--bg-elevated)":"var(--bg-secondary)",maskColor:"rgba(0, 0, 0, 0.4)"},void 0,!1,{fileName:"/home/linux/Documents/Omnecor (AltV1)/Omnecor-HMCI-ai-workstation-AltV1/client/src/components/neural/NeuralGraphView.tsx",lineNumber:53,columnNumber:9},this)]},void 0,!0,{fileName:"/home/linux/Documents/Omnecor (AltV1)/Omnecor-HMCI-ai-workstation-AltV1/client/src/components/neural/NeuralGraphView.tsx",lineNumber:39,columnNumber:7},this),p.jsxDEV("style",{children:`
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
      `},void 0,!1,{fileName:"/home/linux/Documents/Omnecor (AltV1)/Omnecor-HMCI-ai-workstation-AltV1/client/src/components/neural/NeuralGraphView.tsx",lineNumber:63,columnNumber:7},this)]},void 0,!0,{fileName:"/home/linux/Documents/Omnecor (AltV1)/Omnecor-HMCI-ai-workstation-AltV1/client/src/components/neural/NeuralGraphView.tsx",lineNumber:38,columnNumber:5},this)}function S(a){const{network:r,projectId:e}=a,t=d(o=>o.setNodes),l=d(o=>o.setEdges),h=d(o=>o.setProjectId),f=b.useMemo(()=>r.nodes.map(o=>({id:o.id,data:{label:o.label,type:o.type,path:o.data.path},position:o.position,className:o.type==="project"?"border-accent border-2":""})),[r.nodes]),g=b.useMemo(()=>r.edges.map(o=>({id:o.id,source:o.source,target:o.target,type:"smoothstep",animated:o.type==="folder-connection"})),[r.edges]);b.useEffect(()=>{h(e||null),t(f),l(g)},[f,g,e,t,l,h]);const{fileEvents:m}=j({projectId:e});return b.useEffect(()=>{if(!e||!m.length)return;const o=m[m.length-1],n=`node-${o.relativePath}`;if(o.eventType==="add"||o.eventType==="addDir"){t(s=>{if(s.some(u=>u.id===n))return s;const w={id:n,data:{label:o.relativePath.split("/").pop()??o.relativePath,type:o.eventType==="addDir"?"folder":"file",path:o.relativePath},position:{x:Math.random()*200-100,y:Math.random()*200-100},className:"node-new"};return[...s,w]});const i=o.relativePath.split("/");if(i.length>1){i.pop();const w=`node-${i.join("/")}`;l(u=>{const y=`edge-${w}-${n}`;return u.some(N=>N.id===y)?u:[...u,{id:y,source:w,target:n,type:"smoothstep",animated:o.eventType==="addDir"}]})}}else o.eventType==="unlink"||o.eventType==="unlinkDir"?(t(i=>i.filter(s=>s.id!==n)),l(i=>i.filter(s=>s.source!==n&&s.target!==n))):o.eventType==="change"&&(t(i=>i.map(s=>s.id===n?{...s,className:"node-pulse"}:s)),setTimeout(()=>{t(i=>i.map(s=>s.id===n?{...s,className:""}:s))},1500))},[m,e,t,l]),p.jsxDEV(I,{...a},void 0,!1,{fileName:"/home/linux/Documents/Omnecor (AltV1)/Omnecor-HMCI-ai-workstation-AltV1/client/src/components/neural/NeuralGraphView.tsx",lineNumber:210,columnNumber:10},this)}export{I as B,S as N,d as u};
