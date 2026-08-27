export function returnEstimateLabel(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  const date=new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"});
}
