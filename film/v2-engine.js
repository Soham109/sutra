// Deterministic frame-addressable engine for the final Sutra film.
(function () {
  'use strict'

  var mounted = false
  var film = null
  var api = {
    durationMs: 105000,
    currentMs: 0,
    clamp: function (v, a, b) { return Math.max(a, Math.min(b, v)) },
    progress: function (t, a, b) {
      if (b <= a) return t >= b ? 1 : 0
      return api.clamp((t - a) / (b - a), 0, 1)
    },
    ease: function (v) {
      v = api.clamp(v, 0, 1)
      return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2
    },
    out: function (v) {
      v = api.clamp(v, 0, 1)
      return 1 - Math.pow(1 - v, 3)
    },
    lerp: function (a, b, v) { return a + (b - a) * api.clamp(v, 0, 1) },
    setFilm: function (definition) {
      film = definition
      api.durationMs = definition.durationMs || api.durationMs
    },
    seek: function (ms) {
      if (!film) return
      if (!mounted) {
        mounted = true
        film.mount(document.getElementById('film-stage'))
      }
      api.currentMs = api.clamp(ms, 0, api.durationMs)
      film.draw(api.currentMs)
    },
  }

  Object.defineProperty(api, 'durationMs', { value: 105000, writable: true, enumerable: true })
  window.FILM = api
})()
