export function fotmobReturnUpdate(fotmobId:number|null,returnLabel:string|null,checkedAt:string){
  return {
    fotmob_id:fotmobId,
    fotmob_expected_return:returnLabel,
    fotmob_return_checked_at:checkedAt,
  };
}
