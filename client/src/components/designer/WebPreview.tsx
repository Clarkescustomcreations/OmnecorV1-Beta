import React, { useEffect, useRef, useState } from "react";
import { Loader2, Eye, Edit3, Sliders, Type, Image, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { HowToTooltip } from "@/components/shell/HowToTooltip";

interface ElementData {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  styles: {
    color: string;
    backgroundColor: string;
    borderColor: string;
    fontSize: string;
    fontWeight: string;
    fontFamily: string;
    padding: string;
    margin: string;
    borderRadius: string;
    width: string;
    height: string;
  };
}

interface WebPreviewProps {
  code?: string;
  onChange?: (newCode: string) => void;
  onTextHighlight?: (text: string) => void;
}

export function WebPreview({ code, onChange, onTextHighlight }: WebPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementData | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const defaultCode = `
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
  `;

  useEffect(() => {
    setLoading(true);
    const timeout = setTimeout(() => setLoading(false), 300); // Simulate processing
    return () => clearTimeout(timeout);
  }, [code]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
      
      const { type, data, html, text } = event.data;
      if (type === 'element_selected') {
        setSelectedElement(data);
      } else if (type === 'update_html') {
        if (onChange) onChange(html);
      } else if (type === 'text_highlighted') {
        if (onTextHighlight) onTextHighlight(text);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onChange, onTextHighlight]);

  const applyStyle = (styleName: string, value: string) => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) return;
    
    // Update local state first to make UI responsive
    setSelectedElement(prev => {
      if (!prev) return null;
      return {
        ...prev,
        styles: {
          ...prev.styles,
          [styleName]: value
        }
      };
    });

    iframeRef.current.contentWindow.postMessage({
      type: 'apply_style',
      styleName,
      value
    }, '*');
  };

  const applyText = (value: string) => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) return;

    setSelectedElement(prev => {
      if (!prev) return null;
      return {
        ...prev,
        textContent: value
      };
    });

    iframeRef.current.contentWindow.postMessage({
      type: 'apply_text',
      value
    }, '*');
  };

  const applyImageSrc = (value: string) => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) return;

    iframeRef.current.contentWindow.postMessage({
      type: 'apply_style',
      styleName: 'src',
      value
    }, '*');
  };

  const editorScript = `
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
</script>
`;

  let srcDoc = code || defaultCode;
  if (editMode) {
    if (srcDoc.includes("</body>")) {
      srcDoc = srcDoc.replace("</body>", `${editorScript}</body>`);
    } else {
      srcDoc = srcDoc + editorScript;
    }
  }

  return (
    <div className="w-full h-full flex flex-col bg-slate-900 rounded-md overflow-hidden relative border border-slate-800">
      {/* Header toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800 text-xs flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-300">Live Web Preview</span>
          <Badge variant="outline" className={cn(
            "text-[9px] py-0",
            editMode ? "border-primary/30 text-primary bg-primary/10" : "border-slate-700 text-slate-400"
          )}>
            {editMode ? "Interactive Visual Builder" : "Standard Preview"}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {editMode && (
            <span className="text-[10px] text-slate-500 animate-pulse font-mono mr-2">
              💡 Tip: Click elements to inspect/edit or drag to resize/move
            </span>
          )}
          <HowToTooltip title="Toggle Edit Mode" description="Switch between standard preview and interactive visual builder" side="bottom">
            <Button
              size="sm"
              variant={editMode ? "default" : "outline"}
              className={cn(
                "h-7 text-[10px] px-2.5 flex items-center gap-1",
                editMode 
                  ? "bg-primary/10 hover:bg-primary/90 text-white border-none" 
                  : "border-slate-800 hover:bg-slate-800 text-slate-300"
              )}
              onClick={() => {
                setEditMode(!editMode);
                setSelectedElement(null);
              }}
            >
              {editMode ? (
                <>
                  <Eye className="w-3.5 h-3.5" /> Preview Mode
                </>
              ) : (
                <>
                  <Edit3 className="w-3.5 h-3.5 text-primary" /> Visual Edit Mode
                </>
              )}
            </Button>
          </HowToTooltip>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Iframe Preview Container */}
        <div className={cn(
          "h-full relative transition-all duration-300 bg-white",
          editMode && selectedElement ? "w-[70%]" : "w-full"
        )}>
          {loading && (
            <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center text-white/50 z-10">
              <Loader2 className="w-8 h-8 animate-spin mb-2 text-primary" />
              <p className="text-sm">Rendering Preview...</p>
            </div>
          )}
          <iframe
            ref={iframeRef}
            title="Web Preview"
            sandbox="allow-scripts allow-modals allow-same-origin"
            srcDoc={srcDoc}
            className="w-full h-full border-none bg-white"
            onLoad={() => setLoading(false)}
          />
        </div>

        {/* Style Inspector Side Panel */}
        {editMode && selectedElement && (
          <div className="w-[30%] h-full bg-slate-900 border-l border-slate-800 flex flex-col overflow-y-auto p-4 select-text">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold text-slate-100 uppercase tracking-wide">
                  Style Inspector
                </span>
              </div>
              <Badge variant="secondary" className="bg-slate-800 text-slate-400 font-mono text-[9px] border border-slate-700">
                {selectedElement.tagName.toLowerCase()}
              </Badge>
            </div>

            <div className="space-y-4 text-xs">
              
              {/* Properties Section */}
              <div className="space-y-2">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Content & Assets</span>
                
                {/* Text editor (conditionally shown for text elements) */}
                {!["IMG", "DIV", "SECTION", "BODY"].includes(selectedElement.tagName) && (
                  <div className="space-y-1">
                    <label className="text-slate-400 text-[10px]">Text Content</label>
                    <textarea
                      rows={2}
                      className="w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded p-1.5 outline-none focus:border-primary/30 resize-none font-mono"
                      value={selectedElement.textContent}
                      onChange={(e) => applyText(e.target.value)}
                    />
                  </div>
                )}

                {/* Image source (conditionally shown for IMG elements) */}
                {selectedElement.tagName === "IMG" && (
                  <div className="space-y-1">
                    <label className="text-slate-400 text-[10px]">Image URL</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono"
                      placeholder="Paste image url..."
                      onChange={(e) => applyImageSrc(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Colors & Background */}
              <div className="space-y-2 pt-2 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Colors & Background</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-slate-400 text-[10px]">Text Color</label>
                    <div className="flex gap-1.5 items-center">
                      <input
                        type="color"
                        className="w-6 h-6 rounded border border-slate-800 bg-transparent cursor-pointer"
                        value={selectedElement.styles.color.startsWith("#") ? selectedElement.styles.color : "#ffffff"}
                        onChange={(e) => applyStyle("color", e.target.value)}
                      />
                      <span className="text-[10px] text-slate-400 font-mono">{selectedElement.styles.color}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400 text-[10px]">Background</label>
                    <div className="flex gap-1.5 items-center">
                      <input
                        type="color"
                        className="w-6 h-6 rounded border border-slate-800 bg-transparent cursor-pointer"
                        value={selectedElement.styles.backgroundColor.startsWith("#") ? selectedElement.styles.backgroundColor : "#000000"}
                        onChange={(e) => applyStyle("backgroundColor", e.target.value)}
                      />
                      <span className="text-[10px] text-slate-400 font-mono">{selectedElement.styles.backgroundColor}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Typography */}
              <div className="space-y-2 pt-2 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Typography</span>
                
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <label>Font Size</label>
                    <span className="font-mono text-slate-300">{selectedElement.styles.fontSize}</span>
                  </div>
                  <input
                    type="text"
                    className="w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono"
                    value={selectedElement.styles.fontSize}
                    onChange={(e) => applyStyle("fontSize", e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-slate-400 text-[10px]">Font Weight</label>
                    <select
                      className="w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30"
                      value={selectedElement.styles.fontWeight}
                      onChange={(e) => applyStyle("fontWeight", e.target.value)}
                    >
                      <option value="normal">normal</option>
                      <option value="bold">bold</option>
                      <option value="100">100</option>
                      <option value="300">300</option>
                      <option value="400">400</option>
                      <option value="500">500</option>
                      <option value="700">700</option>
                      <option value="900">900</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400 text-[10px]">Font Family</label>
                    <select
                      className="w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30"
                      value={selectedElement.styles.fontFamily.split(",")[0].replace(/['"]/g, "")}
                      onChange={(e) => applyStyle("fontFamily", e.target.value)}
                    >
                      <option value="system-ui">system-ui</option>
                      <option value="sans-serif">sans-serif</option>
                      <option value="serif">serif</option>
                      <option value="monospace">monospace</option>
                      <option value="Georgia">Georgia</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Spacing & Borders */}
              <div className="space-y-2 pt-2 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Spacing & Borders</span>
                
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-slate-400 text-[10px]">Padding</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono"
                      value={selectedElement.styles.padding}
                      onChange={(e) => applyStyle("padding", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400 text-[10px]">Margin</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono"
                      value={selectedElement.styles.margin}
                      onChange={(e) => applyStyle("margin", e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-slate-400 text-[10px]">Border Radius</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono"
                      value={selectedElement.styles.borderRadius}
                      onChange={(e) => applyStyle("borderRadius", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400 text-[10px]">Border Color</label>
                    <div className="flex gap-1 items-center">
                      <input
                        type="color"
                        className="w-6 h-6 rounded border border-slate-800 bg-transparent cursor-pointer"
                        value={selectedElement.styles.borderColor.startsWith("#") ? selectedElement.styles.borderColor : "#000000"}
                        onChange={(e) => applyStyle("borderColor", e.target.value)}
                      />
                      <span className="text-[9px] text-slate-400 font-mono truncate">{selectedElement.styles.borderColor}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Layout Dimensions */}
              <div className="space-y-2 pt-2 border-t border-slate-800/60 pb-6">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Layout Dimensions</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-slate-400 text-[10px]">Width</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono"
                      value={selectedElement.styles.width}
                      onChange={(e) => applyStyle("width", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400 text-[10px]">Height</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 text-[11px] text-slate-100 rounded px-2 py-1 outline-none focus:border-primary/30 font-mono"
                      value={selectedElement.styles.height}
                      onChange={(e) => applyStyle("height", e.target.value)}
                    />
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
