import type { CSSProperties, ElementType, ReactNode } from 'react';
import { cx } from '../../lib/format';

/**
 * Entrance animation that CANNOT hide content.
 *
 * The obvious way to do this is a JS-driven `initial={{ opacity: 0 }}`, and it
 * is a trap: if requestAnimationFrame is throttled or suspended — a background
 * tab, a low-power device, an automated capture — the animation never runs and
 * the content is left permanently invisible. We hit exactly that: two whole
 * pages rendered 39KB of correct DOM at `opacity: 0`.
 *
 * So the resting state here is VISIBLE, and the animation is purely additive.
 * A CSS keyframe with `animation-fill-mode: both` always ends on its final
 * frame, and if animations are disabled entirely the content simply shows.
 */
export function Reveal({
  children, delay = 0, className, as: Tag = 'div', style, ...rest
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: ElementType;
  style?: CSSProperties;
} & Record<string, unknown>) {
  return (
    <Tag
      className={cx('animate-fade-up', className)}
      style={{
        // Capped: with `animation-fill-mode: both` an element is invisible for
        // the whole of its delay, so a long stagger hides late list items.
        animationDelay: delay ? `${Math.min(delay, 260)}ms` : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
