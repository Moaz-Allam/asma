import Image from 'next/image';

import { cn } from '@/lib/utils';

/**
 * A photo slot of the design. The files in `public/landing/` are the design's borrowed photos for now (D109,
 * Q12): replacing a file under the same name is all an owned photo needs.
 */
export function LandingPhoto({
  slot,
  sizes,
  priority = false,
  className,
  focus,
}: {
  slot: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  /** Where the crop centres, as CSS object-position (a landscape photo in a tall box). */
  focus?: string;
}) {
  return (
    <div className={cn('flex overflow-hidden rounded-panel', className)}>
      <div className="relative w-full flex-1">
        <Image
          src={`/landing/${slot}.jpg`}
          alt=""
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
          style={focus ? { objectPosition: focus } : undefined}
        />
      </div>
    </div>
  );
}
