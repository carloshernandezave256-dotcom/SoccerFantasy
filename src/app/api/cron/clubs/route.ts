import {NextRequest} from 'next/server';
import {providerAction} from '@/lib/sportmonks-route';
import {syncSportMonksPlayers} from '@/lib/sportmonks-rosters';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:NextRequest){return providerAction(request,()=>syncSportMonksPlayers(),true);}
