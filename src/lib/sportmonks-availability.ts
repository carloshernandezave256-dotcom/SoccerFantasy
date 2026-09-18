type Report={type?:{name:string};sideline?:{category:string;end_date:string|null;completed:boolean}};
export function sportMonksAvailability(report:Report,today:string){
 const sideline=report.sideline;
 if(!sideline)throw new Error('Missing SportMonks sideline details.');
 if(sideline.completed===true)return {injured:false,injury_type:null,injury_reason:null,expected_return:null};
 return {injured:true,injury_type:['suspension','suspended'].includes(sideline.category)?'Suspension':'Injury',injury_reason:report.type?.name??null,expected_return:sideline.end_date&&sideline.end_date>=today?sideline.end_date:null};
}
