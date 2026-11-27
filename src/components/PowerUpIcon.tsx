import React from 'react';
import type { PowerUpType } from '../game/types';
import { POWERUP_DEFS } from '../game/powerups';

interface PowerUpIconProps {
  type: PowerUpType;
  size?: number;
}

/** Code-authored SVG icons matched 1-to-1 with each 3D world power-up's silhouette and hue. */
export const PowerUpIcon: React.FC<PowerUpIconProps> = ({ type, size = 26 }) => {
  const color = POWERUP_DEFS[type].color;

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {type === 'SHUNT' && (
        <>
          <circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth="2" fill="#070A12" />
          <circle cx="12" cy="12" r="4" fill={color} />
          <path d="M12 2V5M12 19V22M2 12H5M19 12H22" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      {type === 'BOLT' && (
        <>
          <polygon points="13,2 4,13 11,13 10,22 20,10 13,10" fill={color} stroke="#070A12" strokeWidth="1.2" />
        </>
      )}
      {type === 'BARGE' && (
        <>
          <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" strokeDasharray="4 2" />
          <circle cx="12" cy="12" r="5" stroke={color} strokeWidth="2" />
          <circle cx="12" cy="12" r="2" fill={color} />
        </>
      )}
      {type === 'MINE' && (
        <>
          <polygon points="12,3 19,8 19,16 12,21 5,16 5,8" fill="#070A12" stroke={color} strokeWidth="2" />
          <circle cx="12" cy="12" r="3.5" fill={color} />
        </>
      )}
      {type === 'SHOCK' && (
        <>
          <path d="M4 17C4 11 7.5 6 12 6C16.5 6 20 11 20 17H4Z" fill="#070A12" stroke={color} strokeWidth="2" />
          <path d="M12 9L9.5 13H12.5L11 16.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {type === 'SHIELD' && (
        <>
          <path d="M12 3L20 6.5V12.5C20 17 16.5 20 12 21.5C7.5 20 4 17 4 12.5V6.5L12 3Z" fill="#070A12" stroke={color} strokeWidth="2" />
          <path d="M12 6.5L16.5 8.5V12.5C16.5 15.2 14.5 17.2 12 18.2" stroke={color} strokeWidth="1.6" />
        </>
      )}
      {type === 'NITRO' && (
        <>
          <path d="M6 17L12 4L18 17L12 14L6 17Z" fill={color} stroke="#070A12" strokeWidth="1.2" />
          <path d="M8.5 20.5L12 17.5L15.5 20.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      {type === 'REPAIR' && (
        <>
          <rect x="4" y="4" width="16" height="16" rx="3" fill="#070A12" stroke={color} strokeWidth="2" />
          <path d="M12 8V16M8 12H16" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
};
