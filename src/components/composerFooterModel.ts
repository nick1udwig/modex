export type ComposerFooterMode = 'chat' | 'tabs'

export interface ComposerFooterLayout {
  centerSlot: 'new-tab' | 'open-tabs' | 'search-status'
  leftSlot: 'search' | 'search-previous'
  navWidth: 'compact' | 'full' | 'wide'
  rightSlot: 'menu' | 'placeholder' | 'search-next'
  variant: ComposerFooterMode | 'search'
}

interface ComposerFooterLayoutOptions {
  mode: ComposerFooterMode
  searchActive: boolean
}

export const resolveComposerFooterLayout = ({
  mode,
  searchActive,
}: ComposerFooterLayoutOptions): ComposerFooterLayout => {
  if (searchActive) {
    return {
      centerSlot: 'search-status',
      leftSlot: 'search-previous',
      navWidth: 'full',
      rightSlot: 'search-next',
      variant: 'search',
    }
  }

  if (mode === 'tabs') {
    return {
      centerSlot: 'new-tab',
      leftSlot: 'search',
      navWidth: 'wide',
      rightSlot: 'menu',
      variant: 'tabs',
    }
  }

  return {
    centerSlot: 'open-tabs',
    leftSlot: 'search',
    navWidth: 'compact',
    rightSlot: 'menu',
    variant: 'chat',
  }
}
