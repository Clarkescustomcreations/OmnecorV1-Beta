import{j as l,r as m}from"./vendor-react-DDY8KKj3.js";import{f as x,g as M,h as j,R as k,B as E,C as N,M as C}from"./vendor-charts-DVjstmlw.js";import{u as P}from"./useOmnecorSocket-CINeP01A.js";import{m as _}from"./index-BaxnHJw0.js";const c=new BroadcastChannel("omnecor_brain_map_store"),i=_((a,d)=>({nodes:[],edges:[],projectId:null,windowMode:"embedded",windowPosition:{x:100,y:100},windowSize:{width:800,height:600},setProjectId:e=>{a({projectId:e}),c.postMessage({type:"setProjectId",payload:e})},setNodes:e=>{const t=typeof e=="function"?e(d().nodes):e;a({nodes:t}),c.postMessage({type:"setNodes",payload:t})},setEdges:e=>{const t=typeof e=="function"?e(d().edges):e;a({edges:t}),c.postMessage({type:"setEdges",payload:t})},onNodesChange:e=>{const t=j(e,d().nodes);a({nodes:t}),c.postMessage({type:"setNodes",payload:t})},onEdgesChange:e=>{const t=M(e,d().edges);a({edges:t}),c.postMessage({type:"setEdges",payload:t})},onConnect:e=>{const t=x(e,d().edges);a({edges:t}),c.postMessage({type:"setEdges",payload:t})},setWindowMode:e=>{a({windowMode:e}),c.postMessage({type:"setWindowMode",payload:e})},setWindowPosition:e=>a({windowPosition:e}),setWindowSize:e=>a({windowSize:e})}));c.onmessage=a=>{const{type:d,payload:e}=a.data,t=i.getState();switch(d){case"setProjectId":t.projectId!==e&&i.setState({projectId:e});break;case"setNodes":i.setState({nodes:e});break;case"setEdges":i.setState({edges:e});break;case"setWindowMode":t.windowMode!==e&&i.setState({windowMode:e});break}};function I({onNodeClick:a,onNodeDoubleClick:d,onEdgeClick:e,readOnly:t=!1}){const{nodes:p,edges:y,onNodesChange:u,onEdgesChange:h,onConnect:g}=i();return l.jsxs("div",{className:"w-full h-full relative",children:[l.jsxs(k,{nodes:p,edges:y,onNodesChange:u,onEdgesChange:h,onConnect:g,onNodeClick:(o,n)=>a?.(n.id),onNodeDoubleClick:(o,n)=>d?.(n.id),onEdgeClick:(o,n)=>e?.(n.id),fitView:!0,className:"bg-background/50",children:[l.jsx(E,{color:"#333",gap:20}),l.jsx(N,{}),l.jsx(C,{nodeColor:o=>o.data?.type==="project"?"var(--accent-purple)":o.data?.type==="folder"?"var(--bg-elevated)":"var(--bg-secondary)",maskColor:"rgba(0, 0, 0, 0.4)"})]}),l.jsx("style",{children:`
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
      `})]})}function B(a){const{network:d,projectId:e}=a,t=i(o=>o.setNodes),p=i(o=>o.setEdges),y=i(o=>o.setProjectId),u=m.useMemo(()=>d.nodes.map(o=>({id:o.id,data:{label:o.label,type:o.type,path:o.data.path},position:o.position,className:o.type==="project"?"border-accent border-2":""})),[d.nodes]),h=m.useMemo(()=>d.edges.map(o=>({id:o.id,source:o.source,target:o.target,type:"smoothstep",animated:o.type==="folder-connection"})),[d.edges]);m.useEffect(()=>{y(e||null),t(u),p(h)},[u,h,e,t,p,y]);const{fileEvents:g}=P({projectId:e});return m.useEffect(()=>{if(!e||!g.length)return;const o=g[g.length-1],n=`node-${o.relativePath}`;if(o.eventType==="add"||o.eventType==="addDir"){t(s=>{if(s.some(f=>f.id===n))return s;const w={id:n,data:{label:o.relativePath.split("/").pop()??o.relativePath,type:o.eventType==="addDir"?"folder":"file",path:o.relativePath},position:{x:Math.random()*200-100,y:Math.random()*200-100},className:"node-new"};return[...s,w]});const r=o.relativePath.split("/");if(r.length>1){r.pop();const w=`node-${r.join("/")}`;p(f=>{const b=`edge-${w}-${n}`;return f.some(v=>v.id===b)?f:[...f,{id:b,source:w,target:n,type:"smoothstep",animated:o.eventType==="addDir"}]})}}else o.eventType==="unlink"||o.eventType==="unlinkDir"?(t(r=>r.filter(s=>s.id!==n)),p(r=>r.filter(s=>s.source!==n&&s.target!==n))):o.eventType==="change"&&(t(r=>r.map(s=>s.id===n?{...s,className:"node-pulse"}:s)),setTimeout(()=>{t(r=>r.map(s=>s.id===n?{...s,className:""}:s))},1500))},[g,e,t,p]),l.jsx(I,{...a})}export{I as B,B as N,i as u};
