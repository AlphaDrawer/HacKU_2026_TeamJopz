import './style.css'
import './app'

const base = import.meta.env.BASE_URL
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // Offline cache is an enhancement; the app remains usable if SW is unavailable.
    })
  })
}
