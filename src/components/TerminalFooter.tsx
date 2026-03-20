import { Icon } from './Icon';

interface TerminalFooterProps {
  openTabCount: number;
  statusLabel: string;
  onOpenTabs: () => void;
}

export const TerminalFooter = ({ openTabCount, statusLabel, onOpenTabs }: TerminalFooterProps) => (
  <div className="terminal-footer">
    <div className="terminal-footer__pill">
      <Icon name="terminal" size={14} />
      <span>{statusLabel}</span>
    </div>

    <button className="footer-action footer-action--tabs" type="button" onClick={onOpenTabs} aria-label="Open tabs">
      <span>{openTabCount}</span>
    </button>
  </div>
);
