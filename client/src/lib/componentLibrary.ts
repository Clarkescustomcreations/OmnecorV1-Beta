/**
 * Component Library for PCB/Schematic Editor
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
  properties: Record<string, any>;
  handles: Array<{ id: string; position?: string; type?: string; x?: number; y?: number }>;
}

export const componentLibrary: Component[] = [
  {
    id: "res-001",
    name: "Resistor",
    category: "Passive",
    description: "Generic 0805 Resistor",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h3l2-5 4 10 4-10 2 5h5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["resistor", "passive", "0805"],
    properties: { resistance: "10k", tolerance: "5%", package: "0805" },
    handles: [{ id: "p1", x: 0, y: 12 }, { id: "p2", x: 24, y: 12 }]
  },
  {
    id: "cap-001",
    name: "Capacitor",
    category: "Passive",
    description: "Generic 0805 Capacitor",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h8m4 0h8M10 5v14m4-14v14" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="6" y="8" width="12" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["capacitor", "passive", "0805"],
    properties: { capacitance: "100nF", voltage: "16V", package: "0805" },
    handles: [{ id: "p1", x: 0, y: 12 }, { id: "p2", x: 24, y: 12 }]
  },
  {
    id: "led-001",
    name: "LED",
    category: "Opto",
    description: "Red 0805 LED",
    symbolSvg: '<svg viewBox="0 0 24 24"><path d="M2 12h4l4-6v12l-4-6M12 6v12M14 8l2-2M16 10l2-2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["led", "opto", "diode"],
    properties: { color: "Red", forward_voltage: "2.0V" },
    handles: [{ id: "a", x: 0, y: 12 }, { id: "k", x: 24, y: 12 }]
  },
  {
    id: "ic-555",
    name: "NE555",
    category: "IC",
    description: "Timer IC (SOIC-8)",
    symbolSvg: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="16" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 6h4m0 4H2m0 4h4m0 4H2m16-12h4m-4 4h4m-4 4h4m-4 4h4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    footprintSvg: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tags: ["ic", "timer", "555"],
    properties: { manufacturer: "TI", supply_voltage: "4.5-16V" },
    handles: Array.from({length: 8}, (_, i) => ({ id: (i+1).toString(), x: i < 4 ? 0 : 24, y: (i % 4) * 4 + 6 }))
  }
];

export function getAllCategories(): string[] {
  return Array.from(new Set(componentLibrary.map(c => c.category)));
}

export function getComponentsByCategory(category: string): Component[] {
  return componentLibrary.filter(c => c.category === category);
}

export function searchComponents(query: string): Component[] {
  const q = query.toLowerCase();
  return componentLibrary.filter(c => 
    c.name.toLowerCase().includes(q) || 
    c.description.toLowerCase().includes(q) ||
    c.tags.some(t => t.toLowerCase().includes(q))
  );
}

export function getComponentById(id: string): Component | undefined {
  return componentLibrary.find(c => c.id === id);
}
