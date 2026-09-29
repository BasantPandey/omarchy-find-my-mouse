import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import "FindMyMouseLogic.js" as FindMyMouseLogic

Item {
  id: root

  property var shell: null
  property var manifest: null
  property bool opened: false
  property var session: FindMyMouseLogic.createSession()
  property real ringDiameter: FindMyMouseLogic.SPOT_RADIUS * 2
  readonly property color dimColor: Util.alpha(Color.background, 0.6)

  // Call Style.duration when the shell provides it.
  // Use the raw time when this shell has no Style.duration function.
  function motionMs(ms) {
    try {
      if (typeof Style.duration === "function") return Style.duration(ms)
    } catch (e) {
      return ms
    }
    return ms
  }

  function applySession(next) {
    if (!next || next === root.session) return
    var startRing = next.phase === "showing" && root.session.phase !== "showing"
    // Start the ring large, then let the animation shrink it.
    // Duration 0 keeps the final size, so reduce motion does not flash.
    if (startRing && root.motionMs(FindMyMouseLogic.RING_MS) > 0)
      root.ringDiameter = FindMyMouseLogic.SPOT_RADIUS * 8
    root.session = next
    root.opened = next.opened === true
    if (startRing) ringAnim.restart()
  }

  function open(payloadJson) {
    // The shell passes a JSON payload. This overlay does not read it.
    void payloadJson
    root.applySession(FindMyMouseLogic.openSession(root.session, Date.now()))
    holdTimer.restart()
    root.requestPoll()
  }

  function close() {
    holdTimer.stop()
    var fadeMs = root.motionMs(FindMyMouseLogic.FADE_MS)
    var next = FindMyMouseLogic.closeSession(root.session, Date.now(), fadeMs)
    root.applySession(next)
    if (next.phase === "fading") {
      fadeTimer.interval = fadeMs
      fadeTimer.restart()
    }
  }

  function requestPoll() {
    if (cursorProc.running) return
    var step = FindMyMouseLogic.beginPoll(root.session)
    if (!step.started) return
    root.applySession(step.session)
    cursorProc.running = true
  }

  // The hold timer and close() both end the open session.
  Timer {
    id: holdTimer
    interval: FindMyMouseLogic.HOLD_MS
    repeat: false
    onTriggered: root.close()
  }

  Timer {
    id: pollTimer
    interval: FindMyMouseLogic.pollIntervalMs()
    repeat: true
    running: root.opened
    onTriggered: root.requestPoll()
  }

  Timer {
    id: fadeTimer
    repeat: false
    onTriggered: {
      if (root.session.phase === "fading")
        root.applySession(FindMyMouseLogic.completeFade(root.session, Date.now()))
    }
  }

  NumberAnimation {
    id: ringAnim
    target: root
    property: "ringDiameter"
    from: FindMyMouseLogic.SPOT_RADIUS * 8
    to: FindMyMouseLogic.SPOT_RADIUS * 2
    duration: root.motionMs(FindMyMouseLogic.RING_MS)
    easing.type: Easing.OutCubic
  }

  Process {
    id: cursorProc
    command: ["hyprctl", "-j", "cursorpos"]
    stdout: StdioCollector {
      id: cursorOut
      waitForEnd: true
      onStreamFinished: root.applySession(FindMyMouseLogic.applyCursor(root.session, cursorOut.text))
    }
    onExited: root.applySession(FindMyMouseLogic.endPoll(root.session))
  }

  // ponytail: A Hyprland config reload drops this layer rule.
  Process {
    id: layerRuleProc
    command: [
      "hyprctl",
      "eval",
      "hl.layer_rule({ match = { namespace = \"basantpandey-find-my-mouse\" }, no_anim = true, animation = \"none\" })"
    ]
  }

  Component.onCompleted: layerRuleProc.running = true

  Variants {
    model: Quickshell.screens

    delegate: PanelWindow {
      id: panel
      required property var modelData

      readonly property var monitor: Hyprland.monitorFor(modelData)
      readonly property var cursor: root.session.cursor
      readonly property bool active: {
        if (!cursor || !monitor) return false
        return FindMyMouseLogic.monitorContains(monitor, cursor.x, cursor.y)
      }
      readonly property var local: {
        if (!cursor || !monitor) return ({ x: 0, y: 0 })
        return FindMyMouseLogic.localCursor(monitor, cursor.x, cursor.y)
      }
      readonly property var spot: FindMyMouseLogic.spotlightRect(width, height, local.x, local.y, FindMyMouseLogic.SPOT_RADIUS)

      screen: modelData
      // Stay hidden until the first cursor sample. Stay up until the fade ends.
      visible: FindMyMouseLogic.isWindowVisible(root.session)
      color: "transparent"
      anchors {
        top: true
        bottom: true
        left: true
        right: true
      }
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "basantpandey-find-my-mouse"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      // Clicks pass through. The input region is empty.
      mask: Region {}

      Item {
        id: shade
        anchors.fill: parent
        opacity: root.session.phase === "showing" ? 1 : 0

        Behavior on opacity {
          NumberAnimation {
            duration: root.motionMs(FindMyMouseLogic.FADE_MS)
            easing.type: Easing.OutCubic
            onFinished: {
              if (shade.opacity === 0 && root.session.phase === "fading")
                root.applySession(FindMyMouseLogic.completeFade(root.session, Date.now()))
            }
          }
        }

        Rectangle {
          anchors.fill: parent
          visible: !panel.active
          color: root.dimColor
        }

        Rectangle {
          visible: panel.active
          x: panel.spot.x
          y: panel.spot.y
          width: panel.spot.width
          height: panel.spot.height
          radius: panel.spot.radius
          color: "transparent"
          border.width: panel.spot.reach
          border.color: root.dimColor
          antialiasing: true
        }

        Rectangle {
          visible: panel.active
          x: panel.local.x - width / 2
          y: panel.local.y - height / 2
          width: root.ringDiameter
          height: width
          radius: width / 2
          color: "transparent"
          border.width: FindMyMouseLogic.RING_WIDTH
          border.color: Color.accent
          antialiasing: true
        }
      }
    }
  }
}
