"use client";

import { useState } from "react";

type PlayerHeadshotProps = {
  name: string;
  position: string;
  photoUrl?: string | null;
  className?: string;
  decorative?: boolean;
};

export function PlayerHeadshot({ name, position, photoUrl, className = "", decorative = false }: PlayerHeadshotProps) {
  const [failed, setFailed] = useState(false);
  const classes = `player-headshot ${className}`.trim();

  if (!photoUrl || failed) {
    return <span className={`${classes} player-headshot-fallback position ${position.toLowerCase()}`} aria-label={decorative ? undefined : `${position} player`}>{position}</span>;
  }

  return <span className={classes}>
    <img src={photoUrl} alt={decorative ? "" : `${name} headshot`} onError={() => setFailed(true)} loading="lazy" referrerPolicy="no-referrer" />
  </span>;
}
