/**
 * @file brains/sources/3d-modeler.ts
 * @description Source content for the built-in **3D Modeler** Brain Pack
 * (Brains-Upgrade Phase 6 — "Team of Experts").
 *
 * A specialist in 3D generation and spatial math: Blender modeling & Python
 * scripting, Three.js/WebGL scene work, meshes, transforms, materials, and the
 * math of 3D space. GENERAL-PURPOSE 3D knowledge for any tool or engine.
 * Original content, ships CC0. One durable fact per entry → one retrieval chunk.
 */
import type { BrainFact } from "./_types.js";
import { REASONING_BASE } from "./_reasoning-base.js";

export const MODELER_3D_CHARTER = `${REASONING_BASE}

Domain layer — 3D modeling (Blender, Three.js, spatial math). On any 3D task, ALSO apply:

1. Mind the coordinate system and units. State whether you are Y-up or Z-up, right- or left-handed, and what one unit means (meter) BEFORE transforming — most import/export bugs are axis/scale mismatches.
2. Transform order matters: scale, then rotate, then translate; parent transforms compose onto children. Compose with matrices, not ad-hoc axis math, and be explicit about local vs world space.
3. Topology is a means, not an end: prefer clean quad topology with edge loops that follow the form for anything deformed/subdivided; triangulate only at export. Keep normals consistent (outward) and geometry manifold.
4. Model at the right density. Match polygon budget to the target (real-time vs render); use modifiers/procedural steps non-destructively and apply them deliberately.
5. Materials are physically-based: author with base color, metallic, roughness, and normal maps; keep color textures in sRGB and data maps (normal/roughness/metallic) in linear space.
6. Free resources you allocate (geometries, materials, textures) in real-time engines — the GPU won't garbage-collect them for you.
7. Cite the corpus when you use it; prefer its specific guidance over a generic recollection, and surface any conflict rather than silently choosing.`;

