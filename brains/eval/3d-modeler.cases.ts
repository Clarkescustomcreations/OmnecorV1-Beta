/**
 * @file brains/eval/3d-modeler.cases.ts
 * @description A/B eval question set for the built-in **3D Modeler** brain.
 */
import type { EvalSpec } from "./_types.js";

const spec: EvalSpec = {
  slug: "3d-modeler",
  name: "3D Modeler",
  model: "qwen2.5-coder:7b",
  baseSystem:
    "You are a concise, accurate 3D graphics and modeling expert (Blender, Three.js, " +
    "spatial math). Answer directly in 3–5 sentences. Be specific and technically " +
    "precise; prefer concrete rules and examples over generalities.",
  cases: [
    {
      q: "My model imports at the wrong orientation between Blender and Three.js. What is the usual cause?",
      facts: [["up axis", "up-axis", "z-up", "y-up", "z up", "y up"], ["handed", "handedness"], ["swap", "y and z", "negate", "convention"]],
    },
    {
      q: "Why are quaternions preferred over Euler angles for rotations?",
      facts: [["gimbal", "gimbal lock"], ["interpolat", "slerp", "smooth"], ["order", "no gimbal", "without"]],
    },
    {
      q: "When I scale an object non-uniformly, why does its lighting look wrong, and how do I fix normals?",
      facts: [["normal", "normals"], ["inverse-transpose", "inverse transpose", "normal matrix"], ["non-uniform", "scale", "renormal", "skew"]],
    },
    {
      q: "In Three.js, why does my app run out of GPU memory when I keep swapping models?",
      facts: [["dispose"], ["geometry", "material", "texture"], ["leak", "not garbage", "does not garbage", "gpu memory"]],
    },
    {
      q: "What is a normal map and why does it let a low-poly model look detailed?",
      facts: [["normal", "per-texel", "surface normal"], ["low-poly", "low poly", "high-poly", "detail", "bake"], ["tangent", "lighting", "rgb"]],
    },
    {
      q: "Why should I apply object transforms in Blender before exporting?",
      facts: [["apply", "ctrl+a", "ctrl a", "bake"], ["scale", "rotation"], ["export", "modifier", "normal map", "wrong size", "identity"]],
    },
    {
      q: "In a real-time engine, what usually matters more for performance: reducing polygons or reducing draw calls?",
      facts: [["draw call", "draw calls"], ["instancing", "instancedmesh", "merge", "batch"], ["cpu", "bottleneck", "more than", "bigger win"]],
    },
    {
      q: "What causes z-fighting (flickering surfaces) and how do I fix it?",
      facts: [["coplanar", "overlap", "same depth", "nearly"], ["depth", "precision", "z-buffer", "z buffer"], ["near", "far", "offset", "tighten"]],
    },
    {
      q: "How does texture color space affect rendering, and which maps are linear vs sRGB?",
      facts: [["srgb"], ["linear"], ["albedo", "base color", "color map", "normal", "roughness", "data map"]],
    },
    {
      q: "Explain the modern graphics pipeline: what runs per-vertex versus per-fragment?",
      facts: [["vertex shader", "per-vertex", "per vertex"], ["fragment", "per-fragment", "per fragment", "pixel"], ["rasteriz", "clip space", "interpolat"]],
    },
    {
      q: "Why does transparency render incorrectly and how do I order transparent objects?",
      facts: [["depth", "z-buffer", "sort"], ["back-to-front", "back to front", "after", "order"], ["blend", "alpha", "depth write"]],
    },
    {
      q: "What is edge flow / good topology and why does it matter for characters?",
      facts: [["quad", "quads"], ["edge loop", "edge loops", "loop"], ["deform", "subdivide", "pole", "bend", "crease"]],
    },
  ],
};

export default spec;
