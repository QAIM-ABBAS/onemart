import type { ReactElement, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps): IconProps {
  return {
    width: 44,
    height: 44,
    viewBox: "0 0 48 48",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...props,
  };
}

function ProduceIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M24 15c-6-6-16-4-16 6 0 8 7 15 11 15 2 0 3-1 5-1s3 1 5 1c4 0 11-7 11-15 0-10-10-12-16-6Z" />
      <path d="M24 15c0-4 2-7 6-8" />
      <path d="M24 15c-1.5-2.5-4-4-7-4.5" />
    </svg>
  );
}

function BakeryIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 34c-2-8 2-16 10-18l14-4c6-1.7 11 2 11 8 0 7-7 12-14 12H14" />
      <path d="M16 20.5 19 32M23 18.5l2 13M30 16.5l1.5 14" />
    </svg>
  );
}

function FrozenIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M24 8v32M12 15l24 18M36 15 12 33" />
      <path d="M20 11.5 24 15l4-3.5M20 36.5 24 33l4 3.5" />
      <path d="m12.6 21.4 4.7 1.4-.4 4.9M35.4 26.6l-4.7-1.4.4-4.9" />
    </svg>
  );
}

function MeatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M31 10c6 2 9 8 7 14-2 7-9 11-17 11-8 0-15-5-16-12C4 17 10 11 18 10c4-.5 9 0 13 0Z" />
      <circle cx="24" cy="23" r="5.5" />
    </svg>
  );
}

function BottleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 6h6v6l3 5v23a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2V17l3-5V6Z" />
      <path d="M18 24h12" />
      <path d="M21 6h6" />
    </svg>
  );
}

function CoffeeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 18h22v10a11 11 0 0 1-22 0V18Z" />
      <path d="M34 21h3a4 4 0 0 1 0 8h-3" />
      <path d="M17 8c-1.5 2 1.5 3 0 5M24 7c-1.5 2 1.5 3 0 5M31 8c-1.5 2 1.5 3 0 5" />
    </svg>
  );
}

function MilkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M18 18h12v22a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2V18Z" />
      <path d="M19 18l2-10h6l2 10" />
      <path d="M21 8h6" />
      <path d="M18 27h12" />
    </svg>
  );
}

function PawIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <ellipse cx="17" cy="17" rx="4" ry="5" />
      <ellipse cx="31" cy="17" rx="4" ry="5" />
      <ellipse cx="11.5" cy="26" rx="3.5" ry="4.5" />
      <ellipse cx="36.5" cy="26" rx="3.5" ry="4.5" />
      <path d="M24 24c5 0 9 4 9 8.5S29 40 24 40s-9-2.5-9-7.5S19 24 24 24Z" />
    </svg>
  );
}

function HouseholdIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 20h14v20a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V20Z" />
      <path d="M18 20v-4h6v4" />
      <path d="M32 10h6v6h-6z" />
      <path d="M35 16v4" />
      <path d="M14 28h14" />
    </svg>
  );
}

function CareIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 8h8v6l4 6v20a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V20l4-6V8Z" />
      <path d="M16 26h16" />
      <path d="M24 30v6" />
    </svg>
  );
}

function BabyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="24" cy="24" r="15" />
      <path d="M19 21h.1M29 21h.1" />
      <path d="M19 30c2.5 2.5 7.5 2.5 10 0" />
      <path d="M24 9c0-2 2-4 5-4" />
    </svg>
  );
}

function SnacksIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 16h20l-2 24H16L14 16Z" />
      <path d="M14 16 18 8h12l4 8" />
      <path d="M20 24h8" />
    </svg>
  );
}

function GridIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="13" height="13" />
      <rect x="26" y="9" width="13" height="13" />
      <rect x="9" y="26" width="13" height="13" />
      <rect x="26" y="26" width="13" height="13" />
    </svg>
  );
}

const MAP: { test: RegExp; Icon: (props: IconProps) => ReactElement }[] = [
  { test: /fruit|vegetab|produce|fresh|green|salad|herb/i, Icon: ProduceIcon },
  { test: /bread|bak|cake|sweet|snack|cookie|biscuit/i, Icon: BakeryIcon },
  { test: /frozen|ice|snow/i, Icon: FrozenIcon },
  { test: /meat|chicken|mutton|fish|seafood/i, Icon: MeatIcon },
  { test: /wine|alcohol|drink|beverage|juice|soda/i, Icon: BottleIcon },
  { test: /coffee|tea/i, Icon: CoffeeIcon },
  { test: /milk|dairy|egg|cheese/i, Icon: MilkIcon },
  { test: /pet|dog|cat/i, Icon: PawIcon },
  { test: /house|clean|laundry|kitchen/i, Icon: HouseholdIcon },
  { test: /baby|diaper|nappy|infant|toddler/i, Icon: BabyIcon },
  { test: /hair|skin|bath|oral|care|beauty|personal/i, Icon: CareIcon },
  { test: /chips|namkeen|chocolate|confection/i, Icon: SnacksIcon },
];

export function CategoryIcon({
  slug,
  name,
  className,
  size = 44,
}: {
  slug?: string;
  name?: string;
  className?: string;
  size?: number;
}) {
  const haystack = `${slug ?? ""} ${name ?? ""}`;
  const match = MAP.find((entry) => entry.test.test(haystack));
  const Icon = match?.Icon ?? GridIcon;
  return <Icon width={size} height={size} className={className} />;
}
