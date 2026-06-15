/**
 * ThreeViewer
 *
 * Renders 3D content in a React-Three-Fiber canvas.
 * Supports object picking via raycasting — clicking a mesh highlights it
 * (emissive orange glow) and triggers onObjectSelect so the parent can
 * open the "Ask AI about this" panel.
 */

import React, { Suspense, useRef, useState, useCallback, useEffect } from "react";
import { Canvas, useThree, ThreeEvent } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Html } from "@react-three/drei";
import { Loader2, Sparkles, X } from "lucide-react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

// ── User-model scene context builder ───────────────────────────────────────────
// Walks a loaded GLTF/OBJ hierarchy and produces a human-readable summary of the
// model structure (mesh names, parent chain, vertex counts, bounding-box dims) so
// the AI receives real context instead of a bare mesh name.
interface SceneContext {
  /** Multi-line summary string to embed in the AI prompt. */
  context: string;
  /** Per-mesh one-line descriptions for the selection panel. */
  descriptions: Record<string, string>;
}

function buildSceneContext(root: THREE.Object3D, modelName: string): SceneContext {
  const fmt = (n: number) => {
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? String(r) : r.toFixed(2);
  };
  const lines: string[] = [];
  const descriptions: Record<string, string> = {};
  const size = new THREE.Vector3();

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh || !mesh.geometry) return;

    const geo = mesh.geometry as THREE.BufferGeometry;
    const verts = geo.attributes.position?.count ?? 0;
    const name = mesh.name || "(unnamed mesh)";

    const parent = mesh.parent;
    const parentName = parent && parent !== root && parent.name ? parent.name : null;

    let dims = "";
    try {
      geo.computeBoundingBox();
      if (geo.boundingBox) {
        geo.boundingBox.getSize(size);
        dims = `${fmt(size.x)}×${fmt(size.y)}×${fmt(size.z)}`;
      }
    } catch {
      /* bounding box unavailable for this geometry */
    }

    const parts: string[] = [];
    if (parentName) parts.push(`parent: ${parentName}`);
    parts.push(`${verts.toLocaleString()} verts`);
    if (dims) parts.push(dims);

    const line = `${name} (${parts.join(", ")})`;
    lines.push(`  - ${line}`);
    descriptions[name] = line;
  });

  const context =
    `Model: ${modelName}\n` +
    `Meshes (${lines.length}):\n` +
    (lines.length ? lines.join("\n") : "  (no meshes found)");

  return { context, descriptions };
}

interface ThreeViewerProps {
  code?: string;
  url?: string;
  onObjectSelect?: (name: string, description: string) => void;
}

// ── Selectable mesh ───────────────────────────────────────────────────────────

interface SelectableMeshProps {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  position?: [number, number, number];
  rotation?: [number, number, number];
  name: string;
  isSelected: boolean;
  onSelect: (name: string) => void;
}

function SelectableMesh({ geometry, material, position, rotation, name, isSelected, onSelect }: SelectableMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHovered] = useState(false);

  const baseMat = material.clone();
  if (isSelected) {
    baseMat.emissive = new THREE.Color(0xff6600);
    baseMat.emissiveIntensity = 0.6;
  } else if (hovered) {
    baseMat.emissive = new THREE.Color(0x4488ff);
    baseMat.emissiveIntensity = 0.3;
  } else {
    baseMat.emissiveIntensity = 0;
  }

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={baseMat}
      position={position}
      rotation={rotation}
      name={name}
      castShadow
      receiveShadow
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect(name);
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
    />
  );
}

// ── Cube Faces selection helper ─────────────────────────────────────────────
const CUBE_FACES = [
  { name: "Cube (Front Face)", position: [0, 0, 1] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] },
  { name: "Cube (Back Face)", position: [0, 0, -1] as [number, number, number], rotation: [0, Math.PI, 0] as [number, number, number] },
  { name: "Cube (Right Face)", position: [1, 0, 0] as [number, number, number], rotation: [0, Math.PI / 2, 0] as [number, number, number] },
  { name: "Cube (Left Face)", position: [-1, 0, 0] as [number, number, number], rotation: [0, -Math.PI / 2, 0] as [number, number, number] },
  { name: "Cube (Top Face)", position: [0, 1, 0] as [number, number, number], rotation: [-Math.PI / 2, 0, 0] as [number, number, number] },
  { name: "Cube (Bottom Face)", position: [0, -1, 0] as [number, number, number], rotation: [Math.PI / 2, 0, 0] as [number, number, number] },
];

