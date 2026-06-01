import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

function PCBBoard() {
  return (
    <mesh>
      <boxGeometry args={[6, 0.1, 4]} />
      <meshStandardMaterial color="#1a7a2e" metalness={0.3} roughness={0.7} />
    </mesh>
  );
}

interface PCBViewer3DProps {
  filePath?: string;
  className?: string;
}

export default function PCBViewer3D({ filePath, className }: PCBViewer3DProps) {
  return (
    <div className={`w-full h-96 bg-gray-900 rounded-lg overflow-hidden ${className ?? ""}`}>
      {!filePath ? (
        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
          No PCB file loaded
        </div>
      ) : (
        <Canvas camera={{ position: [0, 5, 10], fov: 50 }}>
          <ambientLight intensity={0.4} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          <PCBBoard />
          <OrbitControls enablePan enableZoom enableRotate />
        </Canvas>
      )}
    </div>
  );
}
