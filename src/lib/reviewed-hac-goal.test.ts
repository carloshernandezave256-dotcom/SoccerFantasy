import {expect,it,vi} from 'vitest';
import snapshot from './test-fixtures/marseille-hac-20261025.json';
import {normalizeSportMonks,type SportMonksSource,type FixtureContext} from './sportmonks-scoring';
const fixture=()=>structuredClone(snapshot) as {source:SportMonksSource;context:FixtureContext};
const run=(s=fixture(),note=vi.fn())=>normalizeSportMonks(s.source,s.context,'2026-10-28T08:30:00Z',{onReviewedEvidence:note});
it('replays the actual provider snapshot without awarding the same goal twice',()=>{
 const s=fixture(),before=structuredClone(s),note=vi.fn();const rows=run(s,note);
 expect(rows.find(r=>r.player_id===3497)?.goals).toBe(0);
 const lamine=s.source.player_map['37731194'];expect(rows.find(r=>r.player_id===lamine)?.goals).toBe(1);
 expect(rows.reduce((sum,r)=>sum+Number(r.goals),0)).toBe(7);
 expect(s).toEqual(before);expect(note).toHaveBeenCalledWith(expect.stringContaining('Le Havre official report'));
});
it('does not apply reviewed evidence when appearance, fixture or scorer changes',()=>{
 for(const change of ['minutes','substitution','scorer','fixture','goals']){
  const s=fixture();const l=s.source.raw_data.lineups.find(p=>p.player_id===22168918)!;
  if(change==='minutes')l.details!.find(d=>d.type_id===119)!.data.value=62;
  if(change==='substitution')s.source.raw_data.events.find(e=>e.id===158406993)!.minute=60;
  if(change==='scorer')s.source.raw_data.events.find(e=>e.id===158407774)!.player_id=5249;
  if(change==='fixture')s.source.fixture_id=s.context.fixture_id=1;
  if(change==='goals')l.details!.find(d=>d.type_id===52)!.data.value=2;
  expect(()=>run(s)).toThrow('goal attribution');
 }
});
it('uses later corrected provider stats without requiring the exception',()=>{
 const s=fixture(),note=vi.fn();s.source.raw_data.lineups.find(p=>p.player_id===22168918)!.details!.find(d=>d.type_id===52)!.data.value=0;
 expect(run(s,note).find(r=>r.player_id===3497)?.goals).toBe(0);expect(note).not.toHaveBeenCalled();
});
it('does not replace a null stat or report a correction on a subsequently failed fixture',()=>{
 const s=fixture(),note=vi.fn();s.source.raw_data.lineups.find(p=>p.player_id===22168918)!.details!.find(d=>d.type_id===52)!.data.value=null;
 expect(()=>run(s,note)).toThrow('invalid stat 52');expect(note).not.toHaveBeenCalled();
 const invalid=fixture();invalid.source.raw_data.lineups.find(p=>p.player_id===37731194)!.details!.find(d=>d.type_id===118)!.data.value=null;expect(()=>run(invalid,note)).toThrow();expect(note).not.toHaveBeenCalled();
});
