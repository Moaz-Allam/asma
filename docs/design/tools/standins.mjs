// Stand-ins for the design's borrowed images: every photo becomes an on-brand panel with a simple line
// motif, every avatar becomes the person's initial in the design's own heading font.
const NAVY = '#0f3a73';
const BLUE = '#1e5fb3';

const MOTIFS = {
  home: `<path d="M-150 10 L0 -130 L150 10" /><path d="M-110 -20 V140 H110 V-20" /><path d="M-30 140 V60 H30 V140" />`,
  phone: `<rect x="-95" y="-165" width="190" height="330" rx="34" /><path d="M-25 -140 H25" /><circle cx="0" cy="10" r="58" /><path d="M-26 12 L-6 32 L30 -8" />`,
  mop: `<path d="M-120 -40 H40 L20 150 H-100 Z" /><path d="M-120 -40 Q-40 -90 40 -40" /><path d="M150 -170 L60 120" /><path d="M30 110 L100 140" />`,
  box: `<path d="M-140 -60 L0 -130 L140 -60 L0 10 Z" /><path d="M-140 -60 V90 L0 160 L140 90 V-60" /><path d="M0 10 V160" />`,
  sofa: `<path d="M-150 20 V-40 Q-150 -80 -110 -80 H110 Q150 -80 150 -40 V20" /><rect x="-180" y="10" width="360" height="90" rx="30" /><path d="M-140 100 V140 M140 100 V140" />`,
  tap: `<path d="M-60 -40 V-90 H80 Q130 -90 130 -40 V0" /><path d="M-100 -40 H-20" /><path d="M-160 60 H160 L130 150 H-130 Z" /><path d="M130 20 V40" />`,
  window: `<rect x="-140" y="-150" width="280" height="300" rx="14" /><path d="M0 -150 V150 M-140 0 H140" /><path d="M-100 -110 L-60 -70 M60 30 L100 70" />`,
  door: `<rect x="-90" y="-170" width="180" height="340" rx="12" /><circle cx="50" cy="10" r="10" /><path d="M-160 170 H160" />`,
};
const PHOTO = {
  'land-hero': 'home',
  'cat-home': 'home',
  'hero-clean-bath': 'home',
  'land-customer': 'phone',
  'step-post': 'phone',
  'step-choose': 'phone',
  'step-pay': 'phone',
  'step-confirm': 'phone',
  'land-provider': 'mop',
  'provider-hero': 'mop',
  'cat-more': 'mop',
  move: 'box',
  'work-furniture': 'sofa',
  'work-kitchen': 'tap',
  'work-windows': 'window',
  hallway: 'door',
};
const AVATARS = {
  'av-ahmed': ['أ', NAVY, '#ffffff'],
  'av-mahmoud': ['م', '#dbe7f6', NAVY],
  'av-mona': ['م', '#cfe0f5', BLUE],
  'av-amr': ['ع', '#e4ecf7', NAVY],
  'av-customer': ['س', '#eaf1fa', NAVY],
};

function sparkle(x, y, r, c, o) {
  return `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="${c}" opacity="${o}"/>`;
}

function photoSvg(name) {
  const motif = MOTIFS[PHOTO[name] || 'home'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eaf1fa"/><stop offset="1" stop-color="#d4e3f5"/></linearGradient></defs>
<rect width="1600" height="1200" fill="url(#g)"/>
<circle cx="800" cy="600" r="330" fill="#ffffff" opacity=".55"/>
<circle cx="1180" cy="300" r="120" fill="#dbe7f6"/>
${sparkle(1050, 420, 46, BLUE, 0.8)}${sparkle(560, 360, 30, NAVY, 0.35)}${sparkle(1110, 820, 26, NAVY, 0.3)}
<g transform="translate(800 620)" fill="none" stroke="${NAVY}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">${motif}</g>
</svg>`;
}

async function renderAvatars(browser) {
  const p = await browser.newPage({
    viewport: { width: 400, height: 400 },
    deviceScaleFactor: 1,
  });
  await p.setContent(`<link href="https://fonts.googleapis.com/css2?family=Alexandria:wght@700&display=block" rel="stylesheet">
<div id="a" style="width:400px;height:400px;display:flex;align-items:center;justify-content:center;font:700 200px/1 Alexandria,sans-serif;padding-top:6px;box-sizing:border-box"></div>`);
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(() => document.fonts.load('700 200px Alexandria', 'أمعس'));
  const png = {};
  for (const [name, [ch, bg, fg]] of Object.entries(AVATARS)) {
    await p.evaluate(
      ({ ch, bg, fg }) => {
        const a = document.getElementById('a');
        a.textContent = ch;
        a.style.background = bg;
        a.style.color = fg;
      },
      { ch, bg, fg },
    );
    png[name] = await p.locator('#a').screenshot({ type: 'png' });
  }
  await p.close();
  return png;
}

// Routes every request for img/<name>.<ext> to its stand-in; returns the set of swapped names.
export async function installStandins(browser, ctx) {
  const avatarPng = await renderAvatars(browser);
  const swapped = new Set();
  await ctx.route(/\/img\/[^/]+\.(jpe?g|png|webp)$/i, (route) => {
    const name = decodeURIComponent(route.request().url().split('/').pop()).replace(/\.\w+$/, '');
    swapped.add(name);
    if (avatarPng[name])
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: avatarPng[name],
      });
    return route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: photoSvg(name),
    });
  });
  return swapped;
}
