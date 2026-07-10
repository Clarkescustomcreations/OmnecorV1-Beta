/**
 * 3D Viewer / Multi-Modal Designer (mobile)
 *
 * Mirrors the desktop 3D Designer (client/src/pages/3DDesigner.tsx) on the phone
 * with REAL desktop endpoints — no mock state:
 *
 *  • 3D View      — three.js scene in a WebView (orbit + tap-to-select). Ask-AI
 *                   about the selected object via `ai.chat`.
 *  • Schematic/PCB — loads real designs from `pcbEditor.getProjects` +
 *                   `pcbEditor.getLatestDesign` and renders the React-Flow
 *                   nodes/edges with react-native-svg. Analyze →
 *                   `pcbEditor.reviewDesign`, Modify → `pcbEditor.saveDesign`,
 *                   Export → `pcbEditor.exportDesign`.
 *  • Code          — browses real projects (`project.list` / `getFileTree`),
 *                   opens files (`project.readFile`), edits + saves
 *                   (`project.writeFile`). Analyze/Ask-AI via `ai.chat`.
 *
 * The restored interactive panel (Ask AI · Analyze · Modify · Export) sits in a
 * single action bar and dispatches to the right real endpoint per mode.
 */
import { ScrollView, Text, View, TextInput, ActivityIndicator } from "react-native";
import { Pressable } from "@/components/pressable";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WebView } from "react-native-webview";
import Svg, { Rect, Line, Text as SvgText, G } from "react-native-svg";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { isServerConfigured, getServerBaseUrl } from "@/lib/_core/server-config";
import { trpcQuery, trpcMutate } from "@/lib/_core/trpc-fetch";
import { askAi } from "@/lib/_core/ai-chat";

type ViewMode = "3d" | "pcb" | "code";

