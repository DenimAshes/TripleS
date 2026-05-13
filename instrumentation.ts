export async function register() {
  if (!process.env.SPOTIFY_CLIENT_ID) {
    console.log("[spotify] Running in MOCK mode");
  }
  console.log("[youtube] Running in MOCK mode");
  console.log("[soundcloud] Running in MOCK mode");
}
