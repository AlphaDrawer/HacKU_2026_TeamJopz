export class VoicePrompt {
  private speech: SpeechSynthesis | null
  private utterance: SpeechSynthesisUtterance | null = null

  constructor() {
    this.speech = 'speechSynthesis' in window ? window.speechSynthesis : null
  }

  get available(): boolean {
    return this.speech !== null && 'SpeechSynthesisUtterance' in window
  }

  speak(text: string, enabled: boolean): void {
    this.stop()
    if (!enabled || !this.available || !this.speech) return
    this.utterance = new SpeechSynthesisUtterance(text)
    this.utterance.lang = 'zh-HK'
    this.utterance.rate = 0.9
    this.speech.speak(this.utterance)
  }

  stop(): void {
    this.speech?.cancel()
    this.utterance = null
  }
}
