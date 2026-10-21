import {NextRequest} from 'next/server';
import {scoringCron} from '@/lib/scoring-cron';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:NextRequest){return scoringCron(request,'scores');}
