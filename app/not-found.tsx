import Link from "next/link";
import { connection } from "next/server";

// `await connection()` opts this page into dynamic rendering. Without it Next prerenders
// `/_not-found` at build time, when no request (and therefore no CSP nonce) exists — the
// emitted <script> tags would carry no nonce and `'strict-dynamic'` in the CSP would refuse
// them, so the 404 page would render but never hydrate. See proxy.ts and the Next CSP guide.
export default async function NotFound() {
  await connection();
  return (
    <div className="min-h-screen flex flex-col bg-white font-body">
      <div className="flex-1 flex flex-col items-center justify-start pt-[20vh] px-4">
        <div className="text-center max-w-md">
          <p className="font-headline text-[72px] font-bold tracking-wide leading-none">
            404
          </p>
          <h2 className="mt-4 font-headline text-[24px] font-bold tracking-wide">
            Page Not Found
          </h2>
          <p className="mt-3 font-headline text-[16px] text-caption leading-relaxed">
            The page you&rsquo;re looking for doesn&rsquo;t exist or has been moved.
          </p>
          <div className="mt-8">
            <Link
              href="/"
              className="font-headline font-bold text-[14px] tracking-wide bg-ink text-white px-6 py-2.5 hover:bg-maroon transition-colors"
            >
              Back to Homepage
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
