export function fotmobConfirmsActive(returnLabel:string|null|undefined){
  return /^(back in training|fit|available)$/i.test(returnLabel?.trim()??"");
}

export function recentFotmobClearBlocksInjury(injured:boolean,checkedAt:string|null|undefined,now=Date.now()){
  if(injured||!checkedAt)return false;
  const checked=Date.parse(checkedAt);
  const sevenDays=7*24*60*60*1000;
  return Number.isFinite(checked)&&now>=checked&&now-checked<sevenDays;
}

export function fotmobReturnUpdate(fotmobId:number|null,returnLabel:string|null,checkedAt:string){
  const update:{
    fotmob_id:number|null;
    fotmob_expected_return:string|null;
    fotmob_return_checked_at:string;
    injured?:false;
    injury_type?:null;
    injury_reason?:null;
    expected_return?:null;
  }={
    fotmob_id:fotmobId,
    fotmob_expected_return:returnLabel,
    fotmob_return_checked_at:checkedAt,
  };
  if(fotmobConfirmsActive(returnLabel)){
    update.injured=false;
    update.injury_type=null;
    update.injury_reason=null;
    update.expected_return=null;
  }
  return update;
}
