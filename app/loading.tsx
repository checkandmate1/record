// Route-level Suspense fallback (Next.js `loading.tsx`), shown while a server component
// segment is fetching data. Kept intentionally minimal — no new dependencies, just the
// masthead wordmark plus a few pulsing grey bars using the existing globals.css tokens.
export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      <header className="px-4 sm:px-8 pt-4 pb-2">
        <div className="max-w-[1200px] mx-auto text-center">
          <h1 className="font-masthead text-[44px] sm:text-[60px] lg:text-[72px] leading-none tracking-tight text-ink/90">
            The Record
          </h1>
          <p className="font-body text-[11px] sm:text-[13px] tracking-[0.08em] mt-0.5 text-caption">
            Horace Mann&rsquo;s Weekly Newspaper Since 1903
          </p>
        </div>
      </header>

      <div className="border-t border-rule">
        <div className="h-[2px]" />
      </div>

      <main
        className="flex-1 max-w-[1200px] w-full mx-auto px-4 sm:px-8 pt-10 pb-16 animate-pulse"
        aria-busy="true"
        aria-live="polite"
      >
        <div className="h-6 w-2/3 sm:w-1/3 bg-neutral-100 rounded-sm" />
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-8">
          <div className="sm:col-span-2 space-y-4">
            <div className="aspect-[3/2] bg-neutral-100" />
            <div className="h-5 w-5/6 bg-neutral-100 rounded-sm" />
            <div className="h-4 w-full bg-neutral-100 rounded-sm" />
            <div className="h-4 w-4/5 bg-neutral-100 rounded-sm" />
          </div>
          <div className="space-y-4">
            <div className="h-4 w-1/2 bg-neutral-100 rounded-sm" />
            <div className="h-4 w-full bg-neutral-100 rounded-sm" />
            <div className="h-4 w-full bg-neutral-100 rounded-sm" />
            <div className="h-4 w-2/3 bg-neutral-100 rounded-sm" />
          </div>
        </div>
      </main>
    </div>
  );
}
