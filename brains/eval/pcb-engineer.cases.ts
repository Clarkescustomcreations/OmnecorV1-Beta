/**
 * @file brains/eval/pcb-engineer.cases.ts
 * @description A/B eval question set for the built-in **PCB & Schematics Engineer** brain.
 */
import type { EvalSpec } from "./_types.js";

const spec: EvalSpec = {
  slug: "pcb-engineer",
  name: "PCB & Schematics Engineer",
  model: "qwen2.5:7b",
  baseSystem:
    "You are a concise, accurate PCB and hardware design engineer. Answer directly in " +
    "3–5 sentences. Be specific and technically precise about schematics, layout, " +
    "routing, and manufacturing; prefer concrete rules over generalities.",
  cases: [
    {
      q: "Why should I avoid 90-degree corners when routing PCB traces?",
      facts: [["acid trap", "acid-trap", "etch", "over-etch"], ["45", "forty-five", "arc", "curve"], ["impedance", "discontinuity"]],
    },
    {
      q: "How close should decoupling capacitors be to an IC and what value should I use?",
      facts: [["close", "as close as", "proximity", "short"], ["100 nf", "0.1", "0.1uf", "0.1 uf"], ["bulk", "1", "10 uf", "transient"]],
    },
    {
      q: "In KiCad, ERC reports 'Input Power pin not driven by Output Power pin'. What fixes it?",
      facts: [["pwr_flag", "power flag", "pwr flag"], ["net", "driven", "power"], ["erc"]],
    },
    {
      q: "Why should I connect through-hole pads to a ground plane with thermal relief instead of a solid pour?",
      facts: [["heat", "sink", "dissipat", "wick"], ["cold joint", "cold solder", "won't reflow", "reflow"], ["spoke", "thermal relief"]],
    },
    {
      q: "What is a controlled-impedance trace and what sets its impedance?",
      facts: [["50 ohm", "50-ohm", "90", "100", "differential"], ["width", "trace width"], ["dielectric", "height", "er", "reference plane", "stackup"]],
    },
    {
      q: "Why must I never route a high-speed signal across a split in the ground plane?",
      facts: [["return", "return current", "return path"], ["loop", "detour", "large loop"], ["emi", "radiat", "signal integrity", "inductance"]],
    },
    {
      q: "What should I do to protect a USB connector's data lines from electrostatic discharge?",
      facts: [["tvs", "esd diode", "esd protection"], ["connector", "at the connector", "entry", "short"], ["low-capacitance", "low capacitance", "ground", "shunt"]],
    },
    {
      q: "How do I choose load capacitors for a crystal oscillator?",
      facts: [["load capacitance", "cl"], ["2", "stray", "parasitic", "2*(cl"], ["startup", "frequency", "close", "pull"]],
    },
    {
      q: "What are typical minimum trace width and clearance for a low-cost prototype PCB fab?",
      facts: [["6 mil", "0.15", "0.1524"], ["clearance", "spacing", "width"], ["0.3", "hole", "fr-4", "1 oz"]],
    },
    {
      q: "When should I use a MOSFET instead of a BJT to switch a load, and what's the difference?",
      facts: [["voltage-controlled", "voltage controlled", "gate", "current-controlled"], ["rds", "on-resistance", "on resistance", "low", "less heat", "vce"], ["logic-level", "logic level", "pull-down", "pull down"]],
    },
    {
      q: "Why do digital inputs need pull-up or pull-down resistors?",
      facts: [["float", "floating"], ["oscillat", "random", "drift", "undefined"], ["10k", "4.7k", "pull-up", "pull-down", "defined level"]],
    },
    {
      q: "What impedance is standard for RF and how do I match an antenna to a coax feed?",
      facts: [["50 ohm", "50-ohm", "50 ohms"], ["match", "matching", "reflect", "vswr", "return loss"], ["quarter-wave", "quarter wave", "coax", "stub", "l-network"]],
    },
  ],
};

export default spec;
