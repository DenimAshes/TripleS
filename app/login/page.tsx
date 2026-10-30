import { ServiceIcon, serviceMeta, type ServiceKey } from "@/components/ServiceBrand";
import { TripleSMark } from "@/components/TripleSMark";

const SERVICES: ServiceKey[] = ["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;

  return (
    <main className="px-5 py-10 sm:py-14">
      <div className="mx-auto grid min-h-[calc(100vh-7rem)] max-w-5xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-20">
        <section className="max-w-xl">
          <div className="flex items-center gap-3">
            <TripleSMark size="lg" />
            <div>
              <div translate="no" className="text-lg font-semibold tracking-[-0.025em] text-[var(--text)]">TripleS</div>
              <div className="text-sm text-muted-fg">Playlist relay</div>
            </div>
          </div>

          <h1 className="mt-8 max-w-lg text-4xl leading-[1.06] font-semibold tracking-[-0.04em] text-balance text-[var(--text)] sm:text-5xl">
            One control room for every playlist.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-fg">
            Keep Spotify, YouTube Music and SoundCloud copies aligned without hopping between apps.
          </p>

          <div className="mt-9 hidden max-w-md gap-3 sm:grid" aria-hidden="true">
            {SERVICES.map((service, index) => {
              const meta = serviceMeta(service);
              return (
                <div key={service} className={`${meta.tint} flex items-center gap-3`}>
                  <ServiceIcon service={service} size="sm" />
                  <span translate="no" className="w-28 text-sm font-medium text-[var(--text)]">{meta.label}</span>
                  <span className="relative h-px flex-1 overflow-hidden bg-[var(--border-soft)]">
                    <span
                      className="absolute inset-y-0 left-0 bg-[var(--service-glow)] opacity-55"
                      style={{ width: `${68 + index * 12}%` }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <form method="post" action="/api/auth/login" className="panel w-full space-y-5 p-6 sm:p-7">
          <div>
            <h2 className="heading-card">Welcome back</h2>
            <p className="mt-1.5 text-sm text-muted-fg">Sign in to open your sync workspace.</p>
          </div>
          <label className="block space-y-1.5">
            <span className="field-label">Email</span>
            <input name="email" type="email" autoComplete="username" spellCheck={false} required className="w-full" />
          </label>
          <label className="block space-y-1.5">
            <span className="field-label">Password</span>
            <input name="password" type="password" autoComplete="current-password" required className="w-full" />
          </label>
          {params.error ? (
            <p role="alert" className="text-sm text-danger-fg">
              That email and password do not match.
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary w-full">
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
