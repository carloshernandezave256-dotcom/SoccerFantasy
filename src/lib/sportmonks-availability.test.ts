import {describe,it,expect} from 'vitest';
import {sportMonksAvailability} from './sportmonks-availability';
const today='2026-09-18';
describe('SportMonks availability',()=>{
 it('uses the provider reason and return date',()=>expect(sportMonksAvailability({type:{name:'Hamstring injury'},sideline:{category:'injury',end_date:'2026-10-01',completed:false}},today)).toEqual({injured:true,injury_type:'Injury',injury_reason:'Hamstring injury',expected_return:'2026-10-01'}));
 it('does not invent a date or reason',()=>expect(sportMonksAvailability({sideline:{category:'injury',end_date:null,completed:false}},today)).toMatchObject({injured:true,injury_reason:null,expected_return:null}));
 it('does not present an expired estimate as recovery',()=>expect(sportMonksAvailability({sideline:{category:'injury',end_date:'2026-09-01',completed:false}},today)).toMatchObject({injured:true,expected_return:null}));
 it('clears completed reports',()=>expect(sportMonksAvailability({type:{name:'Knee injury'},sideline:{category:'injury',end_date:'2026-09-01',completed:true}},today)).toEqual({injured:false,injury_type:null,injury_reason:null,expected_return:null}));
 it('keeps suspensions distinct',()=>expect(sportMonksAvailability({sideline:{category:'suspended',end_date:null,completed:false}},today).injury_type).toBe('Suspension'));
});
