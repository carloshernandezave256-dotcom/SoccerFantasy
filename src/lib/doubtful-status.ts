export type PlayerAvailability={id:number;full_name:string;injured:boolean;injury_type:string|null;injury_reason:string|null;doubtful_checked_at:string|null;doubtful_until:string|null};
export function hasDoubtfulWarning(player:Pick<PlayerAvailability,'injured'|'doubtful_until'>|null|undefined,now=Date.now()){
 return Boolean(player&&!player.injured&&player.doubtful_until&&Date.parse(player.doubtful_until)>now);
}
