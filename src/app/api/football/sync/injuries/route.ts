import {NextRequest} from 'next/server';
import {syncSportMonksInjuries} from '@/lib/sportmonks-rosters';
import {providerAction} from '@/lib/sportmonks-route';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function POST(request:NextRequest){return providerAction(request,()=>syncSportMonksInjuries(),false);}
