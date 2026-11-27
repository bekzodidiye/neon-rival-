import React from 'react';

interface TitleLogoProps {
  compact?: boolean;
}

/**
 * Bespoke inline SVG racing title emblem lockup for NEON RIVALS.
 * Angular motorsport typography integrated with an illuminated chevron crest.
 */
export const TitleLogo: React.FC<TitleLogoProps> = ({ compact = false }) => {
  return (
    <svg
      viewBox="0 0 460 112"
      className={compact ? 'h-9 w-auto' : 'w-full max-w-[430px] h-auto'}
      role="img"
      aria-label="NEON RIVALS"
    >
      <defs>
        <linearGradient id="nrAccentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00C8FF" />
          <stop offset="55%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#25F4A0" />
        </linearGradient>
      </defs>
      {/* Left angular racing crest */}
      <polygon points="10,16 54,16 34,94 0,94" fill="#00C8FF" />
      <polygon points="62,16 84,16 64,94 42,94" fill="#8B5CF6" />
      <polygon points="18,32 42,32 32,72 8,72" fill="#070A12" />

      {/* Main bold italic display lockup */}
      <text
        x="96"
        y="58"
        fill="#F5F7FA"
        fontFamily="'Chakra Petch', sans-serif"
        fontWeight="700"
        fontStyle="italic"
        fontSize="54"
        letterSpacing="4"
      >
        NEON
      </text>
      <text
        x="266"
        y="58"
        fill="#00C8FF"
        fontFamily="'Chakra Petch', sans-serif"
        fontWeight="700"
        fontStyle="italic"
        fontSize="54"
        letterSpacing="3"
      >
        RIVALS
      </text>

      {/* Speed telemetry accent bar */}
      <polygon points="94,72 448,72 436,80 86,80" fill="url(#nrAccentGrad)" />
      <text
        x="94"
        y="100"
        fill="#94A3B8"
        fontFamily="'JetBrains Mono', monospace"
        fontWeight="700"
        fontSize="13"
        letterSpacing="5.5"
      >
        COMBAT STREET RACING
      </text>
    </svg>
  );
};
