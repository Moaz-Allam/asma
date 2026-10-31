/**
 * Options for the Supabase session cookies, the same in every client (spec 0005 Configuration).
 * `secure` on a deployment. Other flags stay the library's defaults: the browser client must read them.
 *
 * NEXT_PUBLIC_APP_ENV is set at build in next.config.ts, so the browser, the server and the proxy agree.
 */
export function authCookieOptions(): { secure: boolean } {
  const env = process.env.NEXT_PUBLIC_APP_ENV;
  return { secure: env === 'production' || env === 'preview' };
}