export const MODELER_3D_SOURCES: BrainFact[] = [
  // ── Coordinate systems & transforms ────────────────────────────────────────
  {
    name: "coords-up-axis-handedness",
    text: `3D tools disagree on conventions and this is the #1 source of import bugs. Blender is right-handed, Z-up. Three.js/WebGL and most game engines (Unity) are Y-up; Unity is left-handed, Three.js is right-handed. glTF is right-handed, Y-up, meters. When moving assets between tools you often must swap Y and Z (and sometimes negate an axis) and fix scale. Always confirm the up-axis and handedness of BOTH sides before blaming the model.`,
  },
  {
    name: "transform-order-srt",
    text: `A transform is built by composing scale, rotation, and translation, and ORDER matters because matrix multiplication is non-commutative. The standard local transform is T * R * S (apply scale first, then rotate, then translate) — written so the scale is innermost when multiplying a column vector. Rotating before translating orbits around the origin; translating before rotating moves then spins about the new origin. Get the order wrong and objects fly off or shear unexpectedly.`,
  },
  {
    name: "transform-local-vs-world",
    text: `Every object has a LOCAL transform relative to its parent and a WORLD (global) transform = parentWorld * local, accumulated up the hierarchy. Moving a parent moves all children; a child's local coordinates stay the same while its world position changes. To place a child at a specific world position you must convert through the parent's inverse. Confusing local and world space is a constant source of "why is my object in the wrong place" bugs.`,
  },
  {
    name: "math-euler-vs-quaternion",
    text: `Euler angles (rotations about X, Y, Z in some order) are intuitive but suffer GIMBAL LOCK — at certain orientations two axes align and you lose a degree of freedom — and depend on the rotation order (XYZ vs ZYX give different results). QUATERNIONS represent any rotation without gimbal lock and interpolate smoothly (slerp). Use quaternions internally for composing and animating rotations; convert to Euler only for a human-facing UI. Never lerp Euler angles across large arcs.`,
  },
  {
    name: "math-normal-transform",
    text: `Normals do NOT transform by the same matrix as positions when the transform has non-uniform scale or shear. Transform positions by matrix M, but transform normals by the inverse-transpose of M's upper-left 3x3 (then renormalize). Using M directly on normals under non-uniform scale skews them off the surface, breaking lighting. This is why engines pass a separate "normal matrix" to shaders. If scale is uniform, M's rotation part suffices.`,
  },
  {
    name: "math-dot-cross-product",
    text: `Two vector products power most 3D math. The DOT product a·b = |a||b|cos(θ) measures alignment: positive if roughly same direction, zero if perpendicular, and gives the cosine of the angle for unit vectors (used for lighting: N·L). The CROSS product a×b yields a vector perpendicular to both, whose length is |a||b|sin(θ) and whose direction follows the right-hand rule (used to compute normals and check winding). Normalize inputs when you need an angle.`,
  },
  {
    name: "math-matrix-inverse-camera",
    text: `A camera's VIEW matrix is the INVERSE of the camera's world transform: to render the world from the camera's viewpoint you move the world by the opposite of the camera's transform. For a rigid transform (rotation + translation, no scale), the inverse is cheap: transpose the rotation and negate the rotated translation. The full pipeline is projection * view * model * vertex — model places the object, view moves it into camera space, projection flattens to the screen.`,
  },
  {
    name: "math-projection-matrix",
    text: `The PROJECTION matrix maps camera-space geometry into clip space. PERSPECTIVE projection (defined by field-of-view, aspect ratio, near, far) makes distant things smaller — realistic for cameras; watch that near/far aren't too far apart or z-fighting worsens. ORTHOGRAPHIC projection keeps parallel lines parallel with no size falloff — used for CAD, UI, and isometric views. Near/far planes clip geometry; set them tightly around your scene for the best depth precision.`,
  },
  // ── Meshes & topology ──────────────────────────────────────────────────────
  {
    name: "mesh-anatomy",
    text: `A polygon mesh is vertices (points in space), edges (vertex pairs), and faces (loops of edges, usually tris or quads). Real-time rendering ultimately uses TRIANGLES (always planar, unambiguous), but artists model in QUADS because they subdivide cleanly and show edge flow. Each vertex also carries attributes: a normal, UV coordinates, sometimes color and skinning weights. "Winding order" (CW/CCW) of a face's vertices defines its front side for back-face culling.`,
  },
  {
    name: "topology-quads-edge-loops",
    text: `For models that deform (characters) or subdivide, use clean QUAD topology with EDGE LOOPS that follow the anatomy — loops around eyes, mouth, and joints so the mesh creases and bends naturally. Avoid long thin triangles and "poles" (vertices where 3 or 5+ edges meet) in high-deformation areas; concentrate poles in flat, hidden regions. Good edge flow makes rigging, animation, and subdivision behave; bad topology pinches and shades badly no matter how many polygons you add.`,
  },
  {
    name: "topology-ngons-triangulate",
    text: `N-gons (faces with more than 4 sides) are convenient while modeling but risky: they can be non-planar, shade unpredictably, and subdivide badly. Keep them out of deforming/subdivided areas; they're tolerable on flat, static surfaces. At export for a game engine, TRIANGULATE the mesh so the engine doesn't do it arbitrarily — controlling the triangulation avoids surprise shading artifacts on quads that get split along the "wrong" diagonal.`,
  },
  {
    name: "mesh-normals-consistency",
    text: `Face and vertex normals must point consistently OUTWARD; a flipped normal renders black/inside-out or gets culled. "Recalculate normals" fixes most cases, but it needs a MANIFOLD mesh to decide inside from outside. Vertex normals are averaged from adjacent faces for smooth shading; mark sharp edges (or split normals / use a low smoothing angle) to keep hard creases crisp. Custom split normals let you control shading independently of geometry (common for game assets).`,
  },
  {
    name: "mesh-manifold-watertight",
    text: `A MANIFOLD mesh has every edge shared by exactly two faces, no isolated vertices, and consistent winding — the surface is well-defined. WATERTIGHT (no holes, a closed volume) is required for 3D PRINTING and boolean operations. Non-manifold geometry (edges shared by 3+ faces, flipped normals, self-intersections, zero-area faces) breaks normals, booleans, and slicers. Run a mesh-analysis/cleanup pass before printing or CSG; most print failures are non-watertight models.`,
  },
  {
    name: "mesh-poly-budget-lod",
    text: `Match polygon count to the target. Offline/film renders tolerate millions of polys; real-time budgets are tight (a hero prop might be a few thousand tris, a background object a few hundred). Use LEVELS OF DETAIL (LOD): swap to lower-poly versions as an object recedes, since distant pixels can't show the detail anyway. Bake fine detail from a high-poly sculpt into NORMAL/displacement maps on a low-poly mesh — get the silhouette from geometry and the surface detail from textures.`,
  },
  {
    name: "mesh-subdivision-surface",
    text: `Subdivision surface (Catmull-Clark) smooths a low-poly "cage" by repeatedly splitting each quad into four and averaging, converging to a smooth limit surface. Control sharpness by adding SUPPORTING EDGE LOOPS near an edge (tighter loops = sharper crease) or using edge crease weights, not by adding random geometry. Model the low cage cleanly; the subdivision does the smoothing. Apply/freeze the modifier only when you need the final dense mesh (e.g. for export or baking).`,
  },
  // ── Materials, textures, UVs ───────────────────────────────────────────────
  {
    name: "material-pbr-metal-rough",
    text: `Physically-Based Rendering (PBR) with the metal/roughness workflow describes a surface by: BASE COLOR (albedo — the diffuse color, with no baked lighting/shadows), METALLIC (0 for dielectrics like plastic/wood, 1 for bare metal; avoid in-between except at transitions), ROUGHNESS (0 mirror-smooth to 1 fully matte), plus NORMAL and ambient-occlusion maps. PBR values are grounded in real-world reflectance, so materials look correct under any lighting. Metals get their color from their reflection, not from base color diffuse.`,
  },
  {
    name: "material-color-space",
    text: `Keep textures in the correct COLOR SPACE or lighting goes wrong. Color/albedo maps are authored in sRGB and must be sampled as sRGB (decoded to linear before lighting). DATA maps — normal, roughness, metallic, height, AO — hold numbers, not colors, and must be treated as LINEAR/raw (no sRGB decode) or the values are distorted. Lighting math happens in linear space; the final image is encoded back to sRGB for display. Mixing these up gives washed-out or overly-dark results.`,
  },
  {
    name: "texture-normal-map",
    text: `A NORMAL map stores per-texel surface normals (encoded in RGB) so a low-poly mesh shows high-poly surface detail under lighting without the geometry. TANGENT-space normal maps (mostly bluish, the default) are relative to the surface and work on deforming/animated meshes; object-space maps are for static meshes. Watch the green-channel convention (OpenGL Y+ vs DirectX Y-) — a flipped green channel makes lighting look inverted. Bake normals from a high-poly source onto the low-poly's UVs.`,
  },
  {
    name: "uv-unwrapping",
    text: `UV UNWRAPPING flattens a 3D surface to 2D so textures map onto it. Place SEAMS where they'll hide (under arms, inside edges) to minimize visible distortion, then unwrap so the 2D islands have even, low stretch (a checker texture reveals stretching and inconsistent texel density). Pack islands to use the 0-1 UV space efficiently with padding/margin between them so mipmapping/bilinear filtering doesn't bleed neighbors. Consistent TEXEL DENSITY across a model keeps texture detail uniform.`,
  },
  {
    name: "texture-mipmaps-filtering",
    text: `MIPMAPS are precomputed down-scaled versions of a texture; the GPU samples the level matching the on-screen size, preventing shimmering/aliasing on distant or minified surfaces and improving cache performance. Enable trilinear/anisotropic filtering for smooth transitions and sharp grazing-angle textures. Give UV islands enough padding so lower mip levels don't blend across island borders. Power-of-two texture sizes historically mattered and still help mipmap/compression efficiency.`,
  },
  // ── Blender ────────────────────────────────────────────────────────────────
  {
    name: "blender-apply-transforms",
    text: `In Blender, APPLY transforms (Ctrl+A) before exporting or simulating so object-level scale/rotation are baked into the mesh data and the object's transform resets to identity/scale 1. Non-applied scale (especially non-uniform) breaks modifiers (bevel width, physics), normal maps, and export scale. A classic bug: a model looks fine but exports at the wrong size or with skewed bevels because its object scale was never applied. Apply rotation & scale routinely; keep location if you need a pivot.`,
  },
  {
    name: "blender-modifier-stack",
    text: `Blender modifiers are a NON-DESTRUCTIVE stack evaluated top to bottom on the base mesh — Mirror, Subdivision Surface, Bevel, Solidify, Boolean, Array, etc. Order matters: e.g. Mirror before Subdivision welds the seam smoothly; Subdivision before Bevel bevels the smoothed result. Keep them live while iterating and APPLY them (in order) only when you need the final geometry (for export or a destructive edit). Modifiers keep the source mesh clean and editable.`,
  },
  {
    name: "blender-origin-and-pivot",
    text: `An object's ORIGIN (the orange dot) is its pivot for rotation/scale and its reference for placement — it is independent of the mesh's geometry. Set it deliberately (Object > Set Origin): to geometry center, to the 3D cursor, or to a base point for stacking/animation. A misplaced origin makes objects rotate around the wrong point and snap incorrectly. For a door, put the origin on the hinge; for a wheel, at the axle. Origin placement is a modeling decision, not an afterthought.`,
  },
  {
    name: "blender-python-bpy",
    text: `Blender is scriptable through the bpy Python API: bpy.data holds datablocks (meshes, materials, objects), bpy.context is the current state (selection, active object, scene), and bpy.ops are the operator commands mirroring UI actions. Prefer editing bpy.data directly (create a mesh, link it to an object, link the object to a collection) over chaining bpy.ops, which depend on context and are slower/fragile in headless runs. Run headless with "blender --background --python script.py" for automation.`,
  },
  {
    name: "blender-shade-smooth-autosmooth",
    text: `"Shade Smooth" interpolates vertex normals for a smooth look; "Shade Flat" keeps facets. Real objects need BOTH — smooth curves with sharp edges. Use auto-smooth (a smoothing angle) or mark sharp edges so edges above the angle stay crisp while gentle curves smooth — this is how you get a beveled hard edge without it looking rounded or faceted. Without it, a smooth-shaded cube looks lumpy and a flat-shaded sphere looks blocky. Supporting bevel loops plus sharp marks give clean shading.`,
  },
  // ── Three.js / real-time ───────────────────────────────────────────────────
  {
    name: "threejs-scene-graph",
    text: `Three.js organizes a scene as a SCENE GRAPH: a tree of Object3D nodes (Mesh, Group, Light, Camera) where each child inherits its parent's transform (child world = parent world * child local). Group objects to move/rotate them together and to build articulated hierarchies (a robot arm). Setting object.position/rotation/scale edits the LOCAL transform; the renderer walks the graph each frame composing world matrices. Add/remove objects via parent.add()/remove().`,
  },
  {
    name: "threejs-mesh-geometry-material",
    text: `A Three.js Mesh = BufferGeometry (vertex attributes: position, normal, uv, index) + Material (how it shades: MeshStandardMaterial for PBR, MeshBasicMaterial for unlit). Geometry and material can be SHARED across many meshes to save memory. Choosing the right material matters: Basic ignores lights (good for UI/flat), Standard/Physical are PBR and need lights + often an environment map for reflections. Lambert/Phong are cheaper legacy lit materials.`,
  },
  {
    name: "threejs-dispose-resources",
    text: `Three.js does NOT garbage-collect GPU resources for you. When you remove a mesh you must call geometry.dispose(), material.dispose(), and texture.dispose() on anything no longer used, or you leak GPU memory until the context crashes. A render loop that creates new geometries/materials each frame without disposing the old ones is a classic memory leak. Reuse geometries/materials where possible; dispose explicitly when swapping models or tearing down a scene.`,
  },
  {
    name: "threejs-render-loop",
    text: `Drive Three.js animation with requestAnimationFrame (via renderer.setAnimationLoop), which syncs to the display refresh and pauses in background tabs. Make motion FRAME-RATE INDEPENDENT by scaling movement by delta time (seconds since last frame from a Clock), not by a fixed per-frame amount — otherwise the scene runs faster on a 144 Hz monitor than a 60 Hz one. Do heavy work off the main thread or amortize it; a slow frame stalls input and rendering together.`,
  },
  {
    name: "threejs-gltf-loading",
    text: `glTF (.gltf/.glb) is the standard runtime 3D format for the web — compact, PBR-native, Y-up meters — loaded with GLTFLoader. Use the binary .glb (geometry + textures in one file) for delivery; enable Draco/meshopt compression for large meshes and KTX2/basis for GPU-compressed textures. Loading is ASYNC: add the returned scene once loaded, and dispose it on unload. Prefer glTF over OBJ/FBX for the web because it carries materials, animations, and scene structure correctly.`,
  },
  {
    name: "threejs-raycasting-picking",
    text: `To detect what the user clicked in a 3D scene, use a Raycaster: convert the mouse position to normalized device coordinates (-1..1), set the ray from the camera through that point, and call intersectObjects to get hit meshes sorted by distance (nearest first). This is CPU picking — fine for moderate scenes; for huge scenes use GPU picking or spatial acceleration. The same ray math underlies shooting, placement, and hover highlighting.`,
  },
  {
    name: "realtime-instancing-draw-calls",
    text: `Each object drawn is roughly a DRAW CALL, and thousands of draw calls per frame bottleneck the CPU/driver. To render many copies of the same mesh (trees, bricks, particles) cheaply, use INSTANCING (InstancedMesh) — one geometry drawn N times with per-instance transforms in a single call. Also MERGE static geometry and share materials to cut draw calls, and use texture atlases. Reducing draw calls is usually a bigger real-time win than reducing polygon count.`,
  },
  {
    name: "render-z-fighting",
    text: `Z-FIGHTING is the flickering when two surfaces are nearly coplanar and the depth buffer can't decide which is in front. Causes: overlapping coincident faces, or a near/far clip range so wide that depth precision (which is non-linear, concentrated near the camera) is too coarse far away. Fixes: don't stack coplanar geometry (add a tiny offset or use polygon offset/decals), and tighten the near plane (raise near, lower far) since a tiny near plane wastes most depth precision.`,
  },
  {
    name: "render-culling",
    text: `Don't draw what you can't see. BACK-FACE culling skips triangles facing away (based on winding order) — nearly free and standard. FRUSTUM culling skips objects outside the camera's view volume. OCCLUSION culling skips objects hidden behind others. Engines do back-face and frustum culling automatically (keep bounding volumes correct), but you must model with consistent winding and reasonable object granularity so culling can help. Overdraw from transparent/overlapping surfaces is a common hidden cost.`,
  },
  // ── OpenGL / graphics pipeline ─────────────────────────────────────────────
  {
    name: "gl-graphics-pipeline",
    text: `The modern (OpenGL/WebGL/Vulkan) graphics pipeline is a fixed sequence of stages: vertex data → VERTEX SHADER (transforms each vertex to clip space, per-vertex) → primitive assembly (into triangles) → RASTERIZATION (triangles become fragments/candidate pixels, interpolating vertex outputs across the face) → FRAGMENT SHADER (computes each fragment's color, per-pixel) → per-fragment tests (depth, stencil, blending) → framebuffer. You program the vertex and fragment stages; the rest is configurable fixed-function. Understanding which work is per-vertex vs per-fragment is key to performance (fragment work runs far more often).`,
  },
  {
    name: "gl-shaders-glsl",
    text: `Shaders are small GPU programs written in GLSL (or HLSL/SPIR-V). The VERTEX shader runs once per vertex and must write the clip-space position (gl_Position); the FRAGMENT shader runs once per fragment and writes the output color. Data enters as ATTRIBUTES (per-vertex: position, normal, uv), constants come in as UNIFORMS (per-draw: matrices, light params, time), and the vertex shader passes interpolated data to the fragment shader via VARYINGS (out/in). Keep expensive math in the vertex shader when it can be interpolated instead of recomputed per fragment.`,
  },
  {
    name: "gl-vbo-vao-buffers",
    text: `Geometry lives in GPU buffers, not re-sent each frame. A VBO (Vertex Buffer Object) holds vertex attribute data in GPU memory; an EBO/index buffer holds triangle indices so shared vertices aren't duplicated; a VAO (Vertex Array Object) records the attribute layout (which buffer feeds which attribute, at what stride/offset) so you bind one VAO to set up a draw. Upload static geometry once (STATIC_DRAW) and reuse it; only stream data that actually changes (DYNAMIC_DRAW). Interleaving attributes in one VBO improves cache locality.`,
  },
  {
    name: "gl-depth-and-blending",
    text: `Two per-fragment tests decide the final pixel. The DEPTH TEST (z-buffer) keeps the nearest fragment so closer geometry hides farther — enable it for solid 3D, and remember opaque objects can be drawn in any order thanks to it. BLENDING combines a fragment with what's already there for transparency (src_alpha, one_minus_src_alpha); transparent surfaces do NOT sort themselves via the depth buffer, so you must draw them AFTER opaques and usually back-to-front, often with depth writes disabled. Getting transparency order wrong is the usual cause of see-through objects rendering incorrectly.`,
  },
  {
    name: "gl-framebuffers-postprocessing",
    text: `Rendering doesn't have to go straight to the screen. A FRAMEBUFFER OBJECT (FBO) lets you render into a texture instead, enabling render-to-texture effects: post-processing (bloom, tone mapping, FXAA/blur by sampling the rendered image in a full-screen pass), shadow maps (render depth from the light's view), reflections, and deferred shading (render geometry data to multiple targets, then light in screen space). Multiple render targets (MRT) write several outputs at once. Each extra full-screen pass costs fill-rate, so budget post-processing passes deliberately.`,
  },
];
