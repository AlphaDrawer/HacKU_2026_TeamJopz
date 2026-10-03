export type CameraErrorKind = 'unsupported' | 'permission' | 'unavailable' | 'unknown'

export class CameraError extends Error {
  constructor(public readonly kind: CameraErrorKind, message: string) {
    super(message)
    this.name = 'CameraError'
  }
}

/** Owns a single local MediaStream and never transmits or persists video. */
export class CameraController {
  private stream: MediaStream | null = null
  onEnded: (() => void) | null = null

  async start(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError('unsupported', '此瀏覽器無法使用相機。請使用支援相機的 HTTPS 網頁瀏覽器。')
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      const ownedStream = this.stream
      ownedStream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (this.stream !== ownedStream) return
          this.stream = null
          this.onEnded?.()
        }, { once: true })
      })
      return this.stream
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new CameraError('permission', '相機權限未開啟。請在瀏覽器設定允許相機，或改用不開相機的模式。')
      }
      if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') {
        throw new CameraError('unavailable', '找不到可用相機，或相機正被其他應用程式使用。')
      }
      throw new CameraError('unknown', '無法開啟相機。請確認瀏覽器權限後再試。')
    }
  }

  attach(video: HTMLVideoElement): void {
    if (!this.stream) return
    video.srcObject = this.stream
    void video.play().catch(() => undefined)
  }

  stop(): void {
    const stream = this.stream
    this.stream = null
    stream?.getTracks().forEach((track) => track.stop())
  }

  get active(): boolean {
    return this.stream !== null && this.stream.getVideoTracks().some((track) => track.readyState === 'live')
  }
}
