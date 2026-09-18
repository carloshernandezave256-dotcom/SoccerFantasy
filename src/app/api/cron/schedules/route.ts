import {NextRequest} from 'next/server';
import {syncSportMonksSchedules} from '@/lib/sportmonks-schedules';
import {providerAction} from '@/lib/sportmonks-route';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:NextRequest){return providerAction(request,()=>syncSportMonksSchedules(),true);}
