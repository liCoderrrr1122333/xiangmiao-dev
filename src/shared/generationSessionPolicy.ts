export function isNewerAutomationLifecycleSequence(lastSequence: number, nextSequence: number) {
  return Number.isSafeInteger(nextSequence) && nextSequence > lastSequence;
}

export function shouldDisableGenerationAction(isGeneratingImage: boolean, isPauseRequested: boolean) {
  return isGeneratingImage && isPauseRequested;
}
