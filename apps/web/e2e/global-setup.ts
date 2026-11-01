// Fails fast with a useful message when the backend is not running.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default async function globalSetup(): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/health`);
    if (res.ok) return;
    throw new Error(`status ${res.status}`);
  } catch (err) {
    throw new Error(
      `The api at ${API_URL} is not answering (${(err as Error).message}). Start the backend first: apps/web/scripts/dev-backend.sh start`,
    );
  }
}
