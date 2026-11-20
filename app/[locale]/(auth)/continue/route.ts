import { hasLocale } from 'next-intl';
import { NextResponse, type NextRequest } from 'next/server';

import { getProfile } from '@/lib/account/profile';
import { continueTarget } from '@/lib/auth/continue';
import { AuthRefusal, requireUser } from '@/lib/auth/session';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, routing } from '@/lib/i18n/routing';

/**
 * Where a sign in lands (spec 0005 AC-10, spec 0012 AC-4: the password step, `continueTarget`). A Route Handler, not a page: only here can a redirect also set
 * the locale cookie. This is the one place the URL moves to `profiles.locale`, so a shared `/en/...` link
 * opened later stays in English. Renders nothing.
 */

/** A relative Location: the browser stays on the host it came on, and no Host header is trusted. */
function to(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { location: path } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const urlLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const { searchParams } = request.nextUrl;

  try {
    const user = await requireUser();
    const target = continueTarget({
      role: user.role,
      hasPassword: user.hasPassword,
      reset: searchParams.get('reset') === '1',
      next: searchParams.get('next'),
      as: searchParams.get('as'),
    });
    if (!user.role) return to(`/${urlLocale}${target}`);

    const profile = await getProfile(user.id);
    const homeLocale = profile?.locale ?? urlLocale;
    const response = to(`/${homeLocale}${target}`);
    response.cookies.set(LOCALE_COOKIE, homeLocale, {
      path: '/',
      sameSite: 'lax',
      maxAge: LOCALE_COOKIE_MAX_AGE,
    });
    return response;
  } catch (error) {
    if (error instanceof AuthRefusal) return to(`/${urlLocale}/login`);
    throw error;
  }
}
