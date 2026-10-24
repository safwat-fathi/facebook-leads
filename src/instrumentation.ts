// Runs once when the server starts. Starts the background job worker (nodejs runtime only; one long-lived process on the VPS).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { startWorker } = await import('./lib/jobs');
    startWorker();
  } catch (e) {
    console.error('job worker did not start:', (e as Error).message);
  }
}
