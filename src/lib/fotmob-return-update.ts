export function fotmobConfirmsActive(returnLabel:string|null|undefined){
  return /^(back in training|fit|available)$/i.test(returnLabel?.trim()??"");
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
