import type { ReactNode } from 'react';

interface FooterNavBarProps {
  center: ReactNode;
  leading: ReactNode;
  navWidth: 'compact' | 'full' | 'wide';
  trailing: ReactNode;
  variant: 'chat' | 'search' | 'tabs' | 'terminal';
}

export const FooterNavBar = ({ center, leading, navWidth, trailing, variant }: FooterNavBarProps) => (
  <div className={`footer-nav-shell footer-nav-shell--${navWidth}`}>
    <div className={`footer-nav footer-nav--${variant}`}>
      <div className="footer-nav__slot footer-nav__slot--leading">{leading}</div>
      <div className="footer-nav__slot footer-nav__slot--center">{center}</div>
      <div className="footer-nav__slot footer-nav__slot--trailing">{trailing}</div>
    </div>
  </div>
);
