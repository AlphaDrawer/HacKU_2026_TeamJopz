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
      throw new CameraError('unsupported', '当前浏览器无法使用相机。请在支持相机的 HTTPS 网页浏览器中打开。')
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
        throw new CameraError('permission', '相机权限未开启。请在浏览器设置中允许相机，或改用不开相机的模式。')
      }
      if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') {
        throw new CameraError('unavailable', '找不到可用相机，或相机正被其他应用占用。')
      }
      throw new CameraError('unknown', '无法开启相机。请确认浏览器权限后再试。')
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
