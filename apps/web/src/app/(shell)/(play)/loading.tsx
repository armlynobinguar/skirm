// Loading UI for the play screens (agents, campaign, daily, maps, puzzles) while they stream in.
import { RouteLoading } from '@/components/states/RouteLoading';

export default function Loading() {
  return <RouteLoading layout="list" label="Loading" />;
}
