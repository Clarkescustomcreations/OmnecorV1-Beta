import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PeerCardTone = "concise" | "detailed" | "casual" | "technical";

export interface UserPeerCard {
  displayName: string;
  role: string;
  bio: string;
  skills: string[];
  tone: PeerCardTone;
  timezone: string;
}

const DEFAULT_CARD: UserPeerCard = {
  displayName: "",
  role: "",
  bio: "",
  skills: [],
  tone: "concise",
  timezone: "",
};

interface UserPeerCardStore {
  card: UserPeerCard;
  update: (updates: Partial<UserPeerCard>) => void;
  reset: () => void;
}

// Key is global — not scoped to any project or map
const STORAGE_KEY = "omnecor_user_peer_card";

export const useUserPeerCard = create<UserPeerCardStore>()(
  persist(
    (set) => ({
      card: {
        ...DEFAULT_CARD,
        timezone: typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : "",
      },
      update: (updates) =>
        set((s) => ({ card: { ...s.card, ...updates } })),
      reset: () =>
        set({ card: { ...DEFAULT_CARD, timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "" } }),
    }),
    { name: STORAGE_KEY }
  )
);

/**
 * Build a system-prompt string from both peer cards.
 * Injected into AI context when enableAIContext is on.
 */
export function buildPeerCardContext(
  user: UserPeerCard,
  project?: import("@/types/neural").ProjectPeerCard | null
): string {
  const lines: string[] = ["<peer_context>"];

  if (user.displayName || user.role || user.bio) {
    lines.push("## You are assisting:");
    if (user.displayName) lines.push(`- Name: ${user.displayName}`);
    if (user.role) lines.push(`- Role: ${user.role}`);
    if (user.bio) lines.push(`- About: ${user.bio}`);
    if (user.skills.length) lines.push(`- Skills: ${user.skills.join(", ")}`);
    if (user.tone) lines.push(`- Preferred response style: ${user.tone}`);
    if (user.timezone) lines.push(`- Timezone: ${user.timezone}`);
  }

  if (project && (project.description || (project.techStack ?? []).length || (project.goals ?? []).length)) {
    lines.push("\n## Active project context:");
    if (project.description) lines.push(`- Description: ${project.description}`);
    if (project.techStack?.length) lines.push(`- Tech stack: ${project.techStack.join(", ")}`);
    if (project.goals?.length) lines.push(`- Goals: ${project.goals.join("; ")}`);
    if (project.team?.length) lines.push(`- Team: ${project.team.join(", ")}`);
    if (project.notes) lines.push(`- Notes: ${project.notes}`);
  }

  lines.push("</peer_context>");
  return lines.join("\n");
}
