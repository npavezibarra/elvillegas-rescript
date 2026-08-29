import {
  deriveProjectPhase,
  deriveWorkspaceScreen,
  deriveWorkflow,
} from "../lib/workflow";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

{
  const workflow = deriveWorkflow({
    status: "idle",
    aiClipSuggestions: [],
    selectedClipIndex: null,
    hasVideo: false,
  });
  assert(workflow.projectPhase === "idle", "idle should stay idle");
  assert(workflow.workspaceScreen === "projects", "idle should open projects");
  console.log("idle workflow: ok");
}

{
  const workflow = deriveWorkflow({
    status: "transcribing",
    aiClipSuggestions: [],
    selectedClipIndex: null,
    hasVideo: true,
  });
  assert(workflow.projectPhase === "processing", "transcribing should be processing");
  assert(workflow.workspaceScreen === "projects", "processing should stay on projects");
  console.log("processing workflow: ok");
}

{
  const workflow = deriveWorkflow({
    status: "ready",
    aiClipSuggestions: [
      { title: "Clip", start: 1, end: 2 },
    ],
    selectedClipIndex: null,
    hasVideo: true,
  });
  assert(workflow.projectPhase === "clips_ready", "suggestions should open clips");
  assert(workflow.workspaceScreen === "clips", "suggestions should open clips screen");
  console.log("clips workflow: ok");
}

{
  const phase = deriveProjectPhase({
    status: "ready",
    aiClipSuggestions: [],
    selectedClipIndex: 2,
    hasVideo: true,
  });
  const screen = deriveWorkspaceScreen(phase);
  assert(phase === "editing", "selected clip should enter editing");
  assert(screen === "editor", "editing should open editor");
  console.log("editor workflow: ok");
}

console.log("ALL WORKFLOW TESTS PASSED");
