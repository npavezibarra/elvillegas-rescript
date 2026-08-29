import type { ClipSuggestion } from "./aiClips";
import type { EditorStatus } from "./types";

export type WorkspaceScreen = "projects" | "clips" | "editor";

export type ProjectPhase =
  | "idle"
  | "processing"
  | "transcript_ready"
  | "clips_ready"
  | "editing"
  | "error";

export interface WorkflowSnapshot {
  projectPhase: ProjectPhase;
  workspaceScreen: WorkspaceScreen;
}

export interface WorkflowInput {
  status: EditorStatus;
  aiClipSuggestions: ClipSuggestion[];
  selectedClipIndex: number | null;
  hasVideo: boolean;
}

export function deriveProjectPhase({
  status,
  aiClipSuggestions,
  selectedClipIndex,
  hasVideo,
}: WorkflowInput): ProjectPhase {
  if (!hasVideo || status === "idle") return "idle";
  if (status === "error") return "error";
  if (selectedClipIndex != null) return "editing";
  if (aiClipSuggestions.length > 0) return "clips_ready";
  if (status === "preparing" || status === "transcribing") {
    return "processing";
  }
  return "transcript_ready";
}

export function deriveWorkspaceScreen(projectPhase: ProjectPhase): WorkspaceScreen {
  switch (projectPhase) {
    case "clips_ready":
      return "clips";
    case "editing":
      return "editor";
    case "idle":
    case "processing":
    case "transcript_ready":
    case "error":
    default:
      return "projects";
  }
}

export function deriveWorkflow(input: WorkflowInput): WorkflowSnapshot {
  const projectPhase = deriveProjectPhase(input);
  return {
    projectPhase,
    workspaceScreen: deriveWorkspaceScreen(projectPhase),
  };
}
