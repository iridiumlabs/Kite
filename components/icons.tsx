import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(props: IconProps) {
  const { size = 16, children, ...rest } = props as IconProps & {
    children?: React.ReactNode;
  };
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
    ...rest,
    children,
  };
}

function strokeProps(width: number, color = "currentColor") {
  return {
    fill: "none",
    stroke: color,
    strokeWidth: width,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function ChevronsUpDown(props: IconProps) {
  return (
    <svg {...base({ size: 12, ...props })}>
      <path d="m7 15 5 5 5-5" {...strokeProps(2.2)} />
      <path d="m7 9 5-5 5 5" {...strokeProps(2.2)} />
    </svg>
  );
}

export function SquarePen(props: IconProps) {
  return (
    <svg {...base({ size: 17, ...props })}>
      <path
        d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
        {...strokeProps(1.7)}
      />
      <path
        d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"
        {...strokeProps(1.7)}
      />
    </svg>
  );
}

export function Inbox(props: IconProps) {
  return (
    <svg {...base(props)}>
      <polyline
        points="22 12 16 12 14 15 10 15 8 12 2 12"
        {...strokeProps(1.8)}
      />
      <path
        d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
        {...strokeProps(1.8)}
      />
    </svg>
  );
}

export function Layers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"
        {...strokeProps(1.8)}
      />
      <path
        d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"
        {...strokeProps(1.8)}
      />
      <path
        d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"
        {...strokeProps(1.8)}
      />
    </svg>
  );
}

export function Send(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m22 2-7 20-4-9-9-4Z" {...strokeProps(1.8)} />
      <path d="M22 2 11 13" {...strokeProps(1.8)} />
    </svg>
  );
}

export function FileText(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
        {...strokeProps(1.8)}
      />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" {...strokeProps(1.8)} />
    </svg>
  );
}

export function Archive(props: IconProps) {
  const { strokeWidth = 1.8, ...rest } = props as IconProps & {
    strokeWidth?: number;
  };
  return (
    <svg {...base(rest)}>
      <rect width="20" height="5" x="2" y="3" rx="1" {...strokeProps(strokeWidth)} />
      <path
        d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"
        {...strokeProps(strokeWidth)}
      />
      <path d="M10 12h4" {...strokeProps(strokeWidth)} />
    </svg>
  );
}

export function Trash(props: IconProps) {
  const { strokeWidth = 1.8, ...rest } = props as IconProps & {
    strokeWidth?: number;
  };
  return (
    <svg {...base(rest)}>
      <path d="M3 6h18" {...strokeProps(strokeWidth)} />
      <path
        d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
        {...strokeProps(strokeWidth)}
      />
      <path
        d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
        {...strokeProps(strokeWidth)}
      />
    </svg>
  );
}

export function ChevronDown(props: IconProps) {
  const { strokeWidth = 2.6, ...rest } = props as IconProps & {
    strokeWidth?: number;
  };
  return (
    <svg {...base({ size: 10, ...rest })}>
      <path d="m6 9 6 6 6-6" {...strokeProps(strokeWidth)} />
    </svg>
  );
}

export function ChevronUp(props: IconProps) {
  return (
    <svg {...base({ size: 17, ...props })}>
      <path d="m18 15-6-6-6 6" {...strokeProps(1.8)} />
    </svg>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <svg {...base({ size: 11, ...props })}>
      <path d="m9 18 6-6-6-6" {...strokeProps(2.4)} />
    </svg>
  );
}

export function Plus(props: IconProps) {
  return (
    <svg {...base({ size: 13, ...props })}>
      <path d="M5 12h14" {...strokeProps(2)} />
      <path d="M12 5v14" {...strokeProps(2)} />
    </svg>
  );
}

export function FilterLines(props: IconProps) {
  return (
    <svg {...base({ size: 17, ...props })}>
      <path d="M3 6h18" {...strokeProps(1.8)} />
      <path d="M7 12h10" {...strokeProps(1.8)} />
      <path d="M10 18h4" {...strokeProps(1.8)} />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base({ size: 14, ...props })}>
      <circle cx="11" cy="11" r="7.5" {...strokeProps(2.1)} />
      <path d="m20.5 20.5-4.2-4.2" {...strokeProps(2.1)} />
    </svg>
  );
}

