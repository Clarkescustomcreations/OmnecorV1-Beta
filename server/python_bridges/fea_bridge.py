# ============================================================
# File: fea_bridge.py
# Purpose:
#   Real finite-element analysis for Omnecor Blueprint Studio.
#
#   Pipeline:
#     1. Gmsh tet-meshes a closed STL surface (mm units)
#     2. TET4 linear-static elasticity assembled with numpy/scipy
#        (consistent mm-N-MPa unit system: E in MPa, force in N,
#         displacements come out in mm, stresses in MPa)
#     3. Von Mises stress per element -> nodal field for the
#        client heatmap overlay + a JSON summary on stdout
#
# Dependencies (pip): gmsh numpy scipy
#   Missing deps are reported as a structured JSON error with an
#   install hint -- the Node side surfaces it verbatim.
#
# Usage:
#   python fea_bridge.py --input request.json --output field.json
#
# request.json (see shared/blueprint.ts FeaRequest, with stlPath
# resolved server-side):
#   {
#     "stlPath": "/abs/path/part.stl",
#     "elasticModulusMPa": 3500, "poissonRatio": 0.36,
#     "densityKgM3": 1240, "strengthMPa": 60,
#     "fixture": {"kind": "min_z", "tolMm": 1.0},
#     "load": {"region": {"kind": "max_z", "tolMm": 1.0},
#              "forceN": [0, 0, -500]},
#     "includeGravity": false,
#     "meshSizeMm": 0  (0/absent = auto: bbox diagonal / 30)
#   }
#
# stdout: one strict-JSON line (summary). The nodal field data is
# written to --output (positions, tets, displacement, von Mises).
# ============================================================

import argparse
import json
import sys
import traceback


def emit(payload):
    print(json.dumps(payload), flush=True)


def fail(message, hint=None):
    emit({"status": "failed", "error": message, **({"hint": hint} if hint else {})})
    sys.exit(0)  # structured failure, not a crash


