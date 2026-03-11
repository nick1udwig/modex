import type { CSSProperties, SVGProps } from 'react';

export type IconName =
  | 'arrow-left'
  | 'arrow-down'
  | 'arrow-up'
  | 'battery-full'
  | 'ellipsis'
  | 'loader'
  | 'menu'
  | 'mic'
  | 'panel-right-open'
  | 'plus'
  | 'search'
  | 'wifi'
  | 'x';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  spin?: boolean;
}

const iconStyle = (size: number): CSSProperties => ({
  width: size,
  height: size,
  flex: '0 0 auto',
});

export const Icon = ({ name, size = 18, spin = false, style, ...props }: IconProps) => {
  const mergedStyle = {
    ...iconStyle(size),
    ...style,
  };

  switch (name) {
    case 'menu':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={mergedStyle} {...props}>
          <path d="M4 7h16" strokeLinecap="round" />
          <path d="M4 12h16" strokeLinecap="round" />
          <path d="M4 17h16" strokeLinecap="round" />
        </svg>
      );
    case 'panel-right-open':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={mergedStyle} {...props}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M14 5v14" />
          <path d="m10 9-2 3 2 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'plus':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={mergedStyle} {...props}>
          <path d="M12 5v14" strokeLinecap="round" />
          <path d="M5 12h14" strokeLinecap="round" />
        </svg>
      );
    case 'mic':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={mergedStyle} {...props}>
          <rect x="9" y="4" width="6" height="11" rx="3" />
          <path d="M6.5 11.5A5.5 5.5 0 0 0 17.5 11.5" strokeLinecap="round" />
          <path d="M12 17v3" strokeLinecap="round" />
          <path d="M9 20h6" strokeLinecap="round" />
        </svg>
      );
    case 'arrow-up':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={mergedStyle} {...props}>
          <path d="M12 18V7" strokeLinecap="round" />
          <path d="m7 12 5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'arrow-down':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={mergedStyle} {...props}>
          <path d="M12 6v11" strokeLinecap="round" />
          <path d="m7 12 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'search':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={mergedStyle} {...props}>
          <circle cx="11" cy="11" r="6" />
          <path d="m16 16 4 4" strokeLinecap="round" />
        </svg>
      );
    case 'ellipsis':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" style={mergedStyle} {...props}>
          <circle cx="6" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="18" cy="12" r="1.7" />
        </svg>
      );
    case 'loader':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          style={mergedStyle}
          className={spin ? 'icon-spin' : undefined}
          {...props}
        >
          <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
        </svg>
      );
    case 'arrow-left':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={mergedStyle} {...props}>
          <path d="m12 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 12h12" strokeLinecap="round" />
        </svg>
      );
    case 'wifi':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={mergedStyle} {...props}>
          <path d="M4.5 9.5a12 12 0 0 1 15 0" strokeLinecap="round" />
          <path d="M7.5 12.5a8 8 0 0 1 9 0" strokeLinecap="round" />
          <path d="M10.5 15.5a4 4 0 0 1 3 0" strokeLinecap="round" />
          <circle cx="12" cy="18.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'battery-full':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={mergedStyle} {...props}>
          <rect x="3.5" y="7" width="16" height="10" rx="2" />
          <path d="M19.5 10h1.5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-1.5" />
          <rect x="6.5" y="9.5" width="10" height="5" rx="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'x':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={mergedStyle} {...props}>
          <path d="M6 6 18 18" strokeLinecap="round" />
          <path d="M18 6 6 18" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
};
