// Loading UI for the Exchange and skill screens; /market renders its first page of cards on the server.
import { RouteLoading } from '@/components/states/RouteLoading';

export default function Loading() {
  return <RouteLoading layout="grid" label="Loading" />;
}
