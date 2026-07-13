import{r as d,j as e}from"./vendor-react-Dm3MaKgN.js";import{c as u,B as L}from"./index-DBbkzoXV.js";import{B as f}from"./badge-Cn3q3PSX.js";import{H as S}from"./HowToTooltip-BkdnxC_b.js";import{_ as H,$ as T,L as W,a0 as k}from"./vendor-icons-B4q2izsf.js";import"./vendor-data-B9ImIvYV.js";import"./vendor-viz-mX_9Y65Z.js";import"./vendor-radix-DC2vEgJG.js";function F({code:g,onChange:m,onTextHighlight:p}){const[b,x]=d.useState(!0),[r,y]=d.useState(!1),[s,c]=d.useState(null),l=d.useRef(null),v=`
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f172a; color: white; }
    .card { background: #1e293b; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); border: 1px solid #334155; }
    h1 { margin-top: 0; color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Web Preview</h1>
    <p>HTML/CSS/JS will be rendered here.</p>
  </div>
</body>
</html>
  `;d.useEffect(()=>{x(!0);const t=setTimeout(()=>x(!1),300);return()=>clearTimeout(t)},[g]),d.useEffect(()=>{const t=n=>{if(l.current&&n.source!==l.current.contentWindow)return;const{type:o,data:w,html:E,text:C}=n.data;o==="element_selected"?c(w):o==="update_html"?m&&m(E):o==="text_highlighted"&&p&&p(C)};return window.addEventListener("message",t),()=>window.removeEventListener("message",t)},[m,p]);const a=(t,n)=>{!l.current||!l.current.contentWindow||(c(o=>o?{...o,styles:{...o.styles,[t]:n}}:null),l.current.contentWindow.postMessage({type:"apply_style",styleName:t,value:n},"*"))},j=t=>{!l.current||!l.current.contentWindow||(c(n=>n?{...n,textContent:t}:null),l.current.contentWindow.postMessage({type:"apply_text",value:t},"*"))},N=t=>{!l.current||!l.current.contentWindow||l.current.contentWindow.postMessage({type:"apply_style",styleName:"src",value:t},"*")},h=`
<script>
(function() {
  let selectedElement = null;

  // Add CSS for hover outline and selected outline
  const style = document.createElement('style');
  style.innerHTML = \`
    .manus-hovered {
      outline: 2px dashed #38bdf8 !important;
      outline-offset: -2px !important;
      cursor: pointer !important;
    }
    .manus-selected {
      outline: 2px solid #38bdf8 !important;
      outline-offset: -2px !important;
    }
  \`;
  document.head.appendChild(style);

  document.addEventListener('mouseover', function(e) {
    if (e.target.classList.contains('manus-selected')) return;
    e.target.classList.add('manus-hovered');
    e.stopPropagation();
  });

  document.addEventListener('mouseout', function(e) {
    e.target.classList.remove('manus-hovered');
    e.stopPropagation();
  });

  document.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (selectedElement) {
      selectedElement.classList.remove('manus-selected');
    }
    
    selectedElement = e.target;
    selectedElement.classList.add('manus-selected');

    // Make text elements editable inline
    if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'SPAN', 'A', 'BUTTON', 'LABEL'].includes(selectedElement.tagName)) {
      selectedElement.contentEditable = 'true';
      selectedElement.focus();
      
      selectedElement.addEventListener('blur', function() {
        selectedElement.contentEditable = 'false';
        sendHtmlUpdate();
      }, { once: true });
    }

    // Get current styles of the selected element
    const computed = window.getComputedStyle(selectedElement);
    const elementData = {
      tagName: selectedElement.tagName,
      id: selectedElement.id,
      className: selectedElement.className.replace('manus-selected', '').replace('manus-hovered', '').trim(),
      textContent: selectedElement.textContent,
      styles: {
        color: rgbToHex(computed.color),
        backgroundColor: rgbToHex(computed.backgroundColor),
        borderColor: rgbToHex(computed.borderColor),
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        fontFamily: computed.fontFamily,
        padding: computed.padding,
        margin: computed.margin,
        borderRadius: computed.borderRadius,
        width: computed.width,
        height: computed.height
      }
    };

    window.parent.postMessage({ type: 'element_selected', data: elementData }, '*');
  });

  // Drag and resize functionality
  let isDragging = false;
  let isResizing = false;
  let startX, startY, startWidth, startHeight, startLeft, startTop;
  
  document.addEventListener('mousedown', function(e) {
    if (!selectedElement || !selectedElement.classList.contains('manus-selected')) return;
    
    const rect = selectedElement.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    
    if (offsetX > rect.width - 15 && offsetY > rect.height - 15) {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = rect.width;
      startHeight = rect.height;
      e.preventDefault();
    } else {
      if (selectedElement.contentEditable === 'true') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const style = window.getComputedStyle(selectedElement);
      startLeft = parseFloat(style.left) || 0;
      startTop = parseFloat(style.top) || 0;
      if (style.position === 'static') {
        selectedElement.style.position = 'relative';
      }
      e.preventDefault();
    }
  });
  
  document.addEventListener('mousemove', function(e) {
    if (isResizing && selectedElement) {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      selectedElement.style.width = (startWidth + deltaX) + 'px';
      selectedElement.style.height = (startHeight + deltaY) + 'px';
      sendHtmlUpdate();
    } else if (isDragging && selectedElement) {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      selectedElement.style.left = (startLeft + deltaX) + 'px';
      selectedElement.style.top = (startTop + deltaY) + 'px';
      sendHtmlUpdate();
    }
  });
  
  document.addEventListener('mouseup', function() {
    if (isDragging || isResizing) {
      isDragging = false;
      isResizing = false;
      sendHtmlUpdate();
    }
  });

  // Selection change listener for text highlights
  document.addEventListener('selectionchange', function() {
    const selectedText = window.getSelection().toString();
    window.parent.postMessage({ type: 'text_highlighted', text: selectedText }, '*');
  });

  // Listen for style updates from parent
  window.addEventListener('message', function(event) {
    if (event.data.type === 'apply_style' && selectedElement) {
      const { styleName, value } = event.data;
      if (styleName === 'src' || styleName === 'href') {
        selectedElement[styleName] = value;
      } else {
        selectedElement.style[styleName] = value;
      }
      sendHtmlUpdate();
    }
    if (event.data.type === 'apply_text' && selectedElement) {
      selectedElement.textContent = event.data.value;
      sendHtmlUpdate();
    }
  });

  function sendHtmlUpdate() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('.manus-hovered').forEach(el => el.classList.remove('manus-hovered'));
    clone.querySelectorAll('.manus-selected').forEach(el => el.classList.remove('manus-selected'));
    clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
    window.parent.postMessage({ type: 'update_html', html: clone.outerHTML }, '*');
  }

  function rgbToHex(rgb) {
    if (!rgb || rgb === 'rgba(0, 0, 0, 0)' || rgb === 'transparent') return '';
    const match = rgb.match(/^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*(\\d+))?\\)$/);
    if (!match) return rgb;
    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
})();
<\/script>
`;let i=g||v;return r&&(i.includes("</body>")?i=i.replace("</body>",`${h}</body>`):i=i+h),e.jsxs("div",{className:"w-full h-full flex flex-col bg-slate-900 rounded-md overflow-hidden relative border border-slate-800",children:[e.jsxs("div",{className:"flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800 text-xs flex-shrink-0",children:[e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx("span",{className:"font-semibold text-slate-300",children:"Live Web Preview"}),e.jsx(f,{variant:"outline",className:u("text-[9px] py-0",r?"border-primary/30 text-primary bg-primary/10":"border-slate-700 text-slate-400"),children:r?"Interactive Visual Builder":"Standard Preview"})]}),e.jsxs("div",{className:"flex items-center gap-2",children:[r&&e.jsx("span",{className:"text-[10px] text-slate-500 animate-pulse font-mono mr-2",children:"💡 Tip: Click elements to inspect/edit or drag to resize/move"}),e.jsx(S,{title:"Toggle Edit Mode",description:"Switch between standard preview and interactive visual builder",side:"bottom",children:e.jsx(L,{size:"sm",variant:r?"default":"outline",className:u("h-7 text-[10px] px-2.5 flex items-center gap-1",r?"bg-primary/10 hover:bg-primary/90 text-white border-none":"border-slate-800 hover:bg-slate-800 text-slate-300"),onClick:()=>{y(!r),c(null)},children:r?e.jsxs(e.Fragment,{children:[e.jsx(H,{className:"w-3.5 h-3.5"})," Preview Mode"]}):e.jsxs(e.Fragment,{children:[e.jsx(T,{className:"w-3.5 h-3.5 text-primary"})," Visual Edit Mode"]})})})]})]}),e.jsxs("div",{className:"flex-1 flex overflow-hidden",children:[e.jsxs("div",{className:u("h-full relative transition-all duration-300 bg-white",r&&s?"w-[70%]":"w-full"),children:[b&&e.jsxs("div",{className:"absolute inset-0 bg-slate-900 flex flex-col items-center justify-center text-white/50 z-10",children:[e.jsx(W,{className:"w-8 h-8 animate-spin mb-2 text-primary"}),e.jsx("p",{className:"text-sm",children:"Rendering Preview..."})]}),e.jsx("iframe",{ref:l,title:"Web Preview",sandbox:"allow-scripts allow-modals allow-same-origin",srcDoc:i,className:"w-full h-full border-none bg-white",onLoad:()=>x(!1)})]}),r&&s&&e.jsxs("div",{className:"w-[30%] h-full bg-slate-900 border-l border-slate-800 flex flex-col overflow-y-auto p-4 select-text",children:[e.jsxs("div",{className:"flex items-center justify-between mb-4 pb-2 border-b border-slate-800 flex-shrink-0",children:[e.jsxs("div",{className:"flex items-center gap-1.5",children:[e.jsx(k,{className:"w-4 h-4 text-primary"}),e.jsx("span",{className:"text-xs font-semibold text-slate-100 uppercase tracking-wide",children:"Style Inspector"})]}),e.jsx(f,{variant:"secondary",className:"bg-slate-800 text-slate-400 font-mono text-[9px] border border-slate-700",children:s.tagName.toLowerCase()})]}),e.jsxs("div",{className:"space-y-4 text-xs",children:[e.jsxs("div",{className:"space-y-2",children:[e.jsx("span",{className:"text-[10px] text-slate-500 font-bold uppercase tracking-wider",children:"Content & Assets"}),!["IMG","DIV","SECTION","BODY"].includes(s.tagName)&&e.jsxs("div",{className:"space-y-1",children:[e.jsx("label",{className:"text-slate-400 text-[10px]",children:"Text Content"}),e.jsx("textarea",{rows:2,className:"w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded p-1.5 outline-none focus:border-primary/30 resize-none font-mono",value:s.textContent,onChange:t=>j(t.target.value)})]}),s.tagName==="IMG"&&e.jsxs("div",{className:"space-y-1",children:[e.jsx("label",{className:"text-slate-400 text-[10px]",children:"Image URL"}),e.jsx("input",{type:"text",className:"w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono",placeholder:"Paste image url...",onChange:t=>N(t.target.value)})]})]}),e.jsxs("div",{className:"space-y-2 pt-2 border-t border-slate-800/60",children:[e.jsx("span",{className:"text-[10px] text-slate-500 font-bold uppercase tracking-wider",children:"Colors & Background"}),e.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[e.jsxs("div",{className:"space-y-1",children:[e.jsx("label",{className:"text-slate-400 text-[10px]",children:"Text Color"}),e.jsxs("div",{className:"flex gap-1.5 items-center",children:[e.jsx("input",{type:"color",className:"w-6 h-6 rounded border border-slate-800 bg-transparent cursor-pointer",value:s.styles.color.startsWith("#")?s.styles.color:"#ffffff",onChange:t=>a("color",t.target.value)}),e.jsx("span",{className:"text-[10px] text-slate-400 font-mono",children:s.styles.color})]})]}),e.jsxs("div",{className:"space-y-1",children:[e.jsx("label",{className:"text-slate-400 text-[10px]",children:"Background"}),e.jsxs("div",{className:"flex gap-1.5 items-center",children:[e.jsx("input",{type:"color",className:"w-6 h-6 rounded border border-slate-800 bg-transparent cursor-pointer",value:s.styles.backgroundColor.startsWith("#")?s.styles.backgroundColor:"#000000",onChange:t=>a("backgroundColor",t.target.value)}),e.jsx("span",{className:"text-[10px] text-slate-400 font-mono",children:s.styles.backgroundColor})]})]})]})]}),e.jsxs("div",{className:"space-y-2 pt-2 border-t border-slate-800/60",children:[e.jsx("span",{className:"text-[10px] text-slate-500 font-bold uppercase tracking-wider",children:"Typography"}),e.jsxs("div",{className:"space-y-1.5",children:[e.jsxs("div",{className:"flex justify-between text-[10px] text-slate-400",children:[e.jsx("label",{children:"Font Size"}),e.jsx("span",{className:"font-mono text-slate-300",children:s.styles.fontSize})]}),e.jsx("input",{type:"text",className:"w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono",value:s.styles.fontSize,onChange:t=>a("fontSize",t.target.value)})]}),e.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[e.jsxs("div",{className:"space-y-1",children:[e.jsx("label",{className:"text-slate-400 text-[10px]",children:"Font Weight"}),e.jsxs("select",{className:"w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30",value:s.styles.fontWeight,onChange:t=>a("fontWeight",t.target.value),children:[e.jsx("option",{value:"normal",children:"normal"}),e.jsx("option",{value:"bold",children:"bold"}),e.jsx("option",{value:"100",children:"100"}),e.jsx("option",{value:"300",children:"300"}),e.jsx("option",{value:"400",children:"400"}),e.jsx("option",{value:"500",children:"500"}),e.jsx("option",{value:"700",children:"700"}),e.jsx("option",{value:"900",children:"900"})]})]}),e.jsxs("div",{className:"space-y-1",children:[e.jsx("label",{className:"text-slate-400 text-[10px]",children:"Font Family"}),e.jsxs("select",{className:"w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30",value:s.styles.fontFamily.split(",")[0].replace(/['"]/g,""),onChange:t=>a("fontFamily",t.target.value),children:[e.jsx("option",{value:"system-ui",children:"system-ui"}),e.jsx("option",{value:"sans-serif",children:"sans-serif"}),e.jsx("option",{value:"serif",children:"serif"}),e.jsx("option",{value:"monospace",children:"monospace"}),e.jsx("option",{value:"Georgia",children:"Georgia"})]})]})]})]}),e.jsxs("div",{className:"space-y-2 pt-2 border-t border-slate-800/60",children:[e.jsx("span",{className:"text-[10px] text-slate-500 font-bold uppercase tracking-wider",children:"Spacing & Borders"}),e.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[e.jsxs("div",{className:"space-y-1",children:[e.jsx("label",{className:"text-slate-400 text-[10px]",children:"Padding"}),e.jsx("input",{type:"text",className:"w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono",value:s.styles.padding,onChange:t=>a("padding",t.target.value)})]}),e.jsxs("div",{className:"space-y-1",children:[e.jsx("label",{className:"text-slate-400 text-[10px]",children:"Margin"}),e.jsx("input",{type:"text",className:"w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono",value:s.styles.margin,onChange:t=>a("margin",t.target.value)})]})]}),e.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[e.jsxs("div",{className:"space-y-1",children:[e.jsx("label",{className:"text-slate-400 text-[10px]",children:"Border Radius"}),e.jsx("input",{type:"text",className:"w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono",value:s.styles.borderRadius,onChange:t=>a("borderRadius",t.target.value)})]}),e.jsxs("div",{className:"space-y-1",children:[e.jsx("label",{className:"text-slate-400 text-[10px]",children:"Border Color"}),e.jsxs("div",{className:"flex gap-1 items-center",children:[e.jsx("input",{type:"color",className:"w-6 h-6 rounded border border-slate-800 bg-transparent cursor-pointer",value:s.styles.borderColor.startsWith("#")?s.styles.borderColor:"#000000",onChange:t=>a("borderColor",t.target.value)}),e.jsx("span",{className:"text-[9px] text-slate-400 font-mono truncate",children:s.styles.borderColor})]})]})]})]}),e.jsxs("div",{className:"space-y-2 pt-2 border-t border-slate-800/60 pb-6",children:[e.jsx("span",{className:"text-[10px] text-slate-500 font-bold uppercase tracking-wider",children:"Layout Dimensions"}),e.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[e.jsxs("div",{className:"space-y-1",children:[e.jsx("label",{className:"text-slate-400 text-[10px]",children:"Width"}),e.jsx("input",{type:"text",className:"w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono",value:s.styles.width,onChange:t=>a("width",t.target.value)})]}),e.jsxs("div",{className:"space-y-1",children:[e.jsx("label",{className:"text-slate-400 text-[10px]",children:"Height"}),e.jsx("input",{type:"text",className:"w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono",value:s.styles.height,onChange:t=>a("height",t.target.value)})]})]})]})]})]})]})]})}export{F as WebPreview};
