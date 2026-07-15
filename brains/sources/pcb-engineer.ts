/**
 * @file brains/sources/pcb-engineer.ts
 * @description Source content for the built-in **PCB & Schematics Engineer**
 * Brain Pack (Brains-Upgrade Phase 6 — "Team of Experts").
 *
 * A senior hardware design engineer: KiCad workflow, schematic capture,
 * footprints, PCB layout, routing, signal/power integrity, and design-for-
 * manufacture. GENERAL-PURPOSE electronics knowledge that applies to any board,
 * fab, or project. Original content, ships CC0. One durable fact per entry →
 * one retrieval chunk.
 */
import type { BrainFact } from "./_types.js";

export const PCB_ENGINEER_CHARTER = `You are augmented with a PCB & Schematics engineering brain. Follow these rules on every hardware task:

1. Schematic first, layout second. A clean, fully-annotated schematic that passes ERC is the source of truth; never start routing to "figure out" connectivity.
2. Respect the fab's design rules. Confirm minimum trace width, clearance, hole size, annular ring, and layer count against the manufacturer's capability sheet BEFORE routing — a beautiful board you can't manufacture is worthless.
3. Power and ground integrity are not optional. Every IC gets local decoupling; keep return paths short and continuous; never route a signal over a plane split.
4. Route for signal integrity: avoid 90-degree corners (use 45s or arcs), match lengths and impedance where the spec demands it, and keep high-speed signals away from noisy ones.
5. Design for manufacture and assembly: standard footprints, adequate courtyards, thermal reliefs on plane connections, fiducials for pick-and-place, and clear silkscreen that doesn't sit on pads.
6. Verify before release: DRC and ERC must pass cleanly; review the fab/assembly outputs (Gerbers, drill, BOM, pick-and-place) before sending.
7. Cite the corpus when you use it; prefer its specific guidance over a generic recollection, and surface any conflict rather than silently choosing.`;

