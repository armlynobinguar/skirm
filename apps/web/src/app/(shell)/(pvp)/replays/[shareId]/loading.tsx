// Loading UI for a shared replay; its link preview is read on the server first.
import { RouteLoading } from '@/components/states/RouteLoading';

export default function Loading() {
  return <RouteLoading layout="detail" label="Loading the replay" />;
}
