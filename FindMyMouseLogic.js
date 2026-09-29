// Pure state for the Find My Mouse overlay.
// This file does not call Qt, Quickshell, or hyprctl.

var SPOT_RADIUS = 90
var HOLD_MS = 1500
var FADE_MS = 150
var RING_MS = 400
var RING_WIDTH = 3
var POLL_HZ = 30

function createSession() {
  return {
    opened: false,
    phase: "closed",
    pollInFlight: false,
    cursor: null,
    openedAt: 0,
    closeAt: 0,
    fadeEndsAt: 0
  }
}

function copySession(session) {
  var cursor = session && session.cursor
  return {
    opened: !!(session && session.opened),
    phase: session && session.phase ? session.phase : "closed",
    pollInFlight: !!(session && session.pollInFlight),
    cursor: cursor ? { x: Number(cursor.x), y: Number(cursor.y) } : null,
    openedAt: session && session.openedAt ? session.openedAt : 0,
    closeAt: session && session.closeAt ? session.closeAt : 0,
    fadeEndsAt: session && session.fadeEndsAt ? session.fadeEndsAt : 0
  }
}

// 30 Hz is one sample every 1000/30 ms.
function pollIntervalMs() {
  return 1000 / POLL_HZ
}

function isSessionClosed(session) {
  return !session || session.opened !== true
}

// The spotlight stays hidden until the first cursor sample.
function isShown(session) {
  return !!session && session.phase === "showing" && !!session.cursor
}

// The window stays up through the fade-out.
function isWindowVisible(session) {
  return !!session && (session.phase === "showing" || session.phase === "fading")
}

function openSession(session, now) {
  return {
    opened: true,
    phase: "waiting",
    pollInFlight: false,
    cursor: null,
    openedAt: now,
    closeAt: now + HOLD_MS,
    fadeEndsAt: 0
  }
}

function closeSession(session, now, fadeMs) {
  var current = session || createSession()
  if (current.phase === "closed" || current.phase === "fading") {
    var idle = copySession(current)
    idle.opened = false
    idle.pollInFlight = false
    return idle
  }

  var fade = Number(fadeMs)
  if (!isFinite(fade) || fade < 0) fade = FADE_MS
  var cursor = current.cursor ? { x: Number(current.cursor.x), y: Number(current.cursor.y) } : null
  if (current.phase !== "showing" || !cursor || fade === 0) {
    return {
      opened: false,
      phase: "closed",
      pollInFlight: false,
      cursor: cursor,
      openedAt: current.openedAt || 0,
      closeAt: current.closeAt || 0,
      fadeEndsAt: now
    }
  }

  return {
    opened: false,
    phase: "fading",
    pollInFlight: false,
    cursor: cursor,
    openedAt: current.openedAt || 0,
    closeAt: current.closeAt || 0,
    fadeEndsAt: now + fade
  }
}

function completeFade(session, now) {
  if (!session || session.phase !== "fading") return session
  var next = copySession(session)
  next.opened = false
  next.phase = "closed"
  next.pollInFlight = false
  next.fadeEndsAt = now
  return next
}

// Close the session when the hold time has elapsed.
// Finish the fade when its deadline has elapsed.
function tick(session, now, fadeMs) {
  var next = session || createSession()
  if (next.opened === true && now >= next.closeAt) next = closeSession(next, now, fadeMs)
  if (next.phase === "fading" && now >= next.fadeEndsAt) next = completeFade(next, now)
  return next
}

function shouldPoll(session) {
  return !!session && session.opened === true && session.pollInFlight !== true
}

function beginPoll(session) {
  if (!shouldPoll(session)) return { session: session, started: false }
  var next = copySession(session)
  next.pollInFlight = true
  return { session: next, started: true }
}

function endPoll(session) {
  if (!session || session.pollInFlight !== true) return session
  var next = copySession(session)
  next.pollInFlight = false
  return next
}

function parseCursorpos(raw) {
  try {
    var data = JSON.parse(String(raw || ""))
    if (!data || typeof data !== "object") return null
    var x = Number(data.x)
    var y = Number(data.y)
    if (!isFinite(x) || !isFinite(y)) return null
    return { x: x, y: y }
  } catch (e) {
    return null
  }
}

