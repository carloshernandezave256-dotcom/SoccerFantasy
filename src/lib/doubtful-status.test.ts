import {expect,it} from 'vitest';
import {hasDoubtfulWarning} from './doubtful-status';
it('shows only current warnings and lets injury status take priority',()=>{
 const now=Date.parse('2026-09-18T12:00:00Z');
 expect(hasDoubtfulWarning({injured:false,doubtful_until:'2026-09-20T12:00:00Z'},now)).toBe(true);
 expect(hasDoubtfulWarning({injured:true,doubtful_until:'2026-09-20T12:00:00Z'},now)).toBe(false);
 expect(hasDoubtfulWarning({injured:false,doubtful_until:'2026-09-18T12:00:00Z'},now)).toBe(false);
 expect(hasDoubtfulWarning(null,now)).toBe(false);
});
