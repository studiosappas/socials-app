import type { DemoComment, DemoTeamMember } from "./types";

export const DEMO_TEAM: DemoTeamMember[] = [
  { id: "u1", name: "Mia Reyes", avatar: null },
  { id: "u2", name: "Jordan Blake", avatar: null },
  { id: "u3", name: "Priya Nair", avatar: null },
];

export const DEMO_POST_TITLE = "Launch announcement — new product line";

export const DEMO_COMMENTS: DemoComment[] = [
  {
    id: "c1",
    author: DEMO_TEAM[1],
    text: "Caption feels right. Can we swap the hero shot for the one with better lighting?",
    timeLabel: "2h ago",
  },
  {
    id: "c2",
    author: DEMO_TEAM[2],
    text: "Swapped. Moving this to review.",
    timeLabel: "48m ago",
  },
];

export const DEMO_TASK_TITLE = "Publish: Launch announcement — Aug 14";