export function Tag(props: IconProps) {
  return (
    <svg {...base({ size: 17, ...props })}>
      <path
        d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"
        {...strokeProps(1.7)}
      />
      <circle cx="7.5" cy="7.5" r="1" {...strokeProps(1.7)} />
    </svg>
  );
}

export function Clock(props: IconProps) {
  const { strokeWidth = 1.7, ...rest } = props as IconProps & {
    strokeWidth?: number;
  };
  return (
    <svg {...base({ size: 17, ...rest })}>
      <circle cx="12" cy="12" r="9" {...strokeProps(strokeWidth)} />
      <polyline points="12 7 12 12 15 14" {...strokeProps(strokeWidth)} />
    </svg>
  );
}

export function Mail(props: IconProps) {
  return (
    <svg {...base({ size: 17, ...props })}>
      <rect width="20" height="16" x="2" y="4" rx="2" {...strokeProps(1.7)} />
      <path
        d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"
        {...strokeProps(1.7)}
      />
    </svg>
  );
}

export function MailOpen(props: IconProps) {
  return (
    <svg {...base({ size: 15, ...props })}>
      <path
        d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"
        {...strokeProps(1.8)}
      />
      <path
        d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"
        {...strokeProps(1.8)}
      />
    </svg>
  );
}

export function Star(props: IconProps) {
  return (
    <svg {...base({ size: 17, ...props })}>
      <polygon
        points="12 2.5 15 8.6 21.7 9.6 16.8 14.3 18 21 12 17.8 6 21 7.2 14.3 2.3 9.6 9 8.6 12 2.5"
        {...strokeProps(1.7)}
      />
    </svg>
  );
}

