const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const pluginDir = __dirname
const logic = require("./FindMyMouseLogic.js")

const monitors = [
  { name: "DP-1", x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
  { name: "DP-2", x: 1920, y: 100, width: 1280, height: 1024, scale: 1 }
]

test("two-monitor hit test and local coordinates", function () {
  const onRight = logic.locate(monitors, 2000, 180)
  assert.equal(onRight.monitor.name, "DP-2")
  assert.deepEqual(onRight.local, { x: 80, y: 80 })
  assert.deepEqual(logic.localCursor(monitors[1], 2000, 180), { x: 80, y: 80 })

  const onLeft = logic.locate(monitors, 1919, 10)
  assert.equal(onLeft.monitor.name, "DP-1")
  assert.deepEqual(onLeft.local, { x: 1919, y: 10 })

  const sharedEdge = logic.locate(monitors, 1920, 100)
  assert.equal(sharedEdge.monitor.name, "DP-2")
  assert.deepEqual(sharedEdge.local, { x: 0, y: 0 })

  const gap = logic.locate(monitors, 1920, 50)
  assert.equal(gap.monitor, null)
  assert.equal(gap.local, null)

  const fractional = [
    { name: "hidpi", x: 0, y: 0, width: 1920, height: 1080, scale: 1.5 },
    { name: "next", x: 1280, y: 0, width: 1920, height: 1080, scale: 1 }
  ]
  const onHidpi = logic.locate(fractional, 1279, 719)
  assert.equal(onHidpi.monitor.name, "hidpi")
  assert.deepEqual(onHidpi.local, { x: 1279, y: 719 })
  const onNext = logic.locate(fractional, 1280, 10)
  assert.equal(onNext.monitor.name, "next")
  assert.deepEqual(onNext.local, { x: 0, y: 10 })
  assert.equal(logic.locate(fractional, 100, 720).monitor, null)

  const rotated = { name: "tall", x: 0, y: 0, width: 1920, height: 1080, scale: 1, transform: 1 }
  assert.equal(logic.monitorContains(rotated, 100, 1500), true)
  assert.deepEqual(logic.localCursor(rotated, 100, 1500), { x: 100, y: 1500 })
  assert.equal(logic.monitorContains(rotated, 1100, 100), false)
})

test("spotlight rectangle for radius 90", function () {
  const width = 1920
  const height = 1080
  const localX = 400
  const localY = 300
  const rect = logic.spotlightRect(width, height, localX, localY, logic.SPOT_RADIUS)

  assert.equal(logic.SPOT_RADIUS, 90)
  assert.equal(logic.RING_WIDTH, 3)
  assert.equal(logic.FADE_MS, 150)
  assert.equal(logic.RING_MS, 400)
  assert.equal(rect.reach, Math.hypot(width, height))
  assert.equal(rect.width, 2 * (90 + rect.reach))
  assert.equal(rect.height, rect.width)
  assert.equal(rect.radius, rect.width / 2)
  assert.equal(rect.x, localX - 90 - rect.reach)
  assert.equal(rect.y, localY - 90 - rect.reach)
  assert.equal(rect.x + rect.width / 2, localX)
  assert.equal(rect.y + rect.height / 2, localY)
  assert.equal(rect.radius - rect.reach, 90)
  assert.ok(rect.radius >= Math.hypot(width, height))

  const fallback = logic.spotlightRect(width, height, localX, localY)
  assert.equal(fallback.radius - fallback.reach, 90)
})

test("poll gate is 30 Hz, only while open, and skipped while a poll is in flight", function () {
  assert.equal(logic.POLL_HZ, 30)
  assert.equal(logic.pollIntervalMs(), 1000 / 30)

  const closed = logic.createSession()
  assert.equal(logic.shouldPoll(closed), false)
  assert.equal(logic.beginPoll(closed).started, false)

  let session = logic.openSession(closed, 0)
  assert.equal(logic.shouldPoll(session), true)
  const first = logic.beginPoll(session)
  assert.equal(first.started, true)
  assert.equal(first.session.pollInFlight, true)
  assert.equal(logic.shouldPoll(first.session), false)

  const second = logic.beginPoll(first.session)
  assert.equal(second.started, false)
  assert.equal(second.session, first.session)

  session = logic.applyCursor(first.session, "{\"x\":3,\"y\":4}")
  assert.equal(session.pollInFlight, true)
  assert.equal(logic.shouldPoll(session), false)
  assert.equal(logic.isShown(session), true)

  session = logic.endPoll(session)
  assert.equal(session.pollInFlight, false)
  assert.equal(logic.shouldPoll(session), true)
  assert.equal(session.cursor.x, 3)
  assert.equal(session.cursor.y, 4)

  session = logic.closeSession(session, 10, 0)
  assert.equal(logic.shouldPoll(session), false)
  assert.equal(logic.beginPoll(session).started, false)
})

test("nothing is shown until the first cursor sample", function () {
  let session = logic.openSession(logic.createSession(), 0)
  assert.equal(session.phase, "waiting")
  assert.equal(logic.isShown(session), false)
  assert.equal(logic.isWindowVisible(session), false)

  const started = logic.beginPoll(session)
  session = logic.applyCursor(started.session, "not json")
  assert.equal(logic.isShown(session), false)
  assert.equal(logic.isWindowVisible(session), false)

  session = logic.applyCursor(started.session, "{\"x\":4,\"y\":5}")
  assert.equal(logic.isShown(session), true)
  assert.equal(logic.isWindowVisible(session), true)
  assert.deepEqual(session.cursor, { x: 4, y: 5 })

  const idle = logic.applyCursor(logic.createSession(), "{\"x\":1,\"y\":2}")
  assert.equal(logic.isShown(idle), false)
  assert.equal(idle.cursor, null)
})

test("close and the 1.5 s timer leave the session closed, then a later open succeeds", function () {
  assert.equal(logic.HOLD_MS, 1500)

  let session = logic.openSession(logic.createSession(), 1000)
  session = logic.applyCursor(logic.beginPoll(session).session, "{\"x\":1,\"y\":2}")
  session = logic.closeSession(session, 1100, logic.FADE_MS)
  assert.equal(session.opened, false)
  assert.equal(logic.isSessionClosed(session), true)
  assert.equal(session.phase, "fading")
  assert.equal(logic.isWindowVisible(session), true)
  session = logic.completeFade(session, 1100 + logic.FADE_MS)
  assert.equal(session.phase, "closed")
  assert.equal(logic.isWindowVisible(session), false)

  session = logic.openSession(session, 2000)
  assert.equal(session.opened, true)
  assert.equal(session.phase, "waiting")
  assert.equal(logic.isShown(session), false)
  session = logic.applyCursor(session, "{\"x\":8,\"y\":9}")
  assert.equal(logic.isShown(session), true)
  assert.deepEqual(session.cursor, { x: 8, y: 9 })

  session = logic.openSession(logic.createSession(), 0)
  session = logic.tick(session, 1499, logic.FADE_MS)
  assert.equal(session.opened, true)
  session = logic.applyCursor(session, "{\"x\":1,\"y\":1}")
  session = logic.tick(session, 1499, logic.FADE_MS)
  assert.equal(session.opened, true)
  session = logic.tick(session, 1500, logic.FADE_MS)
  assert.equal(session.opened, false)
  assert.equal(logic.isSessionClosed(session), true)
  assert.equal(session.phase, "fading")
  session = logic.tick(session, 1500 + logic.FADE_MS, logic.FADE_MS)
  assert.equal(session.phase, "closed")

  session = logic.openSession(session, 4000)
  assert.equal(session.opened, true)
  assert.equal(session.phase, "waiting")
  assert.equal(logic.isShown(session), false)

  const unseen = logic.tick(logic.openSession(logic.createSession(), 0), 1500, logic.FADE_MS)
  assert.equal(unseen.opened, false)
  assert.equal(unseen.phase, "closed")
  assert.equal(logic.isWindowVisible(unseen), false)

  const reduced = logic.closeSession(
    logic.applyCursor(logic.openSession(logic.createSession(), 0), "{\"x\":1,\"y\":1}"),
    20,
    0
  )
  assert.equal(reduced.opened, false)
  assert.equal(reduced.phase, "closed")
  assert.equal(logic.isWindowVisible(reduced), false)
})

test("reduce motion from gsettings makes the ring and fade instant", function () {
  assert.equal(logic.parseEnableAnimations("false\n"), false)
  assert.equal(logic.parseEnableAnimations("true\n"), true)
  assert.equal(logic.parseEnableAnimations("enable-animations: false\n"), false)
  assert.equal(logic.parseEnableAnimations("enable-animations: true"), true)
  assert.equal(logic.parseEnableAnimations(""), null)
  assert.equal(logic.parseEnableAnimations("No such key"), null)

  assert.equal(logic.motionDuration(logic.RING_MS, false), logic.RING_MS)
  assert.equal(logic.motionDuration(logic.FADE_MS, false), logic.FADE_MS)
  assert.equal(logic.motionDuration(logic.RING_MS, true), 0)
  assert.equal(logic.motionDuration(logic.FADE_MS, true), 0)

  const shown = logic.applyCursor(logic.openSession(logic.createSession(), 0), "{\"x\":1,\"y\":1}")
  const closed = logic.closeSession(shown, 20, logic.motionDuration(logic.FADE_MS, true))
  assert.equal(closed.phase, "closed")
  assert.equal(logic.isWindowVisible(closed), false)
})

test("the dim uses the darker palette color, so it shows on a light theme", function () {
  const white = { r: 1, g: 1, b: 1 }
  const gray = { r: 110 / 255, g: 110 / 255, b: 110 / 255 }
  const black = { r: 0, g: 0, b: 0 }
  const kanagawaBg = { r: 0x1f / 255, g: 0x1f / 255, b: 0x28 / 255 }
  const kanagawaFg = { r: 0xdc / 255, g: 0xd7 / 255, b: 0xba / 255 }

  assert.equal(logic.dimSource(kanagawaBg, kanagawaFg), "background")
  assert.equal(logic.dimSource(white, black), "foreground")
  assert.equal(logic.dimSource(white, gray), "foreground")
  assert.ok(logic.luminance(black) < logic.luminance(gray))
  assert.ok(logic.luminance(gray) < logic.luminance(white))
  assert.equal(logic.dimSource(null, black), "background")
})

test("FindMyMouse.qml keeps the shell contract", function () {
  const qml = fs.readFileSync(path.join(pluginDir, "FindMyMouse.qml"), "utf8")
  const required = [
    "open",
    "close",
    "opened",
    "shell",
    "manifest",
    "Region {}",
    "WlrKeyboardFocus.None",
    "ExclusionMode.Ignore",
    "WlrLayer.Overlay",
    "basantpandey-find-my-mouse",
    "hyprctl",
    "cursorpos",
    "Style.duration",
    "Util.alpha",
    "Color.background",
    "Color.foreground",
    "dimSource",
    "enable-animations",
    "motionDuration",
    "Color.accent",
    "ponytail:",
    "import \"FindMyMouseLogic.js\"",
    "openSession",
    "closeSession",
    "beginPoll",
    "applyCursor",
    "endPoll",
    "spotlightRect",
    "monitorContains",
    "localCursor",
    "pollIntervalMs",
    "HOLD_MS",
    "completeFade",
    "isWindowVisible",
    "Hyprland.refreshMonitors()"
  ]
  for (const token of required) {
    assert.ok(qml.includes(token), "missing QML contract string: " + token)
  }
  assert.equal(qml.includes("\u2014"), false)

  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8"))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.id, "io.github.basantpandey.find-my-mouse")
  assert.equal(manifest.name, "Find My Mouse")
  assert.equal(manifest.version, "0.1.1")
  assert.equal(manifest.author, "BasantPandey")
  assert.equal(manifest.description, "Press a hotkey to dim the screens and show a spotlight around the cursor.")
  assert.deepEqual(manifest.kinds, ["overlay"])
  assert.equal(manifest.keepLoaded, true)
  assert.deepEqual(manifest.entryPoints, { overlay: "FindMyMouse.qml" })
})

test("README, LICENSE, and preview.png meet the marketplace limits", function () {
  const readme = fs.readFileSync(path.join(pluginDir, "README.md"), "utf8")
  assert.equal(readme.includes("\u2014"), false)
  assert.ok(readme.includes("omarchy plugin add https://github.com/BasantPandey/omarchy-find-my-mouse.git --enable"))
  assert.ok(readme.includes('o.bind("SUPER + CTRL + M", "Find my mouse", "omarchy-shell shell toggle io.github.basantpandey.find-my-mouse")'))
  assert.ok(readme.includes("omarchy-shell shell toggle io.github.basantpandey.find-my-mouse '{}'"))
  assert.ok(readme.includes("omarchy plugin remove io.github.basantpandey.find-my-mouse"))
  assert.ok(readme.includes("Hyprland config reload"))
  assert.ok(readme.includes("30 Hz"))

  const license = fs.readFileSync(path.join(pluginDir, "LICENSE"), "utf8")
  assert.ok(license.startsWith("MIT License"))
  assert.ok(license.includes("Copyright (c) 2026 BasantPandey"))

  const png = fs.readFileSync(path.join(pluginDir, "preview.png"))
  assert.ok(png.length <= 50 * 1024 * 1024)
  assert.equal(png.toString("ascii", 1, 4), "PNG")
  assert.equal(png.toString("ascii", 12, 16), "IHDR")
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  assert.ok(width > 0 && height > 0)
  assert.ok(width * height <= 40000000)
})
