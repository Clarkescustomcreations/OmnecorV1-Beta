/**
 * Blueprint Studio — 3D part viewer.
 *
 * Renders compiled `MeshJson` parts (mm coordinates) with orbit controls and
 * auto-fit framing. When an FEA field is supplied, the tet mesh's boundary
 * surface is rendered with a per-vertex von Mises heatmap (blue → red) and a
 * legend, so simulation results are inspectable in place.
 */
import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import type { MeshJson } from "@shared/blueprint";

export interface FeaField {
  positions: number[];
  tets: number[];
  vonMisesMPa: number[];
  maxVonMisesMPa: number;
}

interface BlueprintMeshViewerProps {
  parts: { name: string; mesh: MeshJson }[];
  feaField?: FeaField | null;
}

const PART_COLORS = ["#6ea8fe", "#8bd17c", "#e6b566", "#c39bd3", "#7fd6c2", "#e58f8f"];

function partGeometry(mesh: MeshJson): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
  geo.setIndex(mesh.indices);
  if (mesh.normals && mesh.normals.length === mesh.positions.length) {
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
  } else {
    geo.computeVertexNormals();
  }
  return geo;
}

/** Boundary faces of a tet mesh = faces referenced by exactly one tet. */
function feaSurfaceGeometry(field: FeaField): THREE.BufferGeometry {
  const faceCount = new Map<string, [number, number, number]>();
  const seen = new Map<string, number>();
  const addFace = (a: number, b: number, c: number) => {
    const key = [a, b, c].sort((x, y) => x - y).join("_");
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (!faceCount.has(key)) faceCount.set(key, [a, b, c]);
  };
  for (let t = 0; t < field.tets.length; t += 4) {
    const [a, b, c, d] = [field.tets[t], field.tets[t + 1], field.tets[t + 2], field.tets[t + 3]];
    addFace(a, b, c);
    addFace(a, b, d);
    addFace(a, c, d);
    addFace(b, c, d);
  }
  const indices: number[] = [];
  for (const [key, face] of faceCount) {
    if (seen.get(key) === 1) indices.push(...face);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(field.positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Per-vertex heatmap color: blue (0) → cyan → green → yellow → red (max).
  const max = field.maxVonMisesMPa > 0 ? field.maxVonMisesMPa : 1;
  const colors = new Float32Array(field.vonMisesMPa.length * 3);
  const c = new THREE.Color();
  for (let i = 0; i < field.vonMisesMPa.length; i++) {
    const t = Math.min(1, field.vonMisesMPa[i] / max);
    c.setHSL((1 - t) * 0.66, 1, 0.5);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

export function BlueprintMeshViewer({ parts, feaField }: BlueprintMeshViewerProps) {
  const geometries = useMemo(() => parts.map((p) => partGeometry(p.mesh)), [parts]);
  const feaGeometry = useMemo(() => (feaField ? feaSurfaceGeometry(feaField) : null), [feaField]);

  // Overall bounds → camera fit + ground placement.
  const { center, radius } = useMemo(() => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const fold = (positions: ArrayLike<number>) => {
      for (let i = 0; i < positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = positions[i + k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
      }
    };
    if (feaField) fold(feaField.positions);
    else parts.forEach((p) => fold(p.mesh.positions));
    if (!Number.isFinite(min[0])) return { center: [0, 0, 0] as const, radius: 100 };
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const r = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
    return { center: [cx, cy, cz] as const, radius: r };
  }, [parts, feaField]);

  const camDist = radius * 2.4;

  return (
    <div className="relative w-full h-full min-h-[360px]">
      <Canvas
        camera={{ position: [center[0] + camDist, center[1] + camDist * 0.8, center[2] + camDist], fov: 45, near: radius / 100, far: radius * 40, up: [0, 0, 1] }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[radius * 3, radius * 2, radius * 4]} intensity={1.1} />
        <directionalLight position={[-radius * 2, -radius * 3, radius * 2]} intensity={0.4} />
        {feaGeometry ? (
          <mesh geometry={feaGeometry}>
            <meshStandardMaterial vertexColors metalness={0.1} roughness={0.6} />
          </mesh>
        ) : (
          geometries.map((geo, i) => (
            <mesh key={parts[i].name + i} geometry={geo}>
              <meshStandardMaterial color={PART_COLORS[i % PART_COLORS.length]} metalness={0.15} roughness={0.55} />
            </mesh>
          ))
        )}
        <Grid
          position={[center[0], center[1], 0]}
          rotation={[Math.PI / 2, 0, 0]}
          args={[radius * 6, radius * 6]}
          cellSize={radius / 4}
          sectionSize={radius}
          cellColor="#334155"
          sectionColor="#475569"
          fadeDistance={radius * 8}
        />
        <OrbitControls target={center as unknown as THREE.Vector3} makeDefault />
      </Canvas>
      {feaField && (
        <div className="absolute bottom-3 left-3 rounded-md border border-border/60 bg-background/85 px-3 py-2 text-xs backdrop-blur">
          <div className="mb-1 font-medium">von Mises stress</div>
          <div className="h-2 w-40 rounded-sm" style={{ background: "linear-gradient(90deg,#0033ff,#00ffea,#3dff00,#ffee00,#ff2b00)" }} />
          <div className="mt-0.5 flex justify-between text-muted-foreground">
            <span>0</span>
            <span>{feaField.maxVonMisesMPa.toFixed(1)} MPa</span>
          </div>
        </div>
      )}
      {!feaField && parts.length > 1 && (
        <div className="absolute bottom-3 left-3 rounded-md border border-border/60 bg-background/85 px-3 py-2 text-xs backdrop-blur space-y-0.5">
          {parts.map((p, i) => (
            <div key={p.name + i} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PART_COLORS[i % PART_COLORS.length] }} />
              <span>{p.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