function applyCursor(session, raw) {
  var cursor = parseCursorpos(raw)
  if (!session || session.opened !== true || !cursor) return session
  var next = copySession(session)
  next.cursor = cursor
  if (session.phase === "waiting") next.phase = "showing"
  return next
}

function scaleOf(monitor) {
  var scale = Number(monitor && monitor.scale)
  if (!isFinite(scale) || scale <= 0) return 1
  return scale
}

function transformOf(monitor) {
  if (!monitor) return 0
  if (monitor.transform !== undefined && monitor.transform !== null && isFinite(Number(monitor.transform))) {
    return Number(monitor.transform)
  }
  var ipc = monitor.lastIpcObject
  if (ipc && ipc.transform !== undefined && ipc.transform !== null && isFinite(Number(ipc.transform))) {
    return Number(ipc.transform)
  }
  return 0
}

// A transform of 1, 3, 5, or 7 rotates the monitor by 90 degrees.
function axesSwapped(transform) {
  var n = Number(transform)
  if (!isFinite(n)) return false
  n = Math.abs(Math.trunc(n))
  return n % 2 === 1
}

// hyprctl width and height are mode pixels.
// cursorpos uses layout pixels.
// Layout size is the transformed mode size divided by scale.
function layoutBox(monitor) {
  var width = Number(monitor && monitor.width)
  var height = Number(monitor && monitor.height)
  if (axesSwapped(transformOf(monitor))) {
    var swap = width
    width = height
    height = swap
  }
  var scale = scaleOf(monitor)
  return {
    x: Number(monitor && monitor.x) || 0,
    y: Number(monitor && monitor.y) || 0,
    width: width / scale,
    height: height / scale
  }
}

function monitorContains(monitor, cursorX, cursorY) {
  if (!monitor) return false
  var box = layoutBox(monitor)
  var x = Number(cursorX)
  var y = Number(cursorY)
  if (!isFinite(x) || !isFinite(y) || !isFinite(box.width) || !isFinite(box.height)) return false
  return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height
}

function localCursor(monitor, cursorX, cursorY) {
  var originX = monitor ? Number(monitor.x) || 0 : 0
  var originY = monitor ? Number(monitor.y) || 0 : 0
  return {
    x: Number(cursorX) - originX,
    y: Number(cursorY) - originY
  }
}

function locate(monitors, cursorX, cursorY) {
  var list = monitors || []
  for (var i = 0; i < list.length; i++) {
    var monitor = list[i]
    if (!monitorContains(monitor, cursorX, cursorY)) continue
    return {
      monitor: monitor,
      local: localCursor(monitor, cursorX, cursorY)
    }
  }
  return { monitor: null, local: null }
}

// The border rectangle leaves a clear circle of spotRadius.
// reach is the window diagonal, so the border covers the screen.
function spotlightRect(windowWidth, windowHeight, localX, localY, spotRadius) {
  var radius = spotRadius === undefined || spotRadius === null ? SPOT_RADIUS : Number(spotRadius)
  var reach = Math.hypot(Number(windowWidth), Number(windowHeight))
  var size = 2 * (radius + reach)
  return {
    reach: reach,
    width: size,
    height: size,
    radius: size / 2,
    x: Number(localX) - radius - reach,
    y: Number(localY) - radius - reach
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SPOT_RADIUS: SPOT_RADIUS,
    HOLD_MS: HOLD_MS,
    FADE_MS: FADE_MS,
    RING_MS: RING_MS,
    RING_WIDTH: RING_WIDTH,
    POLL_HZ: POLL_HZ,
    createSession: createSession,
    pollIntervalMs: pollIntervalMs,
    isSessionClosed: isSessionClosed,
    isShown: isShown,
    isWindowVisible: isWindowVisible,
    openSession: openSession,
    closeSession: closeSession,
    completeFade: completeFade,
    tick: tick,
    shouldPoll: shouldPoll,
    beginPoll: beginPoll,
    endPoll: endPoll,
    parseCursorpos: parseCursorpos,
    applyCursor: applyCursor,
    layoutBox: layoutBox,
    monitorContains: monitorContains,
    localCursor: localCursor,
    locate: locate,
    spotlightRect: spotlightRect
  }
}
