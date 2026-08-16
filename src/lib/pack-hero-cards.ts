export type PackHeroCard={src:string;edition:"CAPTAIN EDITION"|"SUPERSTAR EDITION";className:string};

const packHeroCards:Record<string,PackHeroCard>={
  "Virgil van Dijk":{src:"/cards/van-dijk-captain.webp",edition:"CAPTAIN EDITION",className:"captain-hero"},
  "Erling Haaland":{src:"/cards/haaland-superstar.webp",edition:"SUPERSTAR EDITION",className:"haaland-hero"},
  "Kylian Mbappé":{src:"/cards/mbappe-captain.webp",edition:"CAPTAIN EDITION",className:"mbappe-hero"},
  "Lamine Yamal":{src:"/cards/lamine-yamal-superstar.webp",edition:"SUPERSTAR EDITION",className:"yamal-hero"},
};

export function getPackHeroCard(playerName:string|undefined|null){
  return playerName?packHeroCards[playerName]??null:null;
}