export const PCB_ENGINEER_SOURCES: BrainFact[] = [
  // ── KiCad workflow ─────────────────────────────────────────────────────────
  {
    name: "kicad-drc-erc",
    text: `Two mandatory checks gate a KiCad design. ERC (Electrical Rule Check) runs on the schematic (.kicad_sch) and catches unconnected pins, conflicting outputs driving the same net, missing power flags, and unassigned symbols. DRC (Design Rule Check) runs on the board (.kicad_pcb) and catches clearance/width violations, unrouted nets, courtyard overlaps, and holes too small. Both MUST pass cleanly before generating manufacturing files — never ship a board with waived errors you don't understand.`,
  },
  {
    name: "kicad-power-flag",
    text: `In KiCad ERC, power input pins (like a regulator's VIN or an IC's VCC) expect to be driven by a power OUTPUT. If your supply comes from a connector or a net with no explicit driver, ERC reports "Input Power pin not driven by Output Power pin". Fix it by placing a PWR_FLAG symbol on that net to tell ERC the net is intentionally powered. Missing PWR_FLAGs are the most common false-positive ERC error.`,
  },
  {
    name: "kicad-symbol-vs-footprint",
    text: `A schematic SYMBOL is the logical part (pins, electrical type, reference designator); a FOOTPRINT is the physical land pattern (pads, courtyard, silkscreen) the part solders to. They are linked but separate libraries. A single symbol can map to many footprints (e.g. a resistor → 0402, 0603, 0805). Assign the correct footprint per part before layout; a wrong footprint (e.g. mismatched pinout or package) is a board-killing error that DRC cannot catch for you.`,
  },
  {
    name: "kicad-net-and-labels",
    text: `Connectivity in a schematic comes from wires AND labels — two pins on the same named net are connected even without a drawn wire. Use local labels for short intra-sheet nets, global labels or hierarchical labels to cross sheets, and net classes to assign width/clearance rules to groups of nets (e.g. a POWER class with wider traces). A typo in a label silently creates a separate net — a frequent, hard-to-see bug ERC may not flag.`,
  },
  {
    name: "kicad-export-outputs",
    text: `Standard fabrication/assembly outputs from KiCad: Gerbers (RS-274X) — one file per copper/mask/silk layer — plus an Excellon drill file for holes; a BOM (CSV/XML) listing parts, values, and footprints; and a pick-and-place / centroid file (CPL) with X/Y/rotation for each component. Schematics export to PDF/SVG for review, and a STEP model exports for mechanical/enclosure fit. Zip the Gerbers + drill for upload to the fab.`,
  },
  {
    name: "kicad-layer-naming",
    text: `KiCad copper layers follow a naming convention the toolchain relies on: F.Cu (front/top copper), B.Cu (bottom copper), and inner layers In1.Cu, In2.Cu, ... Non-copper layers include Edge.Cuts (the board outline — a closed loop defines the shape and is mandatory), F/B.SilkS (silkscreen), F/B.Mask (solder mask openings), F/B.Paste (stencil apertures), and F/B.Fab/CrtYd (documentation/courtyard). The Edge.Cuts outline must be a single closed contour or the fab cannot determine the board shape.`,
  },
  // ── Routing & design rules ─────────────────────────────────────────────────
  {
    name: "routing-avoid-90-degree",
    text: `Never route copper with 90-degree (right-angle) corners. Use 45-degree bends or curved/arc routing. Sharp inside corners create "acid traps" — during etching, etchant pools in the acute angle and can over-etch, narrowing or breaking the trace — and the abrupt geometry causes a small impedance discontinuity on fast signals. 45s (or teardrop/arc transitions at pads) etch cleanly and route more compactly.`,
  },
  {
    name: "routing-trace-width-current",
    text: `Trace width is set by current-carrying capacity and manufacturability, per IPC-2221. A rough rule for external 1 oz copper at a ~10 C rise: ~10-12 mils (0.25-0.3 mm) carries ~1 A; scale roughly with width and copper weight. Wider or more copper (2 oz) carries more current with less heating. Use an IPC trace-width calculator for the target current and temperature rise rather than guessing — an undersized power trace runs hot and can fail.`,
  },
  {
    name: "routing-typical-fab-limits",
    text: `Typical low-cost prototype fab capability (confirm against your fab's sheet): minimum trace width and clearance about 6 mil (0.15 mm) each, minimum drilled hole about 0.3 mm, minimum annular ring about 0.13 mm, and standard copper layer counts of 1, 2, 4, 6, 8. Default stackup is FR-4, Tg ~130-150C, 1.6 mm thickness, 1 oz finished copper, HASL or ENIG finish. Design to these limits by default and only push tighter (and pay more) when the design truly needs it.`,
  },
  {
    name: "routing-clearance-voltage",
    text: `Minimum spacing between conductors is set by manufacturability AND voltage. Beyond the fab's ~6 mil minimum, higher voltages need more creepage/clearance (per IPC-2221 spacing tables) to prevent arcing — e.g. mains-voltage nets may need several millimeters and even a milled slot. Keep high-voltage and low-voltage sections physically separated. Never let the default net-class clearance decide safety spacing on a high-voltage design.`,
  },
  {
    name: "routing-vias-tenting",
    text: `A via is a plated hole connecting layers. Types: through-hole (all layers), blind (outer to inner), buried (inner to inner) — blind/buried cost more. "Tenting" covers a via with solder mask to prevent solder wicking, shorts from debris, and corrosion; tent signal vias by default. Do NOT tent thermal or "via-in-pad" vias meant to be filled — those need filling/capping to avoid solder voids. Stitch ground vias around board edges and near high-speed returns.`,
  },
  {
    name: "routing-return-path",
    text: `Current flows in loops: every signal has a return current that, at higher frequencies, flows on the reference plane directly beneath the trace (path of least inductance). Never route a signal across a GAP or split in its reference plane — the return is forced to detour, creating a large loop that radiates EMI and degrades signal integrity. Keep an unbroken ground plane under high-speed traces, and if you must cross a split, add a stitching capacitor near the crossing.`,
  },
  {
    name: "routing-controlled-impedance",
    text: `High-speed and RF traces need controlled impedance (commonly 50 ohm single-ended, 90-100 ohm differential for USB/Ethernet). Impedance is set by trace width, the dielectric height to the reference plane, and the dielectric constant (Er ~4.3 for FR-4). Use the fab's stackup and an impedance calculator (or ask the fab for a controlled-impedance stackup) to pick the width. Route differential pairs tightly coupled and length-matched, and keep them on one reference layer.`,
  },
  {
    name: "routing-length-matching",
    text: `Parallel buses and differential pairs need length (really, propagation-delay) matching so bits arrive together. Match within the spec's skew budget (e.g. tens of mils for DDR, tighter for very high speed) using serpentine/accordion tuning. Match the two halves of a differential pair to each other first (intra-pair skew), then match pairs to the group. On FR-4, signals travel roughly 6 inches/ns — convert time-domain skew specs to a physical length tolerance.`,
  },
  {
    name: "routing-crosstalk-spacing",
    text: `Crosstalk is coupling between adjacent traces; reduce it with the "3W rule" — keep center-to-center spacing at least 3x the trace width for sensitive/high-speed nets — and by minimizing the parallel run length. Route adjacent signal layers ORTHOGONALLY (one layer mostly horizontal, the next vertical) to cut inter-layer coupling. A ground trace or plane between aggressor and victim (guard trace, tied to ground with vias) further isolates sensitive lines.`,
  },
  // ── Power & ground ─────────────────────────────────────────────────────────
  {
    name: "power-decoupling-caps",
    text: `Every IC power pin needs local decoupling: place a small ceramic capacitor (typically 100 nF / 0.1 uF) as close as physically possible to each VCC/VDD pin, with a short, low-inductance path to ground (via right at the pad). Add bulk capacitance (1-10 uF) per supply rail and near power entry. Decoupling supplies the fast transient current the IC demands so the rail doesn't sag; distance and via inductance kill its effectiveness, so proximity is everything.`,
  },
  {
    name: "power-plane-continuity",
    text: `Prefer solid, continuous power and ground planes over hand-routed power traces on multi-layer boards — planes give low impedance, good decoupling, and short return paths. Avoid slicing a plane with a long line of vias or a big cutout that forces return currents to detour (a "moat"). If you must split a power plane for multiple rails, do it deliberately and keep signals from crossing the split. A fractured ground plane is a top cause of EMI and signal-integrity failures.`,
  },
  {
    name: "power-star-ground",
    text: `Manage noisy and sensitive grounds so digital switching noise doesn't corrupt analog/RF. Use a single, low-impedance ground reference and, where needed, partition analog and digital ground regions that meet at one point (a star/single-point tie), typically under the mixed-signal converter. Keep noisy return currents out of sensitive ground. Don't create isolated ground islands connected by a thin neck carrying high current — that neck becomes a noise source.`,
  },
  {
    name: "power-thermal-relief",
    text: `Connect through-hole pads to a copper pour with THERMAL RELIEF spokes, not a solid flood. A pad tied directly into a large plane sinks so much heat during hand/wave soldering that the joint won't reflow properly, causing cold joints. Thermal relief (a few narrow spokes) lets the pad heat enough to solder while still connecting to the plane. High-current pads may trade some spokes for a solid connection — a deliberate thermal/electrical tradeoff.`,
  },
  {
    name: "power-thermal-vias",
    text: `Move heat from a hot component (regulator, power IC, LED) into copper with thermal vias: an array of vias under the exposed thermal pad conducting heat to an inner or bottom copper pour that acts as a heatsink. Fill or cap via-in-pad thermal vias to prevent solder wicking away during reflow (which starves the joint and leaves voids). More copper area and more vias lower thermal resistance; check the part's datasheet for the recommended thermal-pad via pattern.`,
  },
  // ── Footprints, assembly & DFM ─────────────────────────────────────────────
  {
    name: "dfm-footprint-courtyard",
    text: `A footprint's COURTYARD defines the keep-out envelope around a part (body + a small margin, per IPC-7351). Adequate courtyards prevent components from being placed too close to hand-solder, rework, or collide with neighbors, and DRC uses them to flag overlaps. Set courtyard-to-courtyard spacing appropriate to the assembly method — tighter for pure reflow, more generous where hand-soldering or rework is expected. Overlapping courtyards are a DFM red flag.`,
  },
  {
    name: "dfm-silkscreen-rules",
    text: `Silkscreen must never sit on top of exposed copper/pads — the ink can prevent solder wetting and is often removed by the fab anyway. Keep silk off pads and mask openings, use a minimum line width and text height the fab supports (commonly ~6 mil line, ~32 mil text), and keep reference designators readable and near their parts. Add polarity/pin-1 markers, a board name/rev, and orientation indicators. Cluttered or on-pad silk is a common, avoidable DFM issue.`,
  },
  {
    name: "dfm-fiducials",
    text: `Add fiducial markers so automated assembly can align the board: global fiducials (typically 3, in an asymmetric pattern near board corners) for overall registration, and local fiducials next to fine-pitch parts (BGA/QFN) for precise placement. A fiducial is a small exposed-copper dot (~1 mm) with a mask keep-out ring around it. Boards without fiducials force slower/less accurate placement — include them whenever the board will be machine-assembled.`,
  },
  {
    name: "dfm-solder-mask-paste",
    text: `Three related but distinct layers around a pad: copper (the pad), solder MASK (the opening exposing copper — with a small "mask expansion" so mask doesn't creep onto the pad), and solder PASTE/stencil (the aperture that deposits solder paste for reflow). Solder-mask-defined vs copper-defined pads matter for fine-pitch BGAs. For large thermal pads, use a windowpane paste pattern (multiple small apertures ~50-80% coverage) instead of one big opening to avoid excess paste, tombstoning, and voids.`,
  },
  {
    name: "dfm-component-orientation",
    text: `Ease assembly and inspection: align passives to a consistent grid and orientation, keep polarized parts (diodes, electrolytics, tantalums, connectors) marked and ideally oriented the same way, and leave room for pick-and-place nozzles and rework tools. Avoid placing tall parts where they block access to nearby joints. Consistent orientation reduces placement errors, speeds optical inspection, and simplifies the pick-and-place file — a real yield and cost factor.`,
  },
  {
    name: "dfm-panelization",
    text: `Small boards are usually PANELIZED (arrayed into a larger panel) for efficient assembly, then separated. Common methods: V-scoring (a straight groove for rectangular boards, snapped apart) and tab routing with mouse-bites (perforated tabs for irregular outlines). Leave rail/edge clearance for conveyor grip and fiducials on the rails. Keep components back from V-score lines (stress cracks) and board edges. Decide panelization with the assembler; it affects the outline and part placement.`,
  },
  // ── Components & schematic practice ────────────────────────────────────────
  {
    name: "sch-pullup-pulldown",
    text: `Digital inputs must never float — a floating CMOS input drifts and can oscillate, drawing current and behaving randomly. Tie unused/idle inputs to a defined level with a pull-up or pull-down resistor (commonly 10k for general logic, 4.7k for I2C, matched to the bus). Reset lines, enable pins, and bus lines (I2C SDA/SCL) need pull-ups; mode/config pins need a defined level. Size pull-ups against bus capacitance and speed for open-drain buses.`,
  },
  {
    name: "sch-series-termination",
    text: `Fast digital edges on a transmission-line-length trace reflect off an impedance mismatch, causing ringing and overshoot. Series (source) termination — a small resistor (e.g. 22-33 ohm) right at the driver — slows the edge and matches the driver to the line impedance, taming reflections on point-to-point signals like clocks and SPI. Parallel/AC termination is used at the receiver for buses. Place the series resistor close to the source, not the load.`,
  },
  {
    name: "sch-crystal-load-caps",
    text: `A crystal oscillator needs two load capacitors (from each crystal pin to ground) sized to present the crystal's specified LOAD CAPACITANCE (CL): C_each ≈ 2*(CL - C_stray), where C_stray includes pin and PCB parasitics (~2-5 pF). Wrong load caps pull the frequency off or prevent startup. Keep the crystal and its caps close to the MCU oscillator pins, guard the traces with ground, and keep noisy signals away — layout strongly affects oscillator reliability.`,
  },
  {
    name: "sch-esd-protection",
    text: `Any connector exposed to the outside world (USB, buttons, headers) needs ESD protection: place TVS diodes on the exposed lines to shunt static discharge to ground before it reaches sensitive ICs. Put the TVS right at the connector (short path to ground) so the surge is clamped at entry. For high-speed lines (USB), use low-capacitance TVS parts so they don't distort the signal. Series resistors/ferrites add further protection on slower lines.`,
  },
  {
    name: "sch-reverse-polarity",
    text: `Protect a board from a reversed power connection. A series Schottky diode is simple but wastes voltage (its forward drop) and power. A P-channel MOSFET in the supply line (source to input, gate to ground through a resistor) gives near-lossless reverse-polarity protection: it conducts on correct polarity and blocks on reversal. Add input bulk capacitance and a fuse/polyfuse for over-current. Reverse-polarity and over-current protection are cheap insurance against field failures.`,
  },
  {
    name: "sch-designators-and-values",
    text: `Give every part a unique reference designator by class (R for resistors, C for capacitors, U for ICs, D for diodes, Q for transistors, J for connectors, Y/X for crystals, L for inductors) and a clear value/part number. Annotate the schematic so designators are sequential and match the board. A complete BOM ties each designator to a manufacturer part number — never leave a part "TBD" into layout, because its footprint and pinout drive the board.`,
  },
  {
    name: "layout-place-before-route",
    text: `Placement determines routability — spend time on it before routing. Group by function (power section, analog, digital, RF), place connectors and mechanically-constrained parts first, put decoupling caps against their ICs, and keep high-speed/sensitive nets short by placing their endpoints close. Orient parts to minimize crossing nets. A good placement makes routing almost fall out; a bad placement forces vias, long detours, and compromised signal integrity no amount of clever routing can fix.`,
  },
  {
    name: "layout-copper-pour-stitching",
    text: `Fill unused board area with a ground copper pour on outer layers and stitch it to the ground plane with vias on a grid — this lowers ground impedance, improves shielding, and helps with thermal spreading and EMI. Stitch pours to the plane frequently (not just one connection), add a via fence along board edges and around high-speed sections, and ensure the pour doesn't create isolated copper islands (which act as floating antennas). Check the pour actually connects after any layout change.`,
  },
  // ── RF & analog ────────────────────────────────────────────────────────────
  {
    name: "rf-impedance-matching-50ohm",
    text: `RF systems are built around a characteristic impedance — 50 ohm is the ubiquitous standard for coax and PCB RF (75 ohm for video/broadcast). Match the source, transmission line, and load impedance to minimize reflected power: a mismatch sends energy back (measured as VSWR / return loss) and wastes transmit power or corrupts the received signal. A quarter-wave ground-plane (monopole) antenna presents roughly 50 ohm at its feed, which is why it pairs with 50 ohm coax. Use matching networks (L-networks, quarter-wave transformers, or stubs) to transform an impedance to 50 ohm.`,
  },
  {
    name: "rf-quarter-wave-transformer",
    text: `A quarter-wavelength transmission line acts as an impedance transformer: a line of length λ/4 and characteristic impedance Zt transforms a load Zl to Zin = Zt² / Zl at its input. Choosing Zt = sqrt(Zsource * Zload) matches two real impedances (e.g. sqrt(50*100) ≈ 70.7 ohm to match 50 to 100 ohm). It is narrowband (only exact at the design frequency, where λ depends on the dielectric's velocity factor). Antenna feeds, patch antennas, and matching stubs all exploit this quarter-wave behavior.`,
  },
  {
    name: "comp-bjt-basics",
    text: `A bipolar junction transistor (BJT) is a current-controlled device: a small BASE current controls a larger COLLECTOR current (Ic ≈ β·Ib, β/hFE often 100-300). NPN turns on when the base is ~0.7 V above the emitter (current flows collector→emitter); PNP is the complement (base ~0.7 V BELOW emitter, current emitter→collector), used for high-side switching. As a saturated switch, drive enough base current (Ib > Ic/β) so Vce_sat is low; as an amplifier, bias it in the active region. Always add a base resistor to limit base current.`,
  },
  {
    name: "comp-common-transistors",
    text: `Know the jellybean small-signal transistors so you can pick one from memory: the 2N3904 (NPN) / 2N3906 (PNP) and BC547/BC557, BC337/BC327 pairs handle general switching/amplification up to a few hundred mA; the 2N2222 (NPN) / 2N2907 (PNP) push a bit more current; S8050 (NPN)/S8550 (PNP) are common higher-current jellybeans; 2N7000/BS170 are small logic-level N-channel MOSFETs. Watch PACKAGE PINOUT — a TO-92 2N3904 (EBC) and a BC547 (CBE) have DIFFERENT pin orders, a frequent breadboard/footprint bug.`,
  },
  {
    name: "comp-mosfet-vs-bjt-switch",
    text: `For switching a load, a MOSFET is usually better than a BJT: it is VOLTAGE-controlled (drives from a gate voltage with ~no steady gate current) and has very low on-resistance (Rds_on), so it dissipates less heat than a saturated BJT's Vce_sat drop at high current. Use a LOGIC-LEVEL MOSFET if driving from 3.3/5 V logic (ordinary MOSFETs need ~10 V on the gate to fully turn on). Add a gate resistor (limit inrush) and a pull-down (keep it off during MCU reset). For low-side switching use N-channel; high-side wants P-channel or a gate-driver/charge pump.`,
  },
];
