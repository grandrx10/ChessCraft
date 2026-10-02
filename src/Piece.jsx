import React from 'react';
import SVGS from './pieceSvgs.js';

// Coin and garrison are drawn in the same style as the cburnett set (45×45, 1.5 stroke).
export default function Piece({ type, owner }) {
  const color = owner === 0 ? 'white' : 'black';
  const fill = owner === 0 ? '#fff' : '#000';
  const detail = owner === 0 ? '#000' : '#fff';
  if (type === 'coin') {
    return (
      <svg className="piece" viewBox="0 0 45 45">
        <circle cx="22.5" cy="22.5" r="13" fill={fill} stroke="#000" strokeWidth="1.5" />
        <circle cx="22.5" cy="22.5" r="8.5" fill="none" stroke={detail} strokeWidth="1.5" />
        <path d="M22.5 17.5v10" stroke={detail} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'garrison') {
    return (
      <svg className="piece" viewBox="0 0 45 45">
        <path d="M15.5 37.5V8" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M16.5 9h18l-5 6.5 5 6.5h-18z" fill={fill} stroke="#000" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M11 37.5h12" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'superpawn') {
    return (
      <svg className="piece" viewBox="0 0 45 45">
        <image href={SVGS[`${color}_pawn`]} width="45" height="45" />
        <path d="M16 10.5 14.8 2.5l4.1 3.6 3.6-5.1 3.6 5.1 4.1-3.6-1.2 8z" fill={fill} stroke="#000" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    );
  }
  const src = SVGS[`${color}_${type}`];
  if (!src) return null;
  return <img className="piece" src={src} alt="" draggable="false" />;
}
