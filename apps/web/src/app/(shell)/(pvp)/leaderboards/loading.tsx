// Loading UI for the leaderboards while they stream in.
import { RouteLoading } from '@/components/states/RouteLoading';

export default function Loading() {
  return <RouteLoading layout="table" label="Loading the leaderboards" />;
}
