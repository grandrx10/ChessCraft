import React from 'react';

const GLYPH = { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟︎' };

export default function Piece({ type, owner }) {
  const cls = `piece ${owner === 0 ? 'white' : 'black'}`;
  if (type === 'coin') {
    return (
      <svg className={`${cls} svgp`} viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="12" className="fillc" />
        <circle cx="20" cy="20" r="7.5" className="ring" />
      </svg>
    );
  }
  if (type === 'garrison') {
    return (
      <svg className={`${cls} svgp`} viewBox="0 0 40 40">
        <path d="M12 33 V7" className="pole" />
        <path d="M13 8 H30 L25.5 14 L30 20 H13 Z" className="fillc" />
        <path d="M8 33 H20" className="pole" />
      </svg>
    );
  }
  return <span className={cls}>{GLYPH[type]}</span>;
}
