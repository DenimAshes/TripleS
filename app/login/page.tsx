export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form method="post" action="/api/auth/login" className="panel w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold">TripleS</h1>
          <p className="mt-1 text-sm text-[#666a73]">Sign in to manage playlist sync.</p>
          <p className="mt-2 text-xs text-[#666a73]">For Spotify OAuth, open this app via 127.0.0.1, not localhost.</p>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Email</span>
          <input name="email" defaultValue="admin@example.com" className="w-full rounded-md border border-[#deded8] px-3 py-2" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Password</span>
          <input name="password" type="password" defaultValue="changeme" className="w-full rounded-md border border-[#deded8] px-3 py-2" />
        </label>
        {params.error ? <p className="text-sm text-red-700">Invalid email or password</p> : null}
        <button type="submit" className="w-full rounded-md bg-[#18181b] px-3 py-2 font-medium text-white">Login</button>
      </form>
    </main>
  );
}
