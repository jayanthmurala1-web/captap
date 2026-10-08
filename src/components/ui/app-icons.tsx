import type { SVGProps } from "react";

export function IconTodo({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 2"
      className={className}
      {...props}
    >
      <title>To Do</title>
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}

export function IconInProgress({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} {...props}>
      <title>In Progress</title>
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.3"
      />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="2.5" fill="currentColor" />
    </svg>
  );
}

export function IconInReview({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} {...props}>
      <title>In Review</title>
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function IconDone({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} {...props}>
      <title>Done</title>
      <circle cx="8" cy="8" r="6.5" fill="currentColor" fillOpacity="0.15" />
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5.5 8l1.8 1.8 3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconCanceled({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} {...props}>
      <title>Canceled</title>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 11l6-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconUrgent({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      {...props}
    >
      <title>Urgent Priority</title>
      <path d="M2.5 3a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 .4.8l-5 6.5a.5.5 0 0 1-.8 0l-5-6.5a.5.5 0 0 1-.1-.3z" />
      <path d="M6.5 11.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z" />
    </svg>
  );
}

export function IconHigh({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      {...props}
    >
      <title>High Priority</title>
      <rect x="2" y="10" width="2.5" height="4" rx="0.5" />
      <rect x="6.75" y="6" width="2.5" height="8" rx="0.5" />
      <rect x="11.5" y="2" width="2.5" height="12" rx="0.5" />
    </svg>
  );
}

export function IconMedium({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      {...props}
    >
      <title>Medium Priority</title>
      <rect x="2" y="10" width="2.5" height="4" rx="0.5" />
      <rect x="6.75" y="6" width="2.5" height="8" rx="0.5" />
      <rect x="11.5" y="2" width="2.5" height="12" rx="0.5" opacity="0.25" />
    </svg>
  );
}

export function IconLow({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      {...props}
    >
      <title>Low Priority</title>
      <rect x="2" y="10" width="2.5" height="4" rx="0.5" />
      <rect x="6.75" y="6" width="2.5" height="8" rx="0.5" opacity="0.25" />
      <rect x="11.5" y="2" width="2.5" height="12" rx="0.5" opacity="0.25" />
    </svg>
  );
}

export function IconNoPriority({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      opacity="0.35"
      className={className}
      {...props}
    >
      <title>No Priority</title>
      <circle cx="4" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12" cy="8" r="1.25" />
    </svg>
  );
}

export function IconProjects({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className={className}
      {...props}
    >
      <title>Projects</title>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6h12M6 6v7.5" />
    </svg>
  );
}

export function IconSkills({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className={className}
      {...props}
    >
      <title>Skills</title>
      <path d="M4 3.5h8a1.5 1.5 0 0 1 1.5 1.5v8H4a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 4 3.5z" />
      <path d="M6 7h4M6 9.5h3" strokeLinecap="round" />
    </svg>
  );
}

export function IconTeam({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className={className}
      {...props}
    >
      <title>Team</title>
      <circle cx="6" cy="5" r="2.5" />
      <path d="M2 13.5a4 4 0 0 1 8 0" strokeLinecap="round" />
      <path
        d="M10.5 3a2 2 0 0 1 0 4M12 13.5a3.5 3.5 0 0 0-3-3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconSparkles({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      {...props}
    >
      <title>Consult</title>
      <path d="M8 1.5l1.3 3.6 3.7 1.3-3.7 1.3L8 11.3l-1.3-3.6-3.7-1.3 3.7-1.3L8 1.5zM12.5 10l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </svg>
  );
}

export function IconGitBranch({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className={className}
      {...props}
    >
      <title>Git Branch</title>
      <circle cx="4" cy="4" r="1.75" />
      <circle cx="4" cy="12" r="1.75" />
      <circle cx="12" cy="6" r="1.75" />
      <path d="M4 5.75v4.5M4 8.5a4 4 0 0 1 4-4h2.25" strokeLinecap="round" />
    </svg>
  );
}

export function IconTerminal({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className={className}
      {...props}
    >
      <title>Terminal</title>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path
        d="M5 6.5l2 1.5-2 1.5M9 9.5h2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSearch({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className={className}
      {...props}
    >
      <title>Search</title>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" strokeLinecap="round" />
    </svg>
  );
}

export function IconCommand({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className={className}
      {...props}
    >
      <title>Command</title>
      <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H7v2.5H4.5A1.5 1.5 0 0 1 3 5a1.5 1.5 0 0 1 2 .5zm0 5A1.5 1.5 0 0 0 6.5 12H7V9.5H4.5A1.5 1.5 0 0 0 3 11a1.5 1.5 0 0 0 2-.5zm6-5A1.5 1.5 0 0 0 9.5 4H9v2.5h2.5A1.5 1.5 0 0 0 13 5a1.5 1.5 0 0 0-2-.5zm0 5A1.5 1.5 0 0 1 9.5 12H9V9.5h2.5A1.5 1.5 0 0 1 13 11a1.5 1.5 0 0 1-2-.5zM7 6.5v3h2v-3H7z" />
    </svg>
  );
}

export function IconPlus({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      {...props}
    >
      <title>Add</title>
      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
    </svg>
  );
}

export function IconCheck({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      {...props}
    >
      <title>Check</title>
      <path
        d="M3.5 8.5l3 3 6-6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconChevronDown({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      {...props}
    >
      <title>Chevron Down</title>
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconChevronRight({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      {...props}
    >
      <title>Chevron Right</title>
      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconExternalLink({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className={className}
      {...props}
    >
      <title>External Link</title>
      <path
        d="M6.5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9.5 2.5H13.5V6.5M7 9l6-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconGlobe({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className={className}
      {...props}
    >
      <title>Globe</title>
      <circle cx="8" cy="8" r="6" />
      <path d="M2.5 8h11M8 2a9 9 0 0 1 2.5 6 9 9 0 0 1-2.5 6A9 9 0 0 1 5.5 8 9 9 0 0 1 8 2z" />
    </svg>
  );
}

export function IconSidebar({
  className = "w-3.5 h-3.5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className={className}
      {...props}
    >
      <title>Sidebar</title>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M6 2.5v11" />
    </svg>
  );
}