function SelectableCube({ selectedName, onSelect, material }: { selectedName: string | null; onSelect: (name: string) => void; material: THREE.MeshStandardMaterial }) {
  const planeGeo = new THREE.PlaneGeometry(2, 2);
  return (
    <group position={[0, 0, 0]}>
      {CUBE_FACES.map(face => (
        <SelectableMesh
          key={face.name}
          geometry={planeGeo}
          material={material}
          position={face.position}
          rotation={face.rotation}
          name={face.name}
          isSelected={selectedName === face.name}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

// ── Sphere Hemispheres selection helper ─────────────────────────────────────
function SelectableSphere({ selectedName, onSelect, material, position }: { selectedName: string | null; onSelect: (name: string) => void; material: THREE.MeshStandardMaterial; position: [number, number, number] }) {
  const topGeo = new THREE.SphereGeometry(0.9, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const bottomGeo = new THREE.SphereGeometry(0.9, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);

  return (
    <group position={position}>
      <SelectableMesh
        geometry={topGeo}
        material={material}
        position={[0, 0, 0]}
        name="Sphere (Upper Hemisphere)"
        isSelected={selectedName === "Sphere (Upper Hemisphere)"}
        onSelect={onSelect}
      />
      <SelectableMesh
        geometry={bottomGeo}
        material={material}
        position={[0, 0, 0]}
        name="Sphere (Lower Hemisphere)"
        isSelected={selectedName === "Sphere (Lower Hemisphere)"}
        onSelect={onSelect}
      />
    </group>
  );
}

// ── Cylinder Caps and Wall selection helper ─────────────────────────────────
function SelectableCylinder({ selectedName, onSelect, material, position }: { selectedName: string | null; onSelect: (name: string) => void; material: THREE.MeshStandardMaterial; position: [number, number, number] }) {
  const circleGeo = new THREE.CircleGeometry(0.6, 32);
  const sideGeo = new THREE.CylinderGeometry(0.6, 0.6, 2.2, 32, 1, true); // open-ended

  return (
    <group position={position}>
      <SelectableMesh
        geometry={circleGeo}
        material={material}
        position={[0, 1.1, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        name="Cylinder (Top Cap)"
        isSelected={selectedName === "Cylinder (Top Cap)"}
        onSelect={onSelect}
      />
      <SelectableMesh
        geometry={sideGeo}
        material={material}
        position={[0, 0, 0]}
        name="Cylinder (Side Body)"
        isSelected={selectedName === "Cylinder (Side Body)"}
        onSelect={onSelect}
      />
      <SelectableMesh
        geometry={circleGeo}
        material={material}
        position={[0, -1.1, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        name="Cylinder (Bottom Cap)"
        isSelected={selectedName === "Cylinder (Bottom Cap)"}
        onSelect={onSelect}
      />
    </group>
  );
}

// ── Default scene — placeholder geometry ────────────────────────────────────

interface DefaultSceneProps {
  selectedName: string | null;
  onSelect: (name: string) => void;
}

function DefaultScene({ selectedName, onSelect }: DefaultSceneProps) {
  const redMat = new THREE.MeshStandardMaterial({ color: "#e24b6e" });
  const blueMat = new THREE.MeshStandardMaterial({ color: "#4e8ef7" });
  const greenMat = new THREE.MeshStandardMaterial({ color: "#4ecb71" });

  return (
    <>
      <SelectableCube
        selectedName={selectedName}
        onSelect={onSelect}
        material={redMat}
      />
      <SelectableSphere
        selectedName={selectedName}
        onSelect={onSelect}
        material={blueMat}
        position={[2.5, 0, 0]}
      />
      <SelectableCylinder
        selectedName={selectedName}
        onSelect={onSelect}
        material={greenMat}
        position={[-2.5, 0, 0]}
      />
    </>
  );
}

// ── User-loaded model (GLTF/GLB/OBJ) ────────────────────────────────────────

interface UserModelProps {
  object: THREE.Object3D;
  selectedName: string | null;
  onSelect: (name: string) => void;
}

function UserModel({ object, selectedName, onSelect }: UserModelProps) {
  // Highlight the selected mesh by toggling emissive on its material(s).
  useEffect(() => {
    object.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mat) => {
        const sm = mat as THREE.MeshStandardMaterial;
        if (!sm || !("emissive" in sm)) return;
        if (mesh.name && mesh.name === selectedName) {
          sm.emissive = new THREE.Color(0xff6600);
          sm.emissiveIntensity = 0.6;
        } else {
          sm.emissiveIntensity = 0;
        }
        sm.needsUpdate = true;
      });
    });
  }, [object, selectedName]);

  return (
    <group
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        const name = (e.object as THREE.Object3D)?.name;
        if (name) onSelect(name);
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <primitive object={object} />
    </group>
  );
}

// ── Click-to-deselect on background ─────────────────────────────────────────

function CanvasBackground({ onDeselect }: { onDeselect: () => void }) {
  return (
    <mesh
      position={[0, 0, -10]}
      onClick={() => onDeselect()}
      visible={false}
    >
      <planeGeometry args={[1000, 1000]} />
      <meshBasicMaterial />
    </mesh>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export default function ThreeViewer({ code, url, onObjectSelect }: ThreeViewerProps) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [aiQuery, setAiQuery] = useState("");
  const [loadedObject, setLoadedObject] = useState<THREE.Object3D | null>(null);
  const [sceneContext, setSceneContext] = useState<SceneContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load a user-supplied GLTF/GLB/OBJ when a url is provided, then walk the
  // hierarchy to build real AI context. The hardcoded demo descriptions below
  // are only used for the default primitive scene (no url).
  useEffect(() => {
    if (!url) {
      setLoadedObject(null);
      setSceneContext(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    setSelectedName(null);

    const modelName = url.split("?")[0].split("/").pop() || "model";
    const ext = modelName.split(".").pop()?.toLowerCase();

    const onLoad = (obj: THREE.Object3D) => {
      if (cancelled) return;
      setLoadedObject(obj);
      setSceneContext(buildSceneContext(obj, modelName));
    };
    const onError = () => {
      if (cancelled) return;
      setLoadError(`Failed to load model: ${modelName}`);
      setLoadedObject(null);
      setSceneContext(null);
    };

    if (ext === "obj") {
      new OBJLoader().load(url, onLoad, undefined, onError);
    } else {
      new GLTFLoader().load(url, (gltf) => onLoad(gltf.scene), undefined, onError);
    }

    return () => {
      cancelled = true;
    };
  }, [url]);

  const OBJECT_DESCRIPTIONS: Record<string, string> = {
    "Cube (Front Face)":      "The forward-facing flat surface of the central 2x2x2 cube, situated at Z+1.",
    "Cube (Back Face)":       "The rear-facing flat surface of the central 2x2x2 cube, situated at Z-1.",
    "Cube (Right Face)":      "The right-hand flat surface of the central 2x2x2 cube, situated at X+1.",
    "Cube (Left Face)":       "The left-hand flat surface of the central 2x2x2 cube, situated at X-1.",
    "Cube (Top Face)":        "The top flat surface of the central 2x2x2 cube, situated at Y+1.",
    "Cube (Bottom Face)":     "The bottom flat surface of the central 2x2x2 cube, situated at Y-1.",
    
    "Sphere (Upper Hemisphere)": "The upper dome section of the blue sphere. Placed at X+2.5, Y > 0.",
    "Sphere (Lower Hemisphere)": "The lower dome section of the blue sphere. Placed at X+2.5, Y < 0.",
    
    "Cylinder (Top Cap)":     "The circular flat top end of the green cylinder, placed at Y+1.1, X-2.5.",
    "Cylinder (Side Body)":   "The cylindrical outer surface/wall of the green cylinder, extending between Y-1.1 and Y+1.1 at X-2.5.",
    "Cylinder (Bottom Cap)":  "The circular flat bottom end of the green cylinder, placed at Y-1.1, X-2.5.",
  };

  // Resolve a human-readable description: real model mesh info first, then the
  // demo-scene table, then a bare fallback.
  const describe = useCallback(
    (name: string) =>
      sceneContext?.descriptions[name] ?? OBJECT_DESCRIPTIONS[name] ?? `3D object: ${name}`,
    [sceneContext],
  );

  // Build the `code` field for the AI payload. For a real loaded model this is
  // the full scene structure plus the selected mesh; otherwise the demo format.
  const buildAiCode = useCallback(
    (name: string) => {
      if (sceneContext) {
        return `${sceneContext.context}\n\nSelected mesh: ${name}`;
      }
      return `Object: ${name}\nDescription: ${OBJECT_DESCRIPTIONS[name] ?? `3D object: ${name}`}`;
    },
    [sceneContext],
  );

  const handleSelect = useCallback((name: string) => {
    setSelectedName(name);
    onObjectSelect?.(name, describe(name));
  }, [onObjectSelect, describe]);

  const handleDeselect = useCallback(() => {
    setSelectedName(null);
    onObjectSelect?.("", "");
  }, [onObjectSelect]);

  const handleSendToAI = () => {
    if (!selectedName) return;
    const payload = {
      code: buildAiCode(selectedName),
      notes: aiQuery,
      actionType: "ask" as const,
    };
    localStorage.setItem("omnecor:pending_ai_query", JSON.stringify(payload));
    setSelectedName(null);
    setAiQuery("");
    onObjectSelect?.("", "");
    window.location.href = "/chat";
  };

  return (
    <div className="w-full h-full bg-slate-900 rounded-md overflow-hidden relative select-none">
      <Suspense fallback={
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50">
          <Loader2 className="w-8 h-8 animate-spin mb-2" />
          <p className="text-sm">Loading 3D Environment...</p>
        </div>
      }>
        <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[10, 10, 10]} intensity={0.8} castShadow />
          <directionalLight position={[-10, 5, -10]} intensity={0.3} />
          <pointLight position={[0, -10, 0]} intensity={0.2} />

          <CanvasBackground onDeselect={handleDeselect} />

          {!url && (
            <DefaultScene selectedName={selectedName} onSelect={handleSelect} />
          )}

          {url && loadedObject && (
            <UserModel object={loadedObject} selectedName={selectedName} onSelect={handleSelect} />
          )}

          <OrbitControls makeDefault />
          <ContactShadows position={[0, -1.5, 0]} opacity={0.4} scale={20} blur={1.5} far={4.5} />
        </Canvas>
      </Suspense>

      {/* Model load error */}
      {loadError && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <span className="bg-red-900/70 text-red-200 text-[10px] px-3 py-1 rounded-full font-sans">
            {loadError}
          </span>
        </div>
      )}

      {/* Hover hint */}
      {!selectedName && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <span className="bg-black/50 text-white/60 text-[10px] px-3 py-1 rounded-full font-sans">
            Click an object to select · Drag to orbit
          </span>
        </div>
      )}

      {/* Selection panel */}
      {selectedName && (
        <div className="absolute bottom-4 right-4 bg-slate-900/95 border-2 border-orange-500/50 rounded-xl shadow-2xl p-4 w-72 z-30 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-orange-400 flex items-center gap-1.5 font-sans">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              Selected: {selectedName}
            </span>
            <button
              className="text-slate-400 hover:text-slate-200 transition-colors"
              onClick={handleDeselect}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-[10px] text-slate-400 mb-3 leading-relaxed font-sans">
            {describe(selectedName)}
          </p>

          <textarea
            className="w-full bg-slate-950 text-slate-200 text-xs rounded border border-slate-700 p-2 outline-none focus:border-orange-500/60 resize-none h-14 mb-3 font-sans placeholder:text-slate-600"
            placeholder="Describe what you want to change, fix, or ask about this object…"
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
          />

          <div className="flex gap-2">
            <button
              onClick={handleSendToAI}
              className="flex-1 flex items-center justify-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold rounded-lg py-1.5 transition-colors font-sans"
            >
              <Sparkles className="w-3 h-3" />
              Ask AI About This
            </button>
            <button
              onClick={() => {
                const payload = {
                  code: `${buildAiCode(selectedName)}\n\nPlease suggest design changes for this object.`,
                  notes: aiQuery,
                  actionType: "suggest" as const,
                };
                localStorage.setItem("omnecor:pending_ai_query", JSON.stringify(payload));
                setSelectedName(null);
                setAiQuery("");
                onObjectSelect?.("", "");
                window.location.href = "/chat";
              }}
              className="flex-1 flex items-center justify-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-lg py-1.5 transition-colors font-sans"
            >
              Suggest Changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
