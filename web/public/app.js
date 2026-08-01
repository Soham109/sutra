// shared helpers for the sutra surfaces
window.gmp = (() => {
  const fmt = (minor, currency = 'USD') => {
    const sym = currency === 'USD' ? '$' : currency === 'INR' ? '₹' : currency + ' '
    const sign = minor < 0 ? '-' : ''
    const abs = Math.abs(minor)
    return `${sign}${sym}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
  }

  const api = async (path, opts = {}) => {
    const res = await fetch(path, {
      headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    if (!res.ok) {
      let msg = `${res.status}`
      try { msg = (await res.json()).error || msg } catch {}
      throw new Error(msg)
    }
    return res.json()
  }

  // SSE with auto-reconnect; onEvent(evt) for each protocol event
  const listen = (groupId, after, onEvent) => {
    let cursor = after || 0
    const connect = () => {
      const es = new EventSource(`/v1/groups/${groupId}/events?after=${cursor}`)
      es.addEventListener('gmp', (e) => {
        const evt = JSON.parse(e.data)
        cursor = evt.seq
        onEvent(evt)
      })
      es.onerror = () => { es.close(); setTimeout(connect, 1200) }
    }
    connect()
  }

  const countdown = (el, deadlineIso) => {
    const tick = () => {
      const ms = new Date(deadlineIso) - Date.now()
      if (ms <= 0) { el.textContent = 'deadline passed'; return }
      const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000)
      el.textContent = `${m}:${String(s).padStart(2, '0')} left to decide`
      setTimeout(tick, 1000)
    }
    tick()
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c])

  const anonName = (group, name) => group.no_blame ? 'a member' : name

  return { fmt, api, listen, countdown, esc, anonName }
})()