// ── three.js scene rendered inside a WebView ──────────────────────────────────
// Uses an ES-module import map (supported by modern Android WebView) so we avoid
// the removed UMD bundles, and implements a tiny orbit + raycaster ourselves so
// there's no dependency on the deprecated examples/js OrbitControls.
const THREE_HTML = `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<style>html,body{margin:0;height:100%;background:#0b1220;overflow:hidden;touch-action:none}
#hint{position:fixed;bottom:8px;left:0;right:0;text-align:center;color:#94a3b8;font:11px sans-serif;pointer-events:none}
#err{position:fixed;inset:0;display:none;align-items:center;justify-content:center;color:#f87171;font:13px sans-serif;padding:16px;text-align:center}</style>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
</head><body>
<div id="hint">Drag to orbit · pinch to zoom · tap an object</div>
<div id="err">Could not load the 3D engine.<br/>Check the phone's internet connection.</div>
<script type="module">
let post = (m)=>{ try{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }catch(e){} };
try {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);
  const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 1000);
  let radius=9, theta=0.9, phi=1.0, target=new THREE.Vector3(0,0,0);
  function applyCam(){ camera.position.set(target.x+radius*Math.sin(phi)*Math.cos(theta), target.y+radius*Math.cos(phi), target.z+radius*Math.sin(phi)*Math.sin(theta)); camera.lookAt(target); }
  applyCam();
  const renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff,0.6));
  const d1=new THREE.DirectionalLight(0xffffff,0.8); d1.position.set(10,10,10); scene.add(d1);
  const d2=new THREE.DirectionalLight(0xffffff,0.3); d2.position.set(-10,5,-10); scene.add(d2);

  const DESC = {
    Cube:'A 2×2×2 unit cube mesh at the origin. Standard box primitive.',
    Sphere:'A sphere, radius 0.9, 32×32 segments. Placed at X+2.5.',
    Cylinder:'A cylinder, radius 0.6, height 2.2, 32 radial segments. Placed at X-2.5.'
  };
  let meshes = [];
  const demoGroup = new THREE.Group(); scene.add(demoGroup);
  let modelGroup = null;
  function add(geo, color, name, x){ const m=new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color})); m.position.x=x; m.name=name; demoGroup.add(m); meshes.push(m); }
  add(new THREE.BoxGeometry(2,2,2), 0xe24b6e, 'Cube', 0);
  add(new THREE.SphereGeometry(0.9,32,32), 0x4e8ef7, 'Sphere', 2.5);
  add(new THREE.CylinderGeometry(0.6,0.6,2.2,32), 0x4ecb71, 'Cylinder', -2.5);

  let selected=null;
  function highlight(){ meshes.forEach(m=>{ if(!m.material) return; m.material.emissive = new THREE.Color(m===selected?0xff6600:0x000000); m.material.emissiveIntensity = m===selected?0.6:0; }); }

  // ── Load a real GLB/GLTF mesh, replacing the demo primitives ──
  const gltfLoader = new GLTFLoader();
  window.loadModel = function(url){
    gltfLoader.load(url, (gltf)=>{
      if(modelGroup){ scene.remove(modelGroup); }
      demoGroup.visible = false;
      modelGroup = gltf.scene;
      scene.add(modelGroup);
      // Rebuild the pickable mesh list from the loaded model.
      meshes = []; selected = null;
      modelGroup.traverse((o)=>{ if(o.isMesh){ meshes.push(o); if(!o.name) o.name='Mesh'; } });
      // Frame the camera to the model's bounding box.
      const box = new THREE.Box3().setFromObject(modelGroup);
      const size = box.getSize(new THREE.Vector3());
      target = box.getCenter(new THREE.Vector3());
      radius = Math.max(size.x,size.y,size.z) * 1.8 || 9;
      applyCam();
      post({type:'modelLoaded', meshCount: meshes.length});
    }, undefined, (err)=>{ post({type:'modelError', message:String(err && err.message || err)}); });
  };
  window.clearModel = function(){
    if(modelGroup){ scene.remove(modelGroup); modelGroup=null; }
    demoGroup.visible = true;
    meshes = []; demoGroup.children.forEach((m)=>meshes.push(m)); selected=null;
    target.set(0,0,0); radius=9; applyCam();
    post({type:'modelCleared'});
  };

  const ray=new THREE.Raycaster(), ndc=new THREE.Vector2();
  let downX=0,downY=0,moved=false;
  function pick(x,y){ ndc.x=(x/innerWidth)*2-1; ndc.y=-(y/innerHeight)*2+1; ray.setFromCamera(ndc,camera); const hit=ray.intersectObjects(meshes,true)[0];
    if(hit){ selected=hit.object; highlight(); post({type:'select',name:selected.name,description:DESC[selected.name]||('3D object: '+selected.name)}); }
    else { selected=null; highlight(); post({type:'deselect'}); } }

  // pointer + touch handling (orbit / pinch / tap)
  let lastX=0,lastY=0,dragging=false,pinchD=0;
  function dist(t){ const dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY; return Math.hypot(dx,dy); }
  renderer.domElement.addEventListener('touchstart',e=>{ if(e.touches.length===1){ dragging=true; moved=false; lastX=downX=e.touches[0].clientX; lastY=downY=e.touches[0].clientY; } else if(e.touches.length===2){ dragging=false; pinchD=dist(e.touches); } },{passive:true});
  renderer.domElement.addEventListener('touchmove',e=>{ if(e.touches.length===1&&dragging){ const x=e.touches[0].clientX,y=e.touches[0].clientY; theta-=(x-lastX)*0.01; phi=Math.max(0.15,Math.min(Math.PI-0.15,phi-(y-lastY)*0.01)); lastX=x; lastY=y; if(Math.abs(x-downX)>8||Math.abs(y-downY)>8) moved=true; applyCam(); } else if(e.touches.length===2){ const d=dist(e.touches); radius=Math.max(3,Math.min(30,radius*(pinchD/d))); pinchD=d; applyCam(); } },{passive:true});
  renderer.domElement.addEventListener('touchend',e=>{ if(dragging&&!moved){ pick(downX,downY); } dragging=false; },{passive:true});

  function loop(){ requestAnimationFrame(loop); renderer.render(scene,camera); }
  loop();
  addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });
  post({type:'ready'});
} catch(e){ document.getElementById('err').style.display='flex'; post({type:'error',message:String(e)}); }
</script></body></html>`;

interface FileTreeNode {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}
interface ProjectItem { id: string; name: string; projectId: string; rootDir: string }
interface ModelItem {
  name: string; // filename (key)
  displayName?: string;
  url: string;
  size: number;
  mapId?: string | null;
  designProjectId?: number | null;
  source?: string;
}
interface PcbProject { id: number; name: string; mode?: string; mapId?: string | null }
interface PcbDesign { id: number; name: string; canvasData: { nodes: any[]; edges: any[]; metadata?: any }; componentCount?: number; connectionCount?: number }

