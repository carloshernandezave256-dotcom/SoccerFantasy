"use client";

import { useState } from "react";
import {usePlayerAvailability} from "./doubtful-warning";
import {hasDoubtfulWarning} from "@/lib/doubtful-status";

type PlayerHeadshotProps = {
  name: string;
  position: string;
  photoUrl?: string | null;
  className?: string;
  decorative?: boolean;
};

export function PlayerHeadshot({ name, position, photoUrl, className = "", decorative = false }: PlayerHeadshotProps) {
  const [failed, setFailed] = useState(false);
  const availability=usePlayerAvailability(undefined,name);
  const classes = `player-headshot ${className} ${hasDoubtfulWarning(availability)?"doubtful-outline":""}`.trim();
  const suspension=/susp|red card/i.test(`${availability?.injury_type??''} ${availability?.injury_reason??''}`);
  const badge=availability?.injured?<span className={`player-availability-badge ${suspension?'suspension':'injury'}`} title={availability.injury_reason??availability.injury_type??'Unavailable'} aria-label={suspension?'Player suspended':'Player injured'}>{suspension?'':'✚'}</span>:null;

  if (!photoUrl || failed) {
    return <span className={`${classes} player-headshot-fallback position ${position.toLowerCase()}`} title={hasDoubtfulWarning(availability)?"Doubtful — may miss the next match":undefined} aria-label={decorative ? undefined : `${position} player`}>{position}{badge}</span>;
  }

  return <span className={classes} title={hasDoubtfulWarning(availability)?"Doubtful — may miss the next match":undefined}>
    <img src={photoUrl} alt={decorative ? "" : `${name} headshot`} onError={() => setFailed(true)} loading="lazy" referrerPolicy="no-referrer" />
    {badge}
  </span>;
}