def select_nodes(coords, region, bounds):
    """Nodes matching an axis-aligned region selector (see FeaRegion)."""
    import numpy as np

    kind = region.get("kind", "min_z")
    tol = float(region.get("tolMm", 1.0) or 1.0)
    (minc, maxc) = bounds
    if kind == "box":
        box = region.get("box") or {}
        lo = np.array(box.get("min", minc), dtype=float)
        hi = np.array(box.get("max", maxc), dtype=float)
        mask = np.all((coords >= lo - 1e-9) & (coords <= hi + 1e-9), axis=1)
        return np.where(mask)[0]
    axis = {"x": 0, "y": 1, "z": 2}[kind.split("_")[1]]
    if kind.startswith("min"):
        return np.where(coords[:, axis] <= minc[axis] + tol)[0]
    return np.where(coords[:, axis] >= maxc[axis] - tol)[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        req = json.load(f)

    # ── Dependencies ────────────────────────────────────────────────
    try:
        import numpy as np
        from scipy.sparse import coo_matrix
        from scipy.sparse.linalg import spsolve
    except ImportError as e:
        fail(
            f"Python FEA dependencies missing: {e}",
            hint="pip install gmsh numpy scipy",
        )
    try:
        import gmsh
    except ImportError as e:
        fail(
            f"Gmsh python module missing: {e}",
            hint="pip install gmsh numpy scipy",
        )

    # ── Mesh the STL with Gmsh ──────────────────────────────────────
    stl_path = req["stlPath"]
    mesh_size = float(req.get("meshSizeMm") or 0)

    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.merge(stl_path)
        # Reconstruct a geometry from the STL surface so a volume can be built.
        gmsh.model.mesh.classifySurfaces(40 * 3.14159 / 180, True, True)
        gmsh.model.mesh.createGeometry()
        surfaces = gmsh.model.getEntities(2)
        if not surfaces:
            fail("STL produced no surfaces — is the file a valid closed solid?")
        loop = gmsh.model.geo.addSurfaceLoop([s[1] for s in surfaces])
        gmsh.model.geo.addVolume([loop])
        gmsh.model.geo.synchronize()

        # Auto mesh size: bbox diagonal / 30 (capped element count comes from this).
        xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(-1, -1)
        diag = ((xmax - xmin) ** 2 + (ymax - ymin) ** 2 + (zmax - zmin) ** 2) ** 0.5
        if mesh_size <= 0:
            mesh_size = diag / 30.0
        gmsh.option.setNumber("Mesh.MeshSizeMax", mesh_size)
        gmsh.option.setNumber("Mesh.MeshSizeMin", mesh_size / 4.0)
        gmsh.model.mesh.generate(3)

        node_tags, node_coords, _ = gmsh.model.mesh.getNodes()
        coords = np.array(node_coords, dtype=float).reshape(-1, 3)
        # Compact node numbering (gmsh tags are 1-based and can be sparse).
        tag_to_idx = {int(t): i for i, t in enumerate(node_tags)}

        elem_types, elem_tags, elem_node_tags = gmsh.model.mesh.getElements(3)
        tets = None
        for etype, enodes in zip(elem_types, elem_node_tags):
            if etype == 4:  # 4-node tetrahedron
                tets = np.array([tag_to_idx[int(t)] for t in enodes], dtype=int).reshape(-1, 4)
                break
        if tets is None or len(tets) == 0:
            fail("Meshing produced no tetrahedra — the STL may not be watertight.")
    finally:
        gmsh.finalize()

    n_nodes = coords.shape[0]
    n_elems = tets.shape[0]
    if n_elems > 400000:
        fail(
            f"Mesh too large ({n_elems} elements). Increase meshSizeMm (currently {mesh_size:.2f}) to coarsen."
        )

    # ── Material matrix (isotropic linear elasticity) ───────────────
    E = float(req["elasticModulusMPa"])
    nu = float(req.get("poissonRatio", 0.33))
    rho = float(req.get("densityKgM3", 1000.0))
    strength = float(req.get("strengthMPa", 0)) or None

    lam = E * nu / ((1 + nu) * (1 - 2 * nu))
    mu = E / (2 * (1 + nu))
    D = np.array(
        [
            [lam + 2 * mu, lam, lam, 0, 0, 0],
            [lam, lam + 2 * mu, lam, 0, 0, 0],
            [lam, lam, lam + 2 * mu, 0, 0, 0],
            [0, 0, 0, mu, 0, 0],
            [0, 0, 0, 0, mu, 0],
            [0, 0, 0, 0, 0, mu],
        ],
        dtype=float,
    )

    # ── Assemble global stiffness (TET4, constant strain) ──────────
    ndof = 3 * n_nodes
    rows_list, cols_list, vals_list = [], [], []
    B_store = np.zeros((n_elems, 6, 12), dtype=float)
    vol_store = np.zeros(n_elems, dtype=float)
    F = np.zeros(ndof, dtype=float)

    g_body = None
    if req.get("includeGravity"):
        # rho [kg/m^3] * 9.80665 [m/s^2] -> N/m^3 -> * 1e-9 -> N/mm^3, acting -Z
        g_body = rho * 9.80665 * 1e-9

    for e in range(n_elems):
        n_ids = tets[e]
        p = coords[n_ids]  # 4x3
        M = np.hstack([np.ones((4, 1)), p])  # 4x4
        detM = np.linalg.det(M)
        V = abs(detM) / 6.0
        if V < 1e-12:
            continue
        vol_store[e] = V
        Minv = np.linalg.inv(M)
        # Shape-function gradients: rows 1..3 of Minv are d/dx,d/dy,d/dz per node col.
        grads = Minv[1:4, :]  # 3x4  (b_i, c_i, d_i)
        B = np.zeros((6, 12), dtype=float)
        for i in range(4):
            bx, by, bz = grads[0, i], grads[1, i], grads[2, i]
            B[0, 3 * i] = bx
            B[1, 3 * i + 1] = by
            B[2, 3 * i + 2] = bz
            B[3, 3 * i] = by
            B[3, 3 * i + 1] = bx
            B[4, 3 * i + 1] = bz
            B[4, 3 * i + 2] = by
            B[5, 3 * i] = bz
            B[5, 3 * i + 2] = bx
        B_store[e] = B
        Ke = V * (B.T @ D @ B)  # 12x12
        dofs = np.array([[3 * n + k for k in range(3)] for n in n_ids]).ravel()
        rows_list.append(np.repeat(dofs, 12))
        cols_list.append(np.tile(dofs, 12))
        vals_list.append(Ke.ravel())
        if g_body is not None:
            # Lump the element's gravity load equally to its 4 nodes (−Z).
            fz = -g_body * V / 4.0
            for n in n_ids:
                F[3 * n + 2] += fz

    K = coo_matrix(
        (np.concatenate(vals_list), (np.concatenate(rows_list), np.concatenate(cols_list))),
        shape=(ndof, ndof),
    ).tocsr()

    # ── Boundary conditions ─────────────────────────────────────────
    bounds = (coords.min(axis=0), coords.max(axis=0))
    fixed_nodes = select_nodes(coords, req.get("fixture", {"kind": "min_z"}), bounds)
    if len(fixed_nodes) == 0:
        fail("Fixture region selected no nodes — increase tolMm or check the region.")
    load_cfg = req.get("load") or {}
    load_nodes = select_nodes(coords, load_cfg.get("region", {"kind": "max_z"}), bounds)
    if len(load_nodes) == 0:
        fail("Load region selected no nodes — increase tolMm or check the region.")
    force = np.array(load_cfg.get("forceN", [0, 0, 0]), dtype=float)
    per_node = force / float(len(load_nodes))
    for n in load_nodes:
        F[3 * n : 3 * n + 3] += per_node

    fixed_dofs = np.array([[3 * n + k for k in range(3)] for n in fixed_nodes]).ravel()
    free = np.ones(ndof, dtype=bool)
    free[fixed_dofs] = False
    free_idx = np.where(free)[0]

    # ── Solve ───────────────────────────────────────────────────────
    u = np.zeros(ndof, dtype=float)
    try:
        u[free_idx] = spsolve(K[free_idx][:, free_idx], F[free_idx])
    except Exception as e:  # singular matrix etc.
        fail(f"Linear solve failed: {e}. The part may be under-constrained (rigid-body motion).")

    if not np.all(np.isfinite(u)):
        fail("Solution contains non-finite values — the model is likely under-constrained.")

    # ── Post-process: von Mises per element -> nodal average ───────
    vm_elem = np.zeros(n_elems, dtype=float)
    for e in range(n_elems):
        if vol_store[e] <= 0:
            continue
        dofs = np.array([[3 * n + k for k in range(3)] for n in tets[e]]).ravel()
        stress = D @ (B_store[e] @ u[dofs])  # [sx, sy, sz, txy, tyz, tzx]
        sx, sy, sz, txy, tyz, tzx = stress
        vm_elem[e] = (
            0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2)
            + 3.0 * (txy**2 + tyz**2 + tzx**2)
        ) ** 0.5

    vm_node = np.zeros(n_nodes, dtype=float)
    vm_count = np.zeros(n_nodes, dtype=float)
    for e in range(n_elems):
        for n in tets[e]:
            vm_node[n] += vm_elem[e]
            vm_count[n] += 1.0
    vm_node = vm_node / np.maximum(vm_count, 1.0)

    disp_mag = np.sqrt(np.sum(u.reshape(-1, 3) ** 2, axis=1))
    max_vm = float(vm_elem.max()) if n_elems else 0.0
    max_disp = float(disp_mag.max()) if n_nodes else 0.0
    safety = (strength / max_vm) if (strength and max_vm > 0) else None

    # Field data for the client heatmap overlay.
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(
            {
                "positions": coords.ravel().tolist(),
                "tets": tets.ravel().tolist(),
                "displacementMm": u.reshape(-1, 3).tolist(),
                "vonMisesMPa": vm_node.tolist(),
                "maxVonMisesMPa": max_vm,
                "maxDisplacementMm": max_disp,
            },
            f,
        )

    emit(
        {
            "status": "completed",
            "maxVonMisesMPa": round(max_vm, 4),
            "maxDisplacementMm": round(max_disp, 5),
            "safetyFactor": round(safety, 3) if safety is not None else None,
            "nodeCount": int(n_nodes),
            "elementCount": int(n_elems),
            "meshSizeMm": round(mesh_size, 3),
            "fixedNodes": int(len(fixed_nodes)),
            "loadedNodes": int(len(load_nodes)),
        }
    )


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        emit({"status": "failed", "error": traceback.format_exc(limit=6)})
