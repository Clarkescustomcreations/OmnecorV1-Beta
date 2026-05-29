export type FictionNodeType =
  | "character"
  | "location"
  | "event"
  | "faction"
  | "timeline"
  | "artifact"
  | "dialogue"
  | "chapter"
  | "scene";

export interface FictionNodeData {
  id: string;
  type: FictionNodeType;
  label: string;
  description?: string;
  metadata?: Record<string, any>;
  tags?: string[];
}

export interface FictionRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  description?: string;
}

export interface FictionTimelineEvent {
  id: string;
  title: string;
  description: string;
  timestamp: string; // ISO or relative
  order: number;
}

export interface FictionState {
  nodes: FictionNodeData[];
  relationships: FictionRelationship[];
  timeline: FictionTimelineEvent[];
  lore: Record<string, string>;
}