export default function Viewer3DScreen() {
  const colors = useColors();
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const configured = isServerConfigured();

  const [selectedNeuralMapId, setSelectedNeuralMapId] = useState<string | null>(null);
  const [neuralMaps, setNeuralMaps] = useState<{ id: string; name: string }[]>([]);

  // Load from AsyncStorage on mount and check server active map ID
  useEffect(() => {
    (async () => {
      try {
        const savedMapId = await AsyncStorage.getItem("omnecor:selected_map_id");
        if (savedMapId) {
          setSelectedNeuralMapId(savedMapId);
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  useEffect(() => {
    if (!configured) return;
    (async () => {
      try {
        // The procedure returns { activeMapId }, not a bare string — unwrap it so
        // we never persist an object into AsyncStorage (string-only native store).
        const { activeMapId } = await trpcQuery<{ activeMapId: string | null }>("neuralMaps.getActiveMapId");
        if (activeMapId) {
          setSelectedNeuralMapId(activeMapId);
          await AsyncStorage.setItem("omnecor:selected_map_id", activeMapId);
        }
        const mapsList = await trpcQuery<{ id: string; name: string }[]>("neuralMaps.list");
        if (mapsList) {
          setNeuralMaps(mapsList);
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [configured]);

  const activeNeuralMap = useMemo(() => {
    return neuralMaps.find(m => m.id === selectedNeuralMapId) || null;
  }, [neuralMaps, selectedNeuralMapId]);

  // ── shared AI / action state ──
  const [aiInput, setAiInput] = useState("");
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // ── 3D selection + model library ──
  const [selected3d, setSelected3d] = useState<{ name: string; description: string } | null>(null);
  const webRef = useRef<WebView>(null);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null); // model name, or null = demo scene
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  // Combined design context (3D models + PCB/schematic) for the active map, so
  // "Ask AI" in any mode sees the whole project — housing and board together.
  const [designContext, setDesignContext] = useState<string | null>(null);
  // Full URL of the currently-loaded model, kept so we can re-inject if the
  // WebView remounts (e.g. after switching modes and back).
  const activeModelUrlRef = useRef<string | null>(null);

  // ── PCB state ──
  const [pcbProjects, setPcbProjects] = useState<PcbProject[]>([]);
  const [pcbProject, setPcbProject] = useState<PcbProject | null>(null);
  const [pcbDesign, setPcbDesign] = useState<PcbDesign | null>(null);
  const [pcbLoading, setPcbLoading] = useState(false);

  // ── Code state ──
  const [codeProjects, setCodeProjects] = useState<ProjectItem[]>([]);
  const [codeProject, setCodeProject] = useState<ProjectItem | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [activeFile, setActiveFile] = useState<{ path: string; name: string } | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);

  const filteredCodeProjects = useMemo(() => {
    if (!selectedNeuralMapId) return codeProjects;
    return codeProjects.filter(p => p.projectId === selectedNeuralMapId);
  }, [codeProjects, selectedNeuralMapId]);

  // Scope PCB projects to the active map by their real mapId foreign key — no
  // name-substring heuristic and no "show everything" fallback, which would
  // leak other maps' projects into the active map's view.
  const filteredPcbProjects = useMemo(() => {
    if (!selectedNeuralMapId) return pcbProjects;
    return pcbProjects.filter(p => p.mapId === selectedNeuralMapId);
  }, [pcbProjects, selectedNeuralMapId]);

  // Models are now scoped server-side by their real mapId association (map-scoped
  // + global), so no client-side name heuristic is needed.
  const filteredModels = models;

  // Reload the model library, scoped to the active map. Exposed so the picker's
  // refresh button can pull in meshes just generated on the desktop.
  const loadModels = useCallback(async () => {
    if (!configured) return;
    try {
      const m = await trpcQuery<ModelItem[]>("blender.listModels", { mapId: selectedNeuralMapId });
      if (m) setModels(m);
    } catch { /* offline / not configured */ }
  }, [configured, selectedNeuralMapId]);

  // Load project / model lists when entering the relevant mode
  useEffect(() => {
    if (!configured) return;
    if (viewMode === "3d") {
      loadModels();
    }
    if (viewMode === "pcb" && pcbProjects.length === 0) {
      trpcQuery<PcbProject[]>("pcbEditor.getProjects").then((p) => p && setPcbProjects(p)).catch(() => {});
    }
    if (viewMode === "code" && codeProjects.length === 0) {
      trpcQuery<ProjectItem[]>("project.list").then((p) => p && setCodeProjects(p)).catch(() => {});
    }
  }, [viewMode, configured, loadModels, pcbProjects.length, codeProjects.length]);

  // Keep the combined project design context (3D models + PCB/schematic) fresh
  // for the active map so Ask AI always sees the whole project.
  useEffect(() => {
    if (!configured) { setDesignContext(null); return; }
    (async () => {
      try {
        const res = await trpcQuery<{ contextText: string }>("blender.getMapDesignContext", { mapId: selectedNeuralMapId });
        setDesignContext(res?.contextText ?? null);
      } catch { setDesignContext(null); }
    })();
  }, [configured, selectedNeuralMapId, pcbDesign, activeModel]);

  // ── 3D model picker: inject loadModel/clearModel into the WebView scene ──
  const selectModel = useCallback((model: { name: string; url: string } | null) => {
    setSelected3d(null);
    setModelStatus(null);
    if (!model) {
      setActiveModel(null);
      activeModelUrlRef.current = null;
      webRef.current?.injectJavaScript("window.clearModel && window.clearModel(); true;");
      return;
    }
    const fullUrl = getServerBaseUrl() + model.url;
    setActiveModel(model.name);
    activeModelUrlRef.current = fullUrl;
    setModelStatus(`Loading ${model.name}…`);
    webRef.current?.injectJavaScript(`window.loadModel && window.loadModel(${JSON.stringify(fullUrl)}); true;`);
  }, []);

  // ── PCB loaders ──
  const loadPcbProject = useCallback(async (proj: PcbProject) => {
    setPcbProject(proj);
    setPcbDesign(null);
    setAiResponse(null);
    setStatusMsg(null);
    setPcbLoading(true);
    try {
      const design = await trpcQuery<PcbDesign | null>("pcbEditor.getLatestDesign", { projectId: proj.id });
      if (design) setPcbDesign(design);
      else setStatusMsg("This project has no saved design yet — create one in the desktop PCB editor.");
    } catch (e) {
      setStatusMsg("Failed to load design: " + String(e));
    } finally {
      setPcbLoading(false);
    }
  }, []);

  // ── Code loaders ──
  const loadCodeProject = useCallback(async (proj: ProjectItem) => {
    setCodeProject(proj);
    setFileTree([]);
    setActiveFile(null);
    setFileContent("");
    setFileDirty(false);
    setAiResponse(null);
    setCodeLoading(true);
    try {
      const tree = await trpcQuery<FileTreeNode[]>("project.getFileTree", {
        projectId: proj.projectId,
        rootDir: proj.rootDir,
      });
      setFileTree(tree ?? []);
    } catch (e) {
      setStatusMsg("Failed to load file tree: " + String(e));
    } finally {
      setCodeLoading(false);
    }
  }, []);

  const openFile = useCallback(async (node: FileTreeNode) => {
    setCodeLoading(true);
    setStatusMsg(null);
    try {
      const res = await trpcMutate<{ content: string }>("project.readFile", { path: node.path });
      setActiveFile({ path: node.path, name: node.name });
      setFileContent(res?.content ?? "");
      setFileDirty(false);
    } catch (e) {
      setStatusMsg("Failed to read file: " + String(e));
    } finally {
      setCodeLoading(false);
    }
  }, []);

  // ── WebView message bridge (3D selection + model load status) ──
  const onWebMessage = useCallback((raw: string) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "select") setSelected3d({ name: msg.name, description: msg.description });
      else if (msg.type === "deselect") setSelected3d(null);
      else if (msg.type === "modelLoaded") setModelStatus(`Loaded · ${msg.meshCount} mesh${msg.meshCount === 1 ? "" : "es"}`);
      else if (msg.type === "modelError") setModelStatus("⚠ Failed to load model: " + (msg.message ?? "unknown error"));
      else if (msg.type === "modelCleared") setModelStatus(null);
      else if (msg.type === "ready" && activeModelUrlRef.current) {
        // WebView (re)mounted with a model previously selected — re-inject it.
        webRef.current?.injectJavaScript(`window.loadModel && window.loadModel(${JSON.stringify(activeModelUrlRef.current)}); true;`);
      }
    } catch {}
  }, []);

  // ── Build the context string fed to the AI for the current view ──
  const buildContext = useCallback((): string => {
    // The whole-project view (housing meshes + PCB/schematic) so the assistant
    // reasons about the 3D model and the board together, not in isolation.
    const projectCtx = designContext ? `\n\n${designContext}` : "";
    if (viewMode === "3d") {
      const sceneDesc = activeModel
        ? `Viewing the loaded 3D model "${activeModel}".`
        : "Viewing a demo 3D scene containing a Cube, Sphere and Cylinder primitive.";
      const base = selected3d
        ? `${sceneDesc} Selected object: ${selected3d.name}. ${selected3d.description}`
        : sceneDesc;
      return base + projectCtx;
    }
    if (viewMode === "pcb") {
      if (!pcbDesign) return "Viewing the Schematic/PCB editor (no design loaded)." + projectCtx;
      const comps = (pcbDesign.canvasData?.nodes ?? [])
        .map((n: any) => `${n?.data?.reference ?? n?.id}: ${n?.data?.value ?? n?.data?.label ?? ""}`)
        .join(", ");
      return `PCB/Schematic design "${pcbDesign.name}" — ${pcbDesign.componentCount ?? pcbDesign.canvasData?.nodes?.length ?? 0} components, ${pcbDesign.connectionCount ?? pcbDesign.canvasData?.edges?.length ?? 0} connections. Components: ${comps || "none"}.${projectCtx}`;
    }
    // code
    if (!activeFile) return "Viewing the code workspace (no file open).";
    const snippet = fileContent.length > 4000 ? fileContent.slice(0, 4000) + "\n…(truncated)" : fileContent;
    return `File: ${activeFile.name}\n\n${snippet}`;
  }, [viewMode, selected3d, pcbDesign, activeFile, fileContent, activeModel, designContext]);

  // ── Actions: Ask AI / Analyze (real endpoints) ──
  const runAi = useCallback(async (prompt: string) => {
    if (!configured) { setStatusMsg("No server configured — open Settings."); return; }
    setAiBusy(true);
    setAiResponse(null);
    setStatusMsg(null);
    try {
      let text: string;
      if (viewMode === "pcb" && pcbDesign) {
        // Real persisted AI review tied to the design. Fold in the linked 3D
        // housing/model context so the review considers the enclosure too.
        const res = await trpcMutate<{ response: string }>("pcbEditor.reviewDesign", {
          designSaveId: pcbDesign.id,
          prompt: designContext ? `${prompt}\n\nLinked project assets:\n${designContext}` : prompt,
        });
        text = res?.response ?? "";
      } else {
        text = await askAi({
          prompt,
          context: buildContext(),
          systemPrompt:
            viewMode === "3d"
              ? "You are a 3D modelling assistant helping with objects in a scene."
              : "You are an expert software and hardware design assistant.",
        });
      }
      setAiResponse(text || "No response.");
    } catch (e) {
      setAiResponse("⚠ " + String(e));
    } finally {
      setAiBusy(false);
    }
  }, [configured, viewMode, pcbDesign, buildContext, designContext]);

  const handleAskAi = useCallback(() => {
    const q = aiInput.trim();
    if (!q) { setStatusMsg("Type a question first."); return; }
    setAiInput("");
    runAi(q);
  }, [aiInput, runAi]);

  const handleAnalyze = useCallback(() => {
    const prompt =
      viewMode === "pcb"
        ? "Analyze this design for errors, missing connections, and best-practice improvements."
        : viewMode === "3d"
        ? "Analyze this 3D object/scene and suggest design or geometry improvements."
        : "Analyze this file. Report bugs, risks, and concrete improvements.";
    runAi(prompt);
  }, [viewMode, runAi]);

  // ── Modify (real writes) ──
  const handleModify = useCallback(async () => {
    if (!configured) { setStatusMsg("No server configured — open Settings."); return; }
    setStatusMsg(null);
    if (viewMode === "code") {
      if (!activeFile) { setStatusMsg("Open a file first."); return; }
      setCodeLoading(true);
      try {
        await trpcMutate("project.writeFile", { path: activeFile.path, content: fileContent });
        setFileDirty(false);
        setStatusMsg(`✓ Saved ${activeFile.name} to the desktop.`);
      } catch (e) {
        setStatusMsg("Save failed: " + String(e));
      } finally {
        setCodeLoading(false);
      }
    } else if (viewMode === "pcb") {
      if (!pcbDesign || !pcbProject) { setStatusMsg("Load a design first."); return; }
      setPcbLoading(true);
      try {
        const saved = await trpcMutate<{ id: number; name: string }>("pcbEditor.saveDesign", {
          projectId: Number(pcbProject.id),
          name: `${pcbDesign.name} (mobile ${new Date().toLocaleTimeString()})`,
          canvasData: pcbDesign.canvasData,
          description: "Saved from Omnecor HQ mobile",
        });
        setStatusMsg(`✓ Saved new design version (#${saved?.id}).`);
      } catch (e) {
        setStatusMsg("Save failed: " + String(e));
      } finally {
        setPcbLoading(false);
      }
    } else {
      setStatusMsg("3D geometry editing lives in the desktop Designer — use Ask AI for change suggestions.");
    }
  }, [configured, viewMode, activeFile, fileContent, pcbDesign, pcbProject]);

  // ── Export (real endpoints) ──
  const handleExport = useCallback(async () => {
    if (!configured) { setStatusMsg("No server configured — open Settings."); return; }
    setStatusMsg(null);
    if (viewMode === "pcb") {
      if (!pcbDesign) { setStatusMsg("Load a design first."); return; }
      setPcbLoading(true);
      try {
        const res = await trpcMutate<{ fileUrl: string; format: string }>("pcbEditor.exportDesign", {
          designSaveId: pcbDesign.id,
          format: "png",
        });
        setStatusMsg(`✓ Exported: ${getServerBaseUrl()}${res?.fileUrl}`);
      } catch (e) {
        setStatusMsg("Export failed: " + String(e));
      } finally {
        setPcbLoading(false);
      }
    } else if (viewMode === "code") {
      if (!activeFile) { setStatusMsg("Open a file first."); return; }
      // For code, export == persist current buffer to disk (real write).
      setCodeLoading(true);
      try {
        await trpcMutate("project.writeFile", { path: activeFile.path, content: fileContent });
        setFileDirty(false);
        setStatusMsg(`✓ Wrote ${activeFile.name} to disk.`);
      } catch (e) {
        setStatusMsg("Export failed: " + String(e));
      } finally {
        setCodeLoading(false);
      }
    } else {
      setStatusMsg("Export 3D models from the desktop Designer (Blender bridge).");
    }
  }, [configured, viewMode, pcbDesign, activeFile, fileContent]);

  const busy = aiBusy || pcbLoading || codeLoading;

  const modes: { id: ViewMode; label: string }[] = [
    { id: "3d", label: "3D View" },
    { id: "pcb", label: "Schematic/PCB" },
    { id: "code", label: "Code" },
  ];

  return (
    <ScreenContainer className="flex-1 bg-background">
      {/* Mode selector */}
      <View className="bg-surface border-b border-border p-3 flex-row gap-2">
        {modes.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => { setViewMode(m.id); setAiResponse(null); setStatusMsg(null); }}
            className={`flex-1 rounded-lg p-2 items-center ${viewMode === m.id ? "bg-primary" : "bg-background border border-border"}`}
          >
            <Text className={`text-xs font-semibold ${viewMode === m.id ? "text-background" : "text-foreground"}`}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      {!configured && (
        <View className="bg-warning/10 border-b border-warning p-2">
          <Text className="text-xs text-warning text-center">No server configured — open Settings to connect.</Text>
        </View>
      )}

      {/* ── 3D MODE ── */}
      {viewMode === "3d" && (
        <View className="flex-1">
          {/* Model library picker */}
          <View className="bg-surface border-b border-border p-2">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-xs text-muted">Model{activeNeuralMap ? ` · ${activeNeuralMap.name}` : ""}</Text>
              <Pressable onPress={loadModels} className="px-2 py-0.5 active:opacity-60">
                <Text className="text-xs text-primary">↻ Refresh</Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
              <Pressable onPress={() => selectModel(null)}
                className={`mr-2 px-3 py-1.5 rounded-lg ${activeModel === null ? "bg-primary" : "bg-background border border-border"}`}>
                <Text className={`text-xs ${activeModel === null ? "text-background" : "text-foreground"}`}>Demo scene</Text>
              </Pressable>
              {filteredModels.map((m) => (
                <Pressable key={m.name} onPress={() => selectModel(m)}
                  className={`mr-2 px-3 py-1.5 rounded-lg ${activeModel === m.name ? "bg-primary" : "bg-background border border-border"}`}>
                  <Text className={`text-xs ${activeModel === m.name ? "text-background" : "text-foreground"}`}>
                    {m.displayName || m.name}{m.designProjectId ? " 🔗" : ""}
                  </Text>
                </Pressable>
              ))}
              {filteredModels.length === 0 && (
                <Text className="text-xs text-muted p-2">No models in the library — export one from the desktop Blender bridge or generate one in ComfyUI.</Text>
              )}
            </ScrollView>
          </View>
          <View className="flex-1 bg-background">
            <WebView
              ref={webRef}
              originWhitelist={["*"]}
              source={{ html: THREE_HTML }}
              onMessage={(e) => onWebMessage(e.nativeEvent.data)}
              style={{ flex: 1, backgroundColor: "#0b1220" }}
              javaScriptEnabled
              domStorageEnabled
              mixedContentMode="always"
            />
          </View>
          {modelStatus && (
            <View className="bg-background border-t border-border px-3 py-1.5">
              <Text className="text-xs text-muted" numberOfLines={1}>{modelStatus}</Text>
            </View>
          )}
          {selected3d && (
            <View className="bg-surface border-t border-border p-3">
              <Text className="text-sm font-semibold text-primary">Selected: {selected3d.name}</Text>
              <Text className="text-xs text-muted mt-1">{selected3d.description}</Text>
            </View>
          )}
        </View>
      )}

      {/* ── PCB MODE ── */}
      {viewMode === "pcb" && (
        <View className="flex-1">
          <View className="bg-surface border-b border-border p-2">
            <Text className="text-xs text-muted mb-1">Project</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
              {filteredPcbProjects.length === 0 && <Text className="text-xs text-muted p-2">No PCB projects on the desktop.</Text>}
              {filteredPcbProjects.map((p) => (
                <Pressable key={p.id} onPress={() => loadPcbProject(p)}
                  className={`mr-2 px-3 py-1.5 rounded-lg ${pcbProject?.id === p.id ? "bg-primary" : "bg-background border border-border"}`}>
                  <Text className={`text-xs ${pcbProject?.id === p.id ? "text-background" : "text-foreground"}`}>{p.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <View className="flex-1 bg-background items-center justify-center">
            {pcbLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : pcbDesign ? (
              <PcbCanvas design={pcbDesign} stroke={colors.primary} text={colors.foreground} />
            ) : (
              <Text className="text-muted text-xs px-6 text-center">{pcbProject ? "No design loaded." : "Select a PCB project above to load its latest design."}</Text>
            )}
          </View>
        </View>
      )}

      {/* ── CODE MODE ── */}
      {viewMode === "code" && (
        <View className="flex-1">
          <View className="bg-surface border-b border-border p-2">
            <Text className="text-xs text-muted mb-1">Project</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
              {filteredCodeProjects.length === 0 && <Text className="text-xs text-muted p-2">No watched projects on the desktop.</Text>}
              {filteredCodeProjects.map((p) => (
                <Pressable key={p.id} onPress={() => loadCodeProject(p)}
                  className={`mr-2 px-3 py-1.5 rounded-lg ${codeProject?.id === p.id ? "bg-primary" : "bg-background border border-border"}`}>
                  <Text className={`text-xs ${codeProject?.id === p.id ? "text-background" : "text-foreground"}`}>{p.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          {codeProject && !activeFile && (
            <ScrollView className="max-h-40 bg-background border-b border-border">
              {codeLoading && <ActivityIndicator className="my-3" color={colors.primary} />}
              <FileTree nodes={fileTree} onOpen={openFile} muted={colors.muted} fg={colors.foreground} />
            </ScrollView>
          )}
          <View className="flex-1 bg-background">
            {activeFile ? (
              <>
                <View className="flex-row items-center justify-between bg-surface border-b border-border px-3 py-1.5">
                  <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>{activeFile.name}{fileDirty ? " •" : ""}</Text>
                  <Pressable onPress={() => { setActiveFile(null); setFileDirty(false); }}>
                    <Text className="text-xs text-primary">‹ Files</Text>
                  </Pressable>
                </View>
                <TextInput
                  value={fileContent}
                  onChangeText={(t) => { setFileContent(t); setFileDirty(true); }}
                  multiline
                  className="flex-1 p-3 text-foreground"
                  style={{ fontFamily: "monospace", textAlignVertical: "top", fontSize: 12 }}
                  placeholderTextColor={colors.muted}
                />
              </>
            ) : (
              <View className="flex-1 items-center justify-center">
                <Text className="text-muted text-xs px-6 text-center">{codeProject ? "Pick a file above to view and edit it." : "Select a project to browse its files."}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── AI response panel ── */}
      {(aiResponse || aiBusy) && (
        <View className="bg-surface border-t border-border max-h-48">
          <View className="flex-row items-center justify-between px-3 pt-2">
            <Text className="text-xs font-semibold text-primary">AI</Text>
            {!aiBusy && <Pressable onPress={() => setAiResponse(null)}><Text className="text-xs text-muted">✕</Text></Pressable>}
          </View>
          {aiBusy ? (
            <View className="flex-row items-center gap-2 p-3"><ActivityIndicator size="small" color={colors.primary} /><Text className="text-xs text-muted">Thinking…</Text></View>
          ) : (
            <ScrollView className="px-3 pb-3"><Text className="text-xs text-foreground">{aiResponse}</Text></ScrollView>
          )}
        </View>
      )}

      {statusMsg && (
        <View className="bg-background border-t border-border px-3 py-2">
          <Text className="text-xs text-muted" numberOfLines={3}>{statusMsg}</Text>
        </View>
      )}

      {/* ── Interactive action bar (restored: Ask AI · Analyze · Modify · Export) ── */}
      <View className="bg-surface border-t border-border p-3 gap-2">
        <View className="flex-row gap-2">
          <TextInput
            value={aiInput}
            onChangeText={setAiInput}
            placeholder={viewMode === "pcb" ? "Ask AI about this design…" : viewMode === "code" ? "Ask AI about this file…" : "Ask AI about this model…"}
            placeholderTextColor={colors.muted}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground"
            onSubmitEditing={handleAskAi}
          />
          <Pressable onPress={handleAskAi} disabled={busy}
            className={`rounded-lg px-4 items-center justify-center ${busy ? "bg-primary/50" : "bg-primary active:opacity-80"}`}>
            <Text className="text-background font-semibold text-sm">Ask AI</Text>
          </Pressable>
        </View>
        <View className="flex-row gap-2">
          <ActionButton label="Analyze" onPress={handleAnalyze} disabled={busy} />
          <ActionButton label={viewMode === "code" ? "Save" : "Modify"} onPress={handleModify} disabled={busy} />
          <ActionButton label="Export" onPress={handleExport} disabled={busy} />
        </View>
      </View>
    </ScreenContainer>
  );
}

function ActionButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled}
      className={`flex-1 rounded-lg p-2 items-center border border-border ${disabled ? "bg-background opacity-50" : "bg-background active:opacity-70"}`}>
      <Text className="text-foreground text-sm">{label}</Text>
    </Pressable>
  );
}

// ── recursive file tree (code mode) ──
function FileTree({ nodes, onOpen, depth = 0, muted, fg }: { nodes: FileTreeNode[]; onOpen: (n: FileTreeNode) => void; depth?: number; muted: string; fg: string }) {
  return (
    <>
      {nodes.map((node) => (
        <View key={node.path}>
          {node.type === "directory" ? (
            <>
              <View style={{ paddingLeft: depth * 12 + 8 }} className="py-1">
                <Text className="text-xs" style={{ color: muted }}>📁 {node.name}</Text>
              </View>
              {node.children && node.children.length > 0 && (
                <FileTree nodes={node.children} onOpen={onOpen} depth={depth + 1} muted={muted} fg={fg} />
              )}
            </>
          ) : (
            <Pressable onPress={() => onOpen(node)} style={{ paddingLeft: depth * 12 + 8 }} className="py-1 active:opacity-60">
              <Text className="text-xs" style={{ color: fg }}>📄 {node.name}</Text>
            </Pressable>
          )}
        </View>
      ))}
    </>
  );
}

// ── PCB/schematic canvas rendered from real React-Flow nodes/edges ──
function PcbCanvas({ design, stroke, text }: { design: PcbDesign; stroke: string; text: string }) {
  const { nodes, edges, viewBox, centers } = useMemo(() => {
    const rawNodes: any[] = design.canvasData?.nodes ?? [];
    const rawEdges: any[] = design.canvasData?.edges ?? [];
    // Lay nodes out: use stored positions when present, else a simple grid.
    const NW = 90, NH = 44, GAP = 40, COLS = 4;
    const placed = rawNodes.map((n, i) => {
      const px = n?.position?.x, py = n?.position?.y;
      const x = typeof px === "number" ? px : (i % COLS) * (NW + GAP);
      const y = typeof py === "number" ? py : Math.floor(i / COLS) * (NH + GAP);
      return { id: n?.id ?? String(i), x, y, label: n?.data?.reference ?? n?.data?.label ?? n?.id ?? `N${i}`, value: n?.data?.value ?? "" };
    });
    const centerMap: Record<string, { x: number; y: number }> = {};
    placed.forEach((p) => { centerMap[p.id] = { x: p.x + NW / 2, y: p.y + NH / 2 }; });
    const xs = placed.map((p) => p.x); const ys = placed.map((p) => p.y);
    const minX = Math.min(0, ...xs), minY = Math.min(0, ...ys);
    const maxX = Math.max(NW, ...placed.map((p) => p.x + NW));
    const maxY = Math.max(NH, ...placed.map((p) => p.y + NH));
    const pad = 30;
    return {
      nodes: placed.map((p) => ({ ...p, w: NW, h: NH })),
      edges: rawEdges,
      centers: centerMap,
      viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
    };
  }, [design]);

  if (nodes.length === 0) {
    return <Text className="text-muted text-xs px-6 text-center">Design has no components to render.</Text>;
  }
  return (
    <Svg width="100%" height="100%" viewBox={viewBox}>
      <G>
        {edges.map((e: any, i: number) => {
          const a = centers[e?.source]; const b = centers[e?.target];
          if (!a || !b) return null;
          return <Line key={e?.id ?? i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={1.5} opacity={0.6} />;
        })}
        {nodes.map((n) => (
          <G key={n.id}>
            <Rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} fill="#1e293b" stroke={stroke} strokeWidth={1.5} />
            <SvgText x={n.x + n.w / 2} y={n.y + 18} fill={text} fontSize={11} fontWeight="bold" textAnchor="middle">{String(n.label).slice(0, 12)}</SvgText>
            {!!n.value && <SvgText x={n.x + n.w / 2} y={n.y + 33} fill={text} fontSize={9} textAnchor="middle" opacity={0.7}>{String(n.value).slice(0, 14)}</SvgText>}
          </G>
        ))}
      </G>
    </Svg>
  );
}
