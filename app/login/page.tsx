export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      {/* Backdrop glow — matches the cool tinted feel of the dashboard. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[50vh] bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_srgb,var(--accent)_18%,transparent),transparent_70%)]" />
      <form method="post" action="/api/auth/login" className="panel w-full max-w-sm space-y-5 p-7">
        <div>
          <div className="mb-2 grid h-11 w-11 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent)] font-bold text-[var(--on-accent)]">
            S
          </div>
          <h1 className="heading-page">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted-fg">Sign in to manage your playlist sync.</p>
          <p className="mt-2 text-xs text-dim-fg">
            For Spotify OAuth, open this app via 127.0.0.1 (not localhost).
          </p>
        </div>
        <label className="block space-y-1.5">
          <span className="field-label">Email</span>
          <input name="email" defaultValue="admin@example.com" className="w-full" />
        </label>
        <label className="block space-y-1.5">
          <span className="field-label">Password</span>
          <input name="password" type="password" defaultValue="changeme" className="w-full" />
        </label>
        {params.error ? <p className="text-sm text-danger-fg">Invalid email or password</p> : null}
        <button type="submit" className="btn btn-primary w-full">
          Sign in
        </button>
      </form>
    </main>
  );
}
