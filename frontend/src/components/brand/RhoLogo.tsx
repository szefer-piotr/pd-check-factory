interface RhoLogoProps {
  className?: string;
  title?: string;
}

/** Full Rho wordmark (mark + “Rho”). */
export function RhoLogo({ className, title = "Rho" }: RhoLogoProps): JSX.Element {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 168 56"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <circle cx="28" cy="28" r="24" fill="#69BA49" />
      <path
        fill="none"
        stroke="#ffffff"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17 40 C20 31 24.5 21 34 18 C40 16 43 21 40 27 C37 33 29.5 34.5 25 31.5"
      />
      <text
        x="62"
        y="36"
        fontFamily="Segoe UI, Helvetica Neue, Arial, sans-serif"
        fontSize="28"
        fontWeight="600"
        fill="#005B82"
        letterSpacing="-0.02em"
      >
        Rho
      </text>
      <text
        x="118"
        y="22"
        fontFamily="Segoe UI, Helvetica Neue, Arial, sans-serif"
        fontSize="10"
        fontWeight="600"
        fill="#005B82"
      >
        ®
      </text>
    </svg>
  );
}

/** Compact Rho mark (circle only), for narrow layouts. */
export function RhoMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="32" cy="32" r="32" fill="#69BA49" />
      <path
        fill="none"
        stroke="#ffffff"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 46 C22 34 28 22 40 18 C48 15 52 22 48 30 C44 38 34 40 28 36"
      />
    </svg>
  );
}