export function StarFilled(props: IconProps) {
  return (
    <svg {...base({ size: 17, ...props })}>
      <polygon
        points="12 2.5 15 8.6 21.7 9.6 16.8 14.3 18 21 12 17.8 6 21 7.2 14.3 2.3 9.6 9 8.6 12 2.5"
        fill="#FF9F0A"
        stroke="#FF9F0A"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MoreDots(props: IconProps) {
  return (
    <svg {...base({ size: 17, ...props })}>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function ReplyIcon(props: IconProps) {
  const { strokeWidth = 1.8, ...rest } = props as IconProps & {
    strokeWidth?: number;
  };
  return (
    <svg {...base({ size: 15, ...rest })}>
      <polyline points="9 17 4 12 9 7" {...strokeProps(strokeWidth)} />
      <path d="M20 18v-2a4 4 0 0 0-4-4H4" {...strokeProps(strokeWidth)} />
    </svg>
  );
}

export function ReplyAllIcon(props: IconProps) {
  return (
    <svg {...base({ size: 14, ...props })}>
      <polyline points="7 17 2 12 7 7" {...strokeProps(1.9)} />
      <polyline points="12 17 7 12 12 7" {...strokeProps(1.9)} />
      <path d="M22 18v-2a4 4 0 0 0-4-4H7" {...strokeProps(1.9)} />
    </svg>
  );
}

export function ForwardIcon(props: IconProps) {
  return (
    <svg {...base({ size: 14, ...props })}>
      <polyline points="15 17 20 12 15 7" {...strokeProps(1.9)} />
      <path d="M4 18v-2a4 4 0 0 1 4-4h12" {...strokeProps(1.9)} />
    </svg>
  );
}

export function Sliders(props: IconProps) {
  return (
    <svg {...base({ size: 15, ...props })}>
      <path d="M4 21v-7" {...strokeProps(1.8)} />
      <path d="M4 10V3" {...strokeProps(1.8)} />
      <path d="M12 21v-9" {...strokeProps(1.8)} />
      <path d="M12 8V3" {...strokeProps(1.8)} />
      <path d="M20 21v-5" {...strokeProps(1.8)} />
      <path d="M20 12V3" {...strokeProps(1.8)} />
      <path d="M1 14h6" {...strokeProps(1.8)} />
      <path d="M9 8h6" {...strokeProps(1.8)} />
      <path d="M17 16h6" {...strokeProps(1.8)} />
    </svg>
  );
}

export function LinkIcon(props: IconProps) {
  const { strokeWidth = 1.8, ...rest } = props as IconProps & {
    strokeWidth?: number;
  };
  return (
    <svg {...base({ size: 15, ...rest })}>
      <path
        d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
        {...strokeProps(strokeWidth)}
      />
      <path
        d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
        {...strokeProps(strokeWidth)}
      />
    </svg>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <svg {...base({ size: 15, ...props })}>
      <circle cx="7.5" cy="15.5" r="5.5" {...strokeProps(1.8)} />
      <path d="m21 2-9.6 9.6" {...strokeProps(1.8)} />
      <path d="m15.5 7.5 3 3L22 7l-3-3" {...strokeProps(1.8)} />
    </svg>
  );
}

export function AppearanceIcon(props: IconProps) {
  return (
    <svg {...base({ size: 15, ...props })}>
      <circle cx="12" cy="12" r="9" {...strokeProps(1.8)} />
      <path
        d="M12 3a9 9 0 0 1 0 18z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function SignOutIcon(props: IconProps) {
  return (
    <svg {...base({ size: 15, ...props })}>
      <path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
        {...strokeProps(1.8)}
      />
      <polyline points="16 17 21 12 16 7" {...strokeProps(1.8)} />
      <path d="M21 12H9" {...strokeProps(1.8)} />
    </svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <svg {...base({ size: 15, ...props })}>
      <path d="M5 12h14" {...strokeProps(1.9)} />
    </svg>
  );
}

export function ExpandIcon(props: IconProps) {
  return (
    <svg {...base({ size: 14, ...props })}>
      <polyline points="15 3 21 3 21 9" {...strokeProps(1.9)} />
      <polyline points="9 21 3 21 3 15" {...strokeProps(1.9)} />
      <path d="M21 3l-7 7" {...strokeProps(1.9)} />
      <path d="M3 21l7-7" {...strokeProps(1.9)} />
    </svg>
  );
}

export function RestoreIcon(props: IconProps) {
  return (
    <svg {...base({ size: 14, ...props })}>
      <polyline points="4 14 10 14 10 20" {...strokeProps(1.9)} />
      <polyline points="20 10 14 10 14 4" {...strokeProps(1.9)} />
      <path d="M14 10l7-7" {...strokeProps(1.9)} />
      <path d="M3 21l7-7" {...strokeProps(1.9)} />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  const { strokeWidth = 1.9, ...rest } = props as IconProps & {
    strokeWidth?: number;
  };
  return (
    <svg {...base({ size: 15, ...rest })}>
      <path d="M18 6 6 18" {...strokeProps(strokeWidth)} />
      <path d="m6 6 12 12" {...strokeProps(strokeWidth)} />
    </svg>
  );
}

export function PaperclipIcon(props: IconProps) {
  const { strokeWidth = 2, ...rest } = props as IconProps & {
    strokeWidth?: number;
  };
  return (
    <svg {...base({ size: 13, ...rest })}>
      <path
        d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
        {...strokeProps(strokeWidth)}
      />
    </svg>
  );
}

export function TypeIcon(props: IconProps) {
  return (
    <svg {...base({ size: 16, ...props })}>
      <polyline points="4 7 4 4 20 4 20 7" {...strokeProps(1.8)} />
      <path d="M9 20h6" {...strokeProps(1.8)} />
      <path d="M12 4v16" {...strokeProps(1.8)} />
    </svg>
  );
}

export function StarSidebar(props: IconProps) {
  return (
    <svg {...base(props)}>
      <polygon
        points="12 2.5 15 8.6 21.7 9.6 16.8 14.3 18 21 12 17.8 6 21 7.2 14.3 2.3 9.6 9 8.6 12 2.5"
        {...strokeProps(1.8)}
      />
    </svg>
  );
}

export function SnoozeSidebar(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" {...strokeProps(1.8)} />
      <polyline points="12 7 12 12 15 14" {...strokeProps(1.8)} />
    </svg>
  );
}
