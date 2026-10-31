/**
 * Numbers the sign in screen shows or counts on. The limits themselves live inside Auth and Twilio
 * Verify (D98, spec 0005 AC-5): these only keep the screen honest about them.
 */

/** Seconds before a resend. Equal to the OTP send window per phone, owner step S22. */
export const RESEND_SECONDS = 60;

/** The sessionStorage key that survives a reload on the code step (AC-6). */
export const LOGIN_STEP_KEY = 'login_step';

/** How long a code lives in Twilio Verify, so how long the code step is worth coming back to. */
export const LOGIN_STEP_MS = 10 * 60 * 1000;

/** Digits in a code (D55). */
export const CODE_LENGTH = 6;
