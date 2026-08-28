export function isApiFootballUnavailable(type:string|null|undefined,reason:string|null|undefined){
  const value=`${type??""} ${reason??""}`.toLowerCase();
  // API-Football can keep recovered players in the injuries response while they
  // rebuild match fitness. That is not an injury or suspension in our UI.
  return !/lacking match fitness|match fitness/.test(value);
}
