/** Runs once when the server starts: validate the environment before serving anything. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./env');
  }
}
