interface TextInputFocusEvent {
  preventDefault(): void;
}

interface TextInputLike {
  focus(options?: FocusOptions): void;
  setSelectionRange(start: number, end: number): void;
  value: string;
}

export const focusTextInputWithoutPageJump = (
  input: TextInputLike | null,
  activeElement: unknown,
  event?: TextInputFocusEvent,
) => {
  if (!input || activeElement === input) {
    return false;
  }

  event?.preventDefault();

  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }

  const selectionPoint = input.value.length;
  input.setSelectionRange(selectionPoint, selectionPoint);
  return true;
};
