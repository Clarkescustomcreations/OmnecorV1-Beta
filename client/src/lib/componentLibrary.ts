/**
 * Component Library for PCB/Schematic Editor
 *
 * ~50 real-world components across 9 categories.
 * Serves dual purpose: placement palette for user designs,
 * and an AI reference catalog of available components.
 */

export interface Component {
  id: string;
  name: string;
  category: string;
  description: string;
  symbolSvg: string;
  footprintSvg: string;
  tags: string[];
  manufacturer?: string;
  partNumber?: string;
  footprintWidth?: number;
  footprintHeight?: number;
  symbolWidth?: number;
  symbolHeight?: number;
  properties: Record<string, unknown>;
  handles: Array<{ id: string; position?: string; type?: string; x?: number; y?: number }>;
}

// ─── SVG helpers ─────────────────────────────────────────────────────────────
const IC_BODY = '<rect x="5" y="3" width="14" height="18" fill="none" stroke="currentColor" stroke-width="2"/>';
const IC_8PIN = `${IC_BODY}<path d="M1 5h4m-4 4h4m-4 4h4m-4 4h4M19 5h4m-4 4h4m-4 4h4m-4 4h4" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
const IC_4PIN = `${IC_BODY}<path d="M1 7h4m-4 5h4m-4 5h4M19 7h4M19 12h4M19 17h4" fill="none" stroke="currentColor" stroke-width="1.5"/>`;

export const componentLibrary: Component[] = [

  // ═══════════════════════════════════════════════════════════════
  // PASSIVE
  // ═══════════════════════════════════════════════════════════════
  {
    id: "res-001",
    name: "Resistor",
    category: "Passive",
    description: "Generic resistor — 0805 SMD",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h3l2-5 4 10 4-10 2 5h5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["resistor", "passive", "0805", "R"],
    properties: { resistance: "10k", tolerance: "5%", power: "0.125W", package: "0805" },
    handles: [{ id: "p1", x: 0, y: 12 }, { id: "p2", x: 24, y: 12 }],
  },
  {
    id: "res-network",
    name: "Resistor Network",
    category: "Passive",
    description: "4-resistor SIP network — 10-pin",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 4v3l2-1.5 2 3-2 1.5L8 9v3l2-1.5 2 3-2 1.5L8 14v6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="2" y="8" width="20" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["resistor network", "SIP", "passive"],
    properties: { resistance: "10k", package: "SIP-10" },
    handles: Array.from({ length: 10 }, (_, i) => ({ id: `p${i + 1}`, x: i < 5 ? 0 : 24, y: (i % 5) * 5 + 2 })),
  },
  {
    id: "cap-001",
    name: "Capacitor",
    category: "Passive",
    description: "Ceramic capacitor — 0805 SMD",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h8m4 0h8M10 5v14m4-14v14" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="6" y="8" width="12" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["capacitor", "ceramic", "passive", "0805", "C"],
    properties: { capacitance: "100nF", voltage: "16V", package: "0805" },
    handles: [{ id: "p1", x: 0, y: 12 }, { id: "p2", x: 24, y: 12 }],
  },
  {
    id: "cap-elec",
    name: "Electrolytic Cap",
    category: "Passive",
    description: "Polarized electrolytic capacitor",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h8m4 0h8M10 5v14m4-14v14" fill="none" stroke="currentColor" stroke-width="2"/><text x="5" y="9" font-size="6" fill="currentColor">+</text></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12h4M12 8v4" stroke="currentColor" stroke-width="1.5"/></svg>',
    tags: ["electrolytic", "polarized", "capacitor", "passive"],
    properties: { capacitance: "100µF", voltage: "25V", package: "THT-5mm" },
    handles: [{ id: "+", x: 0, y: 12 }, { id: "-", x: 24, y: 12 }],
  },
  {
    id: "ind-001",
    name: "Inductor",
    category: "Passive",
    description: "SMD power inductor — 0805",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h2M20 12h2M4 12c0-2 2-2 2 0s2 2 2 0 2-2 2 0 2 2 2 0 2-2 2 0" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["inductor", "passive", "coil", "L"],
    properties: { inductance: "10µH", current: "1A", package: "0805" },
    handles: [{ id: "p1", x: 0, y: 12 }, { id: "p2", x: 24, y: 12 }],
  },
  {
    id: "xtal-001",
    name: "Crystal",
    category: "Passive",
    description: "Quartz crystal oscillator — HC-49S",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h5m10 0h5M7 6v12h10V6z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["crystal", "oscillator", "clock", "XTAL"],
    properties: { frequency: "16MHz", load_capacitance: "18pF", package: "HC-49S" },
    handles: [{ id: "p1", x: 0, y: 12 }, { id: "p2", x: 24, y: 12 }],
  },
  {
    id: "fuse-001",
    name: "Fuse",
    category: "Passive",
    description: "Resetable polyfuse — 500mA",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h4m12 0h4M6 12l2-3 4 6 4-6 2 3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5" y="9" width="14" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="9" width="16" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["fuse", "protection", "polyfuse", "F"],
    properties: { current: "500mA", voltage: "60V", package: "1812" },
    handles: [{ id: "p1", x: 0, y: 12 }, { id: "p2", x: 24, y: 12 }],
  },

  // ═══════════════════════════════════════════════════════════════
  // DISCRETE
  // ═══════════════════════════════════════════════════════════════
  {
    id: "diode-001",
    name: "Diode",
    category: "Discrete",
    description: "General purpose diode — 1N4148",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h7m13 0h-7M9 6l6 6-6 6z" fill="none" stroke="currentColor" stroke-width="2"/><line x1="15" y1="6" x2="15" y2="18" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="9" width="16" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["diode", "1N4148", "switching", "D"],
    properties: { forward_voltage: "0.7V", reverse_voltage: "100V", package: "SOD-123" },
    handles: [{ id: "A", x: 0, y: 12 }, { id: "K", x: 24, y: 12 }],
  },
  {
    id: "diode-schottky",
    name: "Schottky Diode",
    category: "Discrete",
    description: "Low forward voltage — SS14",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h7m13 0h-7M9 6l6 6-6 6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 6l2 0m0 0l0 12m0 0l2 0" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="9" width="16" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["schottky", "diode", "SS14", "D"],
    properties: { forward_voltage: "0.3V", current: "1A", package: "SMA" },
    handles: [{ id: "A", x: 0, y: 12 }, { id: "K", x: 24, y: 12 }],
  },
  {
    id: "diode-zener",
    name: "Zener Diode",
    category: "Discrete",
    description: "Voltage reference / clamp — 5.1V",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h7m13 0h-7M9 6l6 6-6 6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 6l-2-2m2 2l0 12m0 0l2 2" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="9" width="16" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["zener", "diode", "voltage reference", "D"],
    properties: { voltage: "5.1V", power: "500mW", package: "SOD-123" },
    handles: [{ id: "A", x: 0, y: 12 }, { id: "K", x: 24, y: 12 }],
  },
  {
    id: "bjt-npn",
    name: "NPN Transistor",
    category: "Discrete",
    description: "NPN BJT — 2N2222 / BC547",
    symbolSvg: '<svg viewBox="0 0 24 24"><line x1="8" y1="4" x2="8" y2="20" stroke="currentColor" stroke-width="2"/><path d="M2 12h6M8 8l8-4v0M8 16l8 4v0" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 14l2 2" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["NPN", "transistor", "BJT", "Q"],
    properties: { Vce: "40V", Ic: "200mA", hFE: "100-300", package: "TO-92" },
    handles: [{ id: "B", x: 0, y: 12 }, { id: "C", x: 24, y: 6 }, { id: "E", x: 24, y: 18 }],
  },
  {
    id: "bjt-pnp",
    name: "PNP Transistor",
    category: "Discrete",
    description: "PNP BJT — 2N2907 / BC557",
    symbolSvg: '<svg viewBox="0 0 24 24"><line x1="8" y1="4" x2="8" y2="20" stroke="currentColor" stroke-width="2"/><path d="M2 12h6M8 8l8-4v0M8 16l8 4v0" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 10l-2-2" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["PNP", "transistor", "BJT", "Q"],
    properties: { Vce: "-40V", Ic: "-200mA", package: "TO-92" },
    handles: [{ id: "B", x: 0, y: 12 }, { id: "C", x: 24, y: 6 }, { id: "E", x: 24, y: 18 }],
  },
  {
    id: "mosfet-n",
    name: "N-Channel MOSFET",
    category: "Discrete",
    description: "N-channel enhancement MOSFET — 2N7002 / IRLZ44N",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M6 4v16M2 12h4M6 7l6 0M6 12l6 0M6 17l6 0M12 7v3M12 14v3M16 12h6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 10l2 2-2 2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["MOSFET", "N-channel", "FET", "switching", "Q"],
    properties: { Vds: "60V", Id: "10A", Rds_on: "0.04Ω", package: "TO-220" },
    handles: [{ id: "G", x: 0, y: 12 }, { id: "D", x: 24, y: 4 }, { id: "S", x: 24, y: 20 }],
  },
  {
    id: "mosfet-p",
    name: "P-Channel MOSFET",
    category: "Discrete",
    description: "P-channel enhancement MOSFET — AO3401",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M6 4v16M2 12h4M6 7l6 0M6 12l6 0M6 17l6 0M12 7v3M12 14v3M16 12h6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 12l-2-2 2-2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["MOSFET", "P-channel", "FET", "Q"],
    properties: { Vds: "-30V", Id: "-4A", package: "SOT-23" },
    handles: [{ id: "G", x: 0, y: 12 }, { id: "D", x: 24, y: 4 }, { id: "S", x: 24, y: 20 }],
  },
  {
    id: "led-001",
    name: "LED",
    category: "Discrete",
    description: "Generic LED — 0805 red/green/blue",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h4l4-6v12l-4-6M12 6v12M14 8l2-2M16 10l2-2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["LED", "diode", "light", "opto"],
    properties: { color: "Red", forward_voltage: "2.0V", current: "20mA", package: "0805" },
    handles: [{ id: "A", x: 0, y: 12 }, { id: "K", x: 24, y: 12 }],
  },
  {
    id: "optocoupler",
    name: "Optocoupler",
    category: "Discrete",
    description: "Optocoupler — PC817 / EL817",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_4PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["optocoupler", "isolation", "opto", "PC817"],
    properties: { CTR: "50-300%", Viso: "5000V", package: "DIP-4" },
    handles: [{ id: "A", x: 0, y: 7 }, { id: "K", x: 0, y: 12 }, { id: "C", x: 24, y: 7 }, { id: "E", x: 24, y: 17 }],
  },

  // ═══════════════════════════════════════════════════════════════
  // POWER
  // ═══════════════════════════════════════════════════════════════
  {
    id: "vreg-7805",
    name: "Reg 7805 (5V)",
    category: "Power",
    description: "Linear 5V regulator — LM7805",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_4PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["regulator", "5V", "linear", "LM7805", "power"],
    properties: { output: "5V", current: "1.5A", dropout: "2V", package: "TO-220" },
    handles: [{ id: "IN", x: 0, y: 8 }, { id: "GND", x: 0, y: 16 }, { id: "OUT", x: 24, y: 12 }],
  },
  {
    id: "vreg-ams1117-33",
    name: "LDO AMS1117-3.3",
    category: "Power",
    description: "LDO 3.3V regulator — AMS1117",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_4PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["LDO", "3.3V", "regulator", "AMS1117", "power"],
    properties: { output: "3.3V", current: "800mA", dropout: "1.3V", package: "SOT-223" },
    handles: [{ id: "GND", x: 0, y: 8 }, { id: "OUT", x: 0, y: 16 }, { id: "IN", x: 24, y: 12 }],
  },
  {
    id: "buck-mp2307",
    name: "Buck Converter MP2307",
    category: "Power",
    description: "3A synchronous buck — MP2307DN",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_8PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["buck", "DCDC", "switching", "MP2307", "power"],
    properties: { input: "4.75-23V", output: "0.925-20V", current: "3A", package: "SOIC-8" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 5 + 4 })),
  },
  {
    id: "tp4056",
    name: "LiPo Charger TP4056",
    category: "Power",
    description: "1A Li-ion/LiPo charge controller",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_8PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["battery charger", "LiPo", "TP4056", "power"],
    properties: { charge_current: "1A", termination_voltage: "4.2V", package: "SOP-8" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 5 + 4 })),
  },

  // ═══════════════════════════════════════════════════════════════
  // LOGIC
  // ═══════════════════════════════════════════════════════════════
  {
    id: "gate-and",
    name: "AND Gate",
    category: "Logic",
    description: "Dual 4-input AND gate — 74HC08",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M4 5h8v0a8 8 0 0 1 0 14H4z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0 9h4M0 15h4M20 12h4" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["AND", "gate", "logic", "74HC08"],
    properties: { family: "74HC", voltage: "2-6V", package: "SOIC-14" },
    handles: [{ id: "A", x: 0, y: 9 }, { id: "B", x: 0, y: 15 }, { id: "Y", x: 24, y: 12 }],
  },
  {
    id: "gate-or",
    name: "OR Gate",
    category: "Logic",
    description: "Quad 2-input OR gate — 74HC32",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M4 5q4 0 8 7-4 7-8 7c2-4 2-10 0-14z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0 9h4M0 15h4M20 12h4" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["OR", "gate", "logic", "74HC32"],
    properties: { family: "74HC", voltage: "2-6V", package: "SOIC-14" },
    handles: [{ id: "A", x: 0, y: 9 }, { id: "B", x: 0, y: 15 }, { id: "Y", x: 24, y: 12 }],
  },
  {
    id: "gate-not",
    name: "NOT Gate / Inverter",
    category: "Logic",
    description: "Hex inverter — 74HC04",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M4 5l12 7-12 7z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0 12h4M20 12h4" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["NOT", "inverter", "gate", "logic", "74HC04"],
    properties: { family: "74HC", package: "SOIC-14" },
    handles: [{ id: "A", x: 0, y: 12 }, { id: "Y", x: 24, y: 12 }],
  },
  {
    id: "gate-nand",
    name: "NAND Gate",
    category: "Logic",
    description: "Quad 2-input NAND — 74HC00",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M4 5h8v0a8 8 0 0 1 0 14H4z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="21" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0 9h4M0 15h4M23 12h1" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["NAND", "gate", "logic", "74HC00"],
    properties: { family: "74HC", package: "SOIC-14" },
    handles: [{ id: "A", x: 0, y: 9 }, { id: "B", x: 0, y: 15 }, { id: "Y", x: 24, y: 12 }],
  },
  {
    id: "shift-reg-595",
    name: "Shift Register 74HC595",
    category: "Logic",
    description: "8-bit serial-in parallel-out shift register",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_8PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["shift register", "595", "serial", "SPI", "logic"],
    properties: { bits: "8", interface: "SPI", package: "SOIC-16" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 5 + 4 })),
  },
  {
    id: "dff-74hc74",
    name: "D Flip-Flop 74HC74",
    category: "Logic",
    description: "Dual D-type flip-flop with reset",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_8PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["flip-flop", "D-type", "74HC74", "logic"],
    properties: { package: "SOIC-14" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 5 + 4 })),
  },

  // ═══════════════════════════════════════════════════════════════
  // ANALOG
  // ═══════════════════════════════════════════════════════════════
  {
    id: "opamp-lm358",
    name: "Op-Amp LM358",
    category: "Analog",
    description: "Dual op-amp — single supply 3-32V",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M4 4l16 8-16 8z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0 8h4M0 16h4M20 12h4" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["op-amp", "opamp", "analog", "LM358"],
    properties: { supply: "3-32V", gain_bandwidth: "1MHz", package: "SOIC-8" },
    handles: [{ id: "-", x: 0, y: 9 }, { id: "+", x: 0, y: 15 }, { id: "OUT", x: 24, y: 12 }],
  },
  {
    id: "comparator-lm393",
    name: "Comparator LM393",
    category: "Analog",
    description: "Dual voltage comparator — open collector",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M4 4l16 8-16 8z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0 8h4M0 16h4M20 12h4" stroke="currentColor" stroke-width="1.5"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["comparator", "analog", "LM393"],
    properties: { supply: "2-36V", package: "SOIC-8" },
    handles: [{ id: "-", x: 0, y: 9 }, { id: "+", x: 0, y: 15 }, { id: "OUT", x: 24, y: 12 }],
  },
  {
    id: "ic-555",
    name: "NE555 Timer",
    category: "Analog",
    description: "Precision timer — astable/monostable",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_8PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["555", "timer", "analog", "NE555"],
    properties: { supply: "4.5-16V", package: "DIP-8 / SOIC-8" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 5 + 4 })),
  },
  {
    id: "adc-mcp3204",
    name: "ADC MCP3204",
    category: "Analog",
    description: "4-channel 12-bit SPI ADC",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_8PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["ADC", "SPI", "MCP3204", "analog"],
    properties: { bits: "12", channels: "4", interface: "SPI", package: "SOIC-8" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 5 + 4 })),
  },
  {
    id: "dac-mcp4725",
    name: "DAC MCP4725",
    category: "Analog",
    description: "12-bit single-channel I²C DAC",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_4PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["DAC", "I2C", "MCP4725", "analog"],
    properties: { bits: "12", interface: "I2C", package: "SOT-23-6" },
    handles: [{ id: "VCC", x: 0, y: 7 }, { id: "GND", x: 0, y: 12 }, { id: "SCL", x: 24, y: 7 }, { id: "SDA", x: 24, y: 12 }, { id: "OUT", x: 24, y: 17 }],
  },

  // ═══════════════════════════════════════════════════════════════
  // COMMS
  // ═══════════════════════════════════════════════════════════════
  {
    id: "uart-ch340g",
    name: "USB-UART CH340G",
    category: "Comms",
    description: "USB to UART bridge — CH340G",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_8PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["USB", "UART", "CH340", "serial", "bridge"],
    properties: { speed: "up to 2Mbps", package: "SOIC-16" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 5 + 4 })),
  },
  {
    id: "rs485-max485",
    name: "RS-485 MAX485",
    category: "Comms",
    description: "Half-duplex RS-485 / RS-422 transceiver",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_8PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["RS-485", "MAX485", "serial", "differential"],
    properties: { speed: "2.5Mbps", package: "DIP-8 / SOIC-8" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 5 + 4 })),
  },
  {
    id: "can-mcp2551",
    name: "CAN Transceiver MCP2551",
    category: "Comms",
    description: "CAN bus transceiver — 1Mbps",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_8PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["CAN", "MCP2551", "bus", "automotive"],
    properties: { speed: "1Mbps", package: "DIP-8 / SOIC-8" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 5 + 4 })),
  },
  {
    id: "eeprom-24c256",
    name: "EEPROM AT24C256",
    category: "Comms",
    description: "256Kbit I²C serial EEPROM",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_8PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["EEPROM", "I2C", "memory", "AT24C256"],
    properties: { capacity: "256Kbit", interface: "I2C", package: "SOIC-8" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 5 + 4 })),
  },
  {
    id: "rtc-ds3231",
    name: "RTC DS3231",
    category: "Comms",
    description: "Extremely accurate I²C real-time clock",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_8PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["RTC", "I2C", "clock", "DS3231"],
    properties: { accuracy: "±2ppm", battery: "CR2032", package: "SOIC-16" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 5 + 4 })),
  },

  // ═══════════════════════════════════════════════════════════════
  // MCU
  // ═══════════════════════════════════════════════════════════════
  {
    id: "mcu-atmega328p",
    name: "ATmega328P",
    category: "MCU",
    description: "8-bit AVR microcontroller — Arduino Uno / Pro Mini",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="2" width="18" height="20" fill="none" stroke="currentColor" stroke-width="2"/><path d="M1 4h2m-2 3h2m-2 3h2m-2 3h2m-2 3h2m-2 3h2M21 4h2m-2 3h2m-2 3h2m-2 3h2m-2 3h2m-2 3h2" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["AVR", "ATmega", "Arduino", "8-bit", "MCU"],
    properties: { flash: "32KB", ram: "2KB", speed: "20MHz", gpio: "23", package: "DIP-28 / QFP-32" },
    handles: Array.from({ length: 12 }, (_, i) => ({ id: (i + 1).toString(), x: i < 6 ? 0 : 24, y: (i % 6) * 4 + 2 })),
  },
  {
    id: "mcu-esp32",
    name: "ESP32-WROOM-32",
    category: "MCU",
    description: "WiFi + BT5.0 dual-core module — 240MHz",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="2" width="18" height="20" fill="none" stroke="currentColor" stroke-width="2"/><path d="M1 4h2m-2 3h2m-2 3h2m-2 3h2m-2 3h2M21 4h2m-2 3h2m-2 3h2m-2 3h2m-2 3h2" stroke="currentColor" stroke-width="1.5"/><text x="6" y="14" font-size="4" fill="currentColor">ESP</text></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["ESP32", "WiFi", "Bluetooth", "dual-core", "MCU", "IoT"],
    properties: { cores: "2", speed: "240MHz", flash: "4MB", wifi: "802.11 b/g/n", bluetooth: "BT5.0 + BLE", gpio: "34", package: "Module" },
    handles: Array.from({ length: 12 }, (_, i) => ({ id: (i + 1).toString(), x: i < 6 ? 0 : 24, y: (i % 6) * 4 + 2 })),
  },
  {
    id: "mcu-rp2040",
    name: "RP2040",
    category: "MCU",
    description: "Raspberry Pi dual-core ARM Cortex-M0+ — 133MHz",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="2" width="18" height="20" fill="none" stroke="currentColor" stroke-width="2"/><path d="M1 4h2m-2 3h2m-2 3h2m-2 3h2M21 4h2m-2 3h2m-2 3h2m-2 3h2" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["RP2040", "Raspberry Pi", "ARM", "Cortex-M0+", "MCU", "Pico"],
    properties: { cores: "2", speed: "133MHz", sram: "264KB", flash: "external", gpio: "30", package: "QFN-56" },
    handles: Array.from({ length: 12 }, (_, i) => ({ id: (i + 1).toString(), x: i < 6 ? 0 : 24, y: (i % 6) * 4 + 2 })),
  },
  {
    id: "mcu-stm32f103",
    name: "STM32F103C8",
    category: "MCU",
    description: "ARM Cortex-M3 72MHz — Blue Pill",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="2" width="18" height="20" fill="none" stroke="currentColor" stroke-width="2"/><path d="M1 4h2m-2 3h2m-2 3h2m-2 3h2M21 4h2m-2 3h2m-2 3h2m-2 3h2" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["STM32", "ARM", "Cortex-M3", "Blue Pill", "MCU"],
    properties: { speed: "72MHz", flash: "64KB", sram: "20KB", gpio: "37", package: "LQFP-48" },
    handles: Array.from({ length: 12 }, (_, i) => ({ id: (i + 1).toString(), x: i < 6 ? 0 : 24, y: (i % 6) * 4 + 2 })),
  },

  // ═══════════════════════════════════════════════════════════════
  // SENSOR
  // ═══════════════════════════════════════════════════════════════
  {
    id: "sensor-ds18b20",
    name: "Temp DS18B20",
    category: "Sensor",
    description: "Digital temperature sensor — 1-Wire ±0.5°C",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="10" x2="12" y2="16" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9" r="2" fill="currentColor"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["temperature", "sensor", "DS18B20", "1-Wire"],
    properties: { range: "-55 to +125°C", accuracy: "±0.5°C", interface: "1-Wire", package: "TO-92" },
    handles: [{ id: "VDD", x: 0, y: 8 }, { id: "GND", x: 0, y: 16 }, { id: "DQ", x: 24, y: 12 }],
  },
  {
    id: "sensor-dht22",
    name: "Temp/Humidity DHT22",
    category: "Sensor",
    description: "Temperature & humidity sensor — AM2302",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_4PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["temperature", "humidity", "DHT22", "AM2302", "sensor"],
    properties: { temp_range: "-40 to +80°C", humidity_range: "0-100%RH", interface: "single-wire", package: "THT" },
    handles: [{ id: "VDD", x: 0, y: 7 }, { id: "DATA", x: 0, y: 12 }, { id: "GND", x: 0, y: 17 }],
  },
  {
    id: "sensor-bmp280",
    name: "Barometric BMP280",
    category: "Sensor",
    description: "Barometric pressure + temperature — Bosch",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_4PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["barometric", "pressure", "temperature", "BMP280", "sensor", "I2C", "SPI"],
    properties: { pressure_range: "300-1100hPa", interface: "I2C / SPI", package: "LGA-8" },
    handles: [{ id: "VCC", x: 0, y: 7 }, { id: "GND", x: 0, y: 12 }, { id: "SCL", x: 24, y: 7 }, { id: "SDA", x: 24, y: 12 }],
  },
  {
    id: "sensor-mpu6050",
    name: "IMU MPU-6050",
    category: "Sensor",
    description: "6-axis gyro + accelerometer — InvenSense",
    symbolSvg: `<svg viewBox="0 0 24 24">${IC_8PIN}</svg>`,
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["IMU", "gyroscope", "accelerometer", "MPU-6050", "sensor", "I2C"],
    properties: { dof: "6", interface: "I2C", range_accel: "±16g", range_gyro: "±2000°/s", package: "QFN-24" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 5 + 4 })),
  },
  {
    id: "sensor-hc-sr04",
    name: "Ultrasonic HC-SR04",
    category: "Sensor",
    description: "Ultrasonic distance sensor — 2-400cm",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 12l-4 0m16 0l4 0" stroke="currentColor" stroke-width="1.5"/><path d="M16 8c2 2 2 6 0 8M18 6c3 2.5 3 9.5 0 12" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["ultrasonic", "distance", "HC-SR04", "sensor"],
    properties: { range: "2-400cm", accuracy: "3mm", interface: "GPIO trigger/echo", package: "Module" },
    handles: [{ id: "VCC", x: 0, y: 8 }, { id: "TRIG", x: 0, y: 12 }, { id: "ECHO", x: 24, y: 12 }, { id: "GND", x: 24, y: 16 }],
  },

  // ═══════════════════════════════════════════════════════════════
  // CONNECTOR
  // ═══════════════════════════════════════════════════════════════
  {
    id: "conn-2pin",
    name: "2-Pin Terminal",
    category: "Connector",
    description: "Screw terminal / 2.54mm pin header",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="16" fill="none" stroke="currentColor" stroke-width="2"/><line x1="0" y1="9" x2="6" y2="9" stroke="currentColor" stroke-width="2"/><line x1="0" y1="15" x2="6" y2="15" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="15" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    tags: ["connector", "terminal", "2-pin", "J"],
    properties: { pitch: "2.54mm", current: "3A", package: "THT" },
    handles: [{ id: "1", x: 0, y: 9 }, { id: "2", x: 0, y: 15 }],
  },
  {
    id: "conn-4pin",
    name: "4-Pin Header",
    category: "Connector",
    description: "4-pin 2.54mm male header",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" fill="none" stroke="currentColor" stroke-width="2"/><line x1="0" y1="6" x2="6" y2="6" stroke="currentColor" stroke-width="2"/><line x1="0" y1="10" x2="6" y2="10" stroke="currentColor" stroke-width="2"/><line x1="0" y1="14" x2="6" y2="14" stroke="currentColor" stroke-width="2"/><line x1="0" y1="18" x2="6" y2="18" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="20" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["connector", "header", "4-pin", "J"],
    properties: { pitch: "2.54mm", package: "THT" },
    handles: [{ id: "1", x: 0, y: 6 }, { id: "2", x: 0, y: 10 }, { id: "3", x: 0, y: 14 }, { id: "4", x: 0, y: 18 }],
  },
  {
    id: "conn-usb-c",
    name: "USB-C Connector",
    category: "Connector",
    description: "USB Type-C receptacle — 16-pin SMD",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0 10h3M0 14h3M21 10h3M21 14h3" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["USB-C", "USB", "connector", "J"],
    properties: { standard: "USB 2.0 / 3.1", current: "5A max", package: "SMD" },
    handles: [{ id: "VBUS", x: 0, y: 9 }, { id: "D-", x: 0, y: 12 }, { id: "D+", x: 0, y: 15 }, { id: "GND", x: 24, y: 12 }],
  },
  {
    id: "conn-jst-xh2",
    name: "JST-XH 2-Pin",
    category: "Connector",
    description: "JST XH 2.5mm 2-pin connector — battery",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="6" y="7" width="12" height="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0 10h6M0 14h6" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="10" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["JST", "XH", "2-pin", "battery", "connector"],
    properties: { pitch: "2.5mm", package: "THT" },
    handles: [{ id: "+", x: 0, y: 10 }, { id: "-", x: 0, y: 14 }],
  },
  {
    id: "conn-rj45",
    name: "RJ45 Ethernet",
    category: "Connector",
    description: "RJ45 8P8C ethernet jack with magnetics",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0 8h4M0 10h4M0 12h4M0 14h4M0 16h4" stroke="currentColor" stroke-width="1.5"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["RJ45", "ethernet", "LAN", "connector", "network"],
    properties: { standard: "10/100/1000 Base-T", package: "THT" },
    handles: Array.from({ length: 8 }, (_, i) => ({ id: (i + 1).toString(), x: 0, y: i * 2 + 6 })),
  },
  {
    id: "conn-40pin-rpi",
    name: "40-Pin GPIO Header",
    category: "Connector",
    description: "Raspberry Pi compatible 40-pin 2.54mm header",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="8" y="1" width="8" height="22" fill="none" stroke="currentColor" stroke-width="2"/><path d="M1 3h7M1 5h7M1 7h7M1 9h7M1 11h7M1 13h7M1 15h7M1 17h7M1 19h7M1 21h7" stroke="currentColor" stroke-width="1"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="6" y="1" width="12" height="22" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["GPIO", "40-pin", "Raspberry Pi", "header", "connector"],
    properties: { pins: "40", pitch: "2.54mm", package: "THT" },
    handles: Array.from({ length: 10 }, (_, i) => ({ id: (i + 1).toString(), x: 0, y: i * 2 + 2 })),
  },
];

export function getAllCategories(): string[] {
  return Array.from(new Set(componentLibrary.map((c) => c.category)));
}

export function getComponentsByCategory(category: string): Component[] {
  return componentLibrary.filter((c) => c.category === category);
}

export function searchComponents(query: string): Component[] {
  const q = query.toLowerCase();
  return componentLibrary.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q)) ||
      Object.values(c.properties).some((v) =>
        String(v).toLowerCase().includes(q)
      )
  );
}

export function getComponentById(id: string): Component | undefined {
  return componentLibrary.find((c) => c.id === id);
}
