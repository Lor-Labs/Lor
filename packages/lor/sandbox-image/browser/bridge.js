// Runs in the live view's page (Selkies' web client), injected by the gateway
// (reference/planned/sandbox-browser-runbook.md §4 and §7). It tells the Lor
// panel who has control and when the person in it uses the view, reloads the
// page when this viewer's role changes (handing the panel the last picture to
// show meanwhile), draws everyone's pointer and Lor's over the picture, and
// lets this viewer annotate the page without control: clicks and drags in
// annotate mode go to the gateway, which draws the annotation on the page
// itself. Positions travel as fractions of the display, so they line up in
// every viewer's own size.
;(() => {
  const base = location.pathname.slice(
    0,
    location.pathname.lastIndexOf("/") + 1
  )
  const post = (msg) =>
    parent !== window &&
    parent.postMessage({ source: "lor-browser", ...msg }, "*")
  const LOR = "#7c5cff"
  const ANNOTATING = "lor-annotating"

  let role = null
  // `annotate`: this viewer may point and leave notes; a signed-out viewer
  // of a public preview link only watches (the gateway enforces it).
  let me = { userId: "", name: "", color: LOR, annotate: true }
  let leaving = false
  addEventListener("pagehide", () => {
    leaving = true
  })

  // Selkies draws into a <video> or one of its canvases, whichever shows.
  const shown = () =>
    ["videoStream", "videoWorkerCanvas", "videoCanvas"]
      .map((id) => document.getElementById(id))
      .find(
        (el) =>
          el &&
          el.style.display !== "none" &&
          el.getBoundingClientRect().width > 0 &&
          (el.tagName !== "VIDEO" || (el.readyState >= 2 && el.videoWidth > 0))
      )

  // Where the display's picture sits in this page.
  const picture = () => {
    const el = shown()
    if (!el) return null
    const r = el.getBoundingClientRect()
    const w = el.videoWidth || el.width
    const h = el.videoHeight || el.height
    if (getComputedStyle(el).objectFit !== "contain" || !w || !h) {
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    }
    const scale = Math.min(r.width / w, r.height / h)
    return {
      left: r.left + (r.width - w * scale) / 2,
      top: r.top + (r.height - h * scale) / 2,
      width: w * scale,
      height: h * scale,
    }
  }
  const fraction = (event, pic) => ({
    x: (event.clientX - pic.left) / pic.width,
    y: (event.clientY - pic.top) / pic.height,
  })
  const inside = (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1

  const snapshot = () => {
    try {
      const el = shown()
      if (!el) return null
      const scale = Math.min(devicePixelRatio || 1, 2)
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(innerWidth * scale)
      canvas.height = Math.round(innerHeight * scale)
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const r = el.getBoundingClientRect()
      ctx.drawImage(
        el,
        r.left * scale,
        r.top * scale,
        r.width * scale,
        r.height * scale
      )
      return canvas.toDataURL("image/jpeg", 0.85)
    } catch {
      return null
    }
  }
  const reload = () => {
    leaving = true
    post({ type: "freeze", image: snapshot() })
    location.reload()
  }
  // Selkies hides its status bar once the stream draws.
  const waitForPicture = () => {
    const status = document.getElementById("status-display")
    if (status?.classList.contains("hidden") && shown()) {
      requestAnimationFrame(() => post({ type: "picture" }))
      return
    }
    setTimeout(waitForPicture, 50)
  }
  waitForPicture()

  // Everything this script draws: closed, so Selkies' styles and scripts
  // never reach it.
  const host = document.createElement("div")
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483646;pointer-events:none"
  const root = host.attachShadow({ mode: "closed" })
  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box;margin:0;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
    .cursor{position:fixed;left:0;top:0;pointer-events:none;will-change:transform;transition:transform 90ms linear,opacity .2s ease}
    .cursor.lor{transition:transform 420ms cubic-bezier(.22,1,.36,1),opacity .25s ease}
    .cursor.jump{transition:opacity .2s ease}
    .cursor.rest{opacity:.45}
    .cursor.gone{opacity:0}
    .cursor svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
    .cursor.watch{opacity:.75}
    .cursor.watch svg{transform:scale(.82);transform-origin:0 0}
    .cursor.watch.gone{opacity:0}
    .tag{position:absolute;left:13px;top:17px;padding:2px 7px;border-radius:4px 9px 9px 9px;background:var(--c);color:#fff;font-size:11px;font-weight:600;line-height:15px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25)}
    .ripple{position:absolute;left:-15px;top:-15px;width:30px;height:30px;border-radius:50%;border:2px solid var(--c);background:color-mix(in srgb,var(--c) 18%,transparent);opacity:0}
    .ripple.go{animation:ripple .55s ease-out}
    @keyframes ripple{from{transform:scale(.25);opacity:1}to{transform:scale(1.6);opacity:0}}
    .dots{display:none;margin-left:4px}
    .typing .dots{display:inline}
    .catch{position:fixed;pointer-events:auto;touch-action:none;cursor:crosshair}
    .hover{position:fixed;left:0;top:0;border:1.5px solid var(--me);background:color-mix(in srgb,var(--me) 12%,transparent);border-radius:3px;pointer-events:none;transition:transform 60ms linear,width 60ms linear,height 60ms linear}
    .card{position:fixed;left:0;top:0;width:300px;padding:10px 12px;border:1px solid rgba(28,25,23,.1);border-radius:12px;background:#fff;color:#1c1917;box-shadow:0 12px 32px -4px rgba(0,0,0,.2),0 2px 6px rgba(0,0,0,.08);pointer-events:auto}
    .head{display:flex;align-items:center;gap:7px;font-size:12px;line-height:16px}
    .avatar{flex:none;width:20px;height:20px;border-radius:10px;background:var(--me);color:#fff;font-size:10px;font-weight:600;line-height:20px;text-align:center}
    .who{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .num{color:#a8a29e}
    textarea{display:block;width:100%;max-height:152px;margin-top:8px;padding:0;border:0;outline:0;resize:none;overflow-y:auto;background:transparent;color:#1c1917;font-size:13px;line-height:19px}
    textarea::placeholder{color:#a8a29e}
    .foot{display:flex;align-items:center;gap:4px;margin-top:10px}
    .hint{flex:1;font-size:11px;color:#a8a29e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    button{all:unset;cursor:pointer;padding:4px 9px;border-radius:6px;font-size:12px;font-weight:500;line-height:16px}
    .remove{color:#78716c}.remove:hover{background:#f5f5f4;color:#1c1917}
    .save{background:var(--me);color:#fff}.save:hover{filter:brightness(.92)}
    @media (prefers-reduced-motion:reduce){.cursor,.cursor.lor,.hover{transition:opacity .2s ease}.ripple.go{animation:none}}
  </style>`
  document.documentElement.appendChild(host)

  const ARROW =
    "<svg width='18' height='20' viewBox='0 0 18 20'><path d='M2 1.5v15.2l4.2-3.7 2.7 6 2.4-1.1-2.7-5.9h5.7z' fill='var(--c)' stroke='#fff' stroke-width='1.4' stroke-linejoin='round'/></svg>"

  // Pointers of the other people here, and Lor's.
  const cursors = new Map()
  const place = (cursor) => {
    const pic = picture()
    if (!pic) return
    cursor.el.style.transform = `translate3d(${pic.left + cursor.x * pic.width}px,${pic.top + cursor.y * pic.height}px,0)`
  }
  const cursorFor = (id, name, color, kind) => {
    let cursor = cursors.get(id)
    if (!cursor) {
      const el = document.createElement("div")
      el.className = `cursor gone ${kind}`
      el.innerHTML = `<div class='ripple'></div>${ARROW}<div class='tag'><span class='label'></span><span class='dots'>…</span></div>`
      root.appendChild(el)
      cursor = { el, x: 0.5, y: 0.5, timer: 0, movedAt: 0 }
      cursors.set(id, cursor)
    }
    cursor.el.style.setProperty("--c", color)
    cursor.el.querySelector(".label").textContent = name
    return cursor
  }
  // `restMs`: stays dimmed where it was for that long before it goes.
  const show = (cursor, x, y, idleMs, restMs = 0) => {
    const hidden = cursor.el.classList.contains("gone")
    // Appearing after it went: at the new spot, not flying in from the old.
    cursor.el.classList.toggle("jump", hidden)
    cursor.x = x
    cursor.y = y
    cursor.movedAt = Date.now()
    place(cursor)
    if (hidden) void cursor.el.offsetWidth
    cursor.el.classList.remove("gone", "jump", "rest")
    clearTimeout(cursor.timer)
    cursor.timer = setTimeout(() => {
      if (restMs === 0) return cursor.el.classList.add("gone")
      cursor.el.classList.add("rest")
      cursor.timer = setTimeout(() => cursor.el.classList.add("gone"), restMs)
    }, idleMs)
  }
  const ripple = (cursor) => {
    const ring = cursor.el.querySelector(".ripple")
    ring.classList.remove("go")
    void ring.offsetWidth
    ring.classList.add("go")
  }
  addEventListener("resize", () => {
    for (const cursor of cursors.values()) place(cursor)
  })

  const onCursor = (msg) => {
    if (msg.gone) {
      cursors.get(msg.id)?.el.classList.add("gone")
      return
    }
    const cursor = cursorFor(
      msg.id,
      msg.name || "Someone",
      msg.color || LOR,
      msg.drives ? "drive" : "watch"
    )
    cursor.el.classList.toggle("watch", !msg.drives)
    show(cursor, msg.x, msg.y, 8000)
    if (msg.down) ripple(cursor)
  }

  // Lor's pointer glides to where its command acts, then clicks or types.
  // Between commands it rests there, so people see where Lor is working.
  let typing = 0
  const onLor = (msg) => {
    const cursor = cursorFor("lor", "Lor", LOR, "lor")
    const moved =
      Math.abs(cursor.x - msg.x) > 0.002 || Math.abs(cursor.y - msg.y) > 0.002
    const travel = moved && !cursor.el.classList.contains("gone") ? 420 : 0
    show(cursor, msg.x, msg.y, 6000, 60_000)
    if (msg.kind === "down") setTimeout(() => ripple(cursor), travel)
    if (msg.kind === "type" || msg.kind === "focus") {
      cursor.el.classList.add("typing")
      clearTimeout(typing)
      typing = setTimeout(() => cursor.el.classList.remove("typing"), 1200)
    }
  }

  let ws = null
  const send = (msg) => {
    if (!ws || ws.readyState !== 1) return false
    ws.send(JSON.stringify(msg))
    return true
  }
  // A saved or removed note while the events socket was down: sent again on
  // reconnect, so the draft isn't lost. One per annotation, the latest.
  const unsent = new Map()
  const deliver = (msg) => {
    if (send(msg)) unsent.delete(msg.id)
    else unsent.set(msg.id, msg)
  }
  let seq = 0

  // This viewer's pointer, for everyone else.
  let lastSent = 0
  let wasInside = false
  const onPointer = (event) => {
    const pic = picture()
    if (!pic) return
    const p = fraction(event, pic)
    if (!inside(p)) {
      if (wasInside) send({ t: "ptr", gone: true })
      wasInside = false
      return
    }
    if (!me.annotate) return
    const now = Date.now()
    const down = event.type === "pointerdown"
    if (!down && now - lastSent < 40) return
    lastSent = now
    wasInside = true
    send({ t: "ptr", x: p.x, y: p.y, down })
  }
  const pointerGone = () => {
    if (wasInside) send({ t: "ptr", gone: true })
    wasInside = false
  }
  addEventListener("pointermove", onPointer, { capture: true, passive: true })
  addEventListener("pointerdown", onPointer, { capture: true, passive: true })
  document.addEventListener("pointerleave", pointerGone)
  addEventListener("blur", pointerGone)

  // Annotating: a layer over the picture takes this viewer's clicks and
  // drags, so they reach the gateway instead of the page.
  let comments = []
  let layer = null
  let hoverBox = null
  let card = null
  let drag = null
  let hoverSeq = 0
  let lastHover = 0
  const pending = new Map()

  const fitLayer = () => {
    const pic = picture()
    if (!layer || !pic) return
    layer.style.left = `${pic.left}px`
    layer.style.top = `${pic.top}px`
    layer.style.width = `${pic.width}px`
    layer.style.height = `${pic.height}px`
  }
  const boxOf = (rect) => {
    const pic = picture()
    if (!pic || !rect) return null
    return {
      left: pic.left + rect.x * pic.width,
      top: pic.top + rect.y * pic.height,
      width: rect.w * pic.width,
      height: rect.h * pic.height,
    }
  }
  const showHover = (rect) => {
    const box = boxOf(rect)
    if (!hoverBox || !box || card) {
      if (hoverBox) hoverBox.style.display = "none"
      return
    }
    hoverBox.style.display = ""
    hoverBox.style.width = `${box.width}px`
    hoverBox.style.height = `${box.height}px`
    hoverBox.style.transform = `translate(${box.left}px,${box.top}px)`
  }

  const closeCard = (keep) => {
    if (!card) return
    const { id, isNew, before, area } = card
    const text = area.value.trim()
    if (keep === "remove" || (isNew && (keep === "cancel" || !text))) {
      deliver({ t: "remove", id })
    } else if (keep === "cancel") {
      deliver({ t: "note", id, text: before, open: false })
    } else {
      deliver({ t: "note", id, text, open: false })
    }
    clearTimeout(card.timer)
    card.el.remove()
    card = null
    post({ type: "annotating", on: Boolean(layer), writing: false })
  }

  // The annotation went from under the note (someone sent or cleared it).
  const dropCard = () => {
    if (!card) return
    clearTimeout(card.timer)
    card.el.remove()
    card = null
    post({ type: "annotating", on: Boolean(layer), writing: false })
  }

  const openCard = (id, anchor, isNew, number) => {
    closeCard()
    const item = comments.find((entry) => entry.id === id)
    const el = document.createElement("div")
    el.className = "card"
    el.innerHTML =
      "<div class='head'><span class='avatar'></span><span class='who'></span><span class='num'></span></div>" +
      "<textarea rows='1' placeholder='Add a note for Lor…'></textarea>" +
      "<div class='foot'><span class='hint'>Enter to save · Esc to cancel</span><button type='button' class='remove'></button><button type='button' class='save'>Save</button></div>"
    const name = me.name || "You"
    el.querySelector(".avatar").textContent = name.charAt(0).toUpperCase()
    el.querySelector(".who").textContent = name
    el.querySelector(".num").textContent = `#${item?.number ?? number}`
    el.querySelector(".remove").textContent = isNew ? "Cancel" : "Remove"
    const area = el.querySelector("textarea")
    area.value = item?.note ?? ""
    root.appendChild(el)
    card = { id, el, area, isNew, before: item?.note ?? "", timer: 0 }
    const grow = () => {
      area.style.height = "auto"
      area.style.height = `${Math.min(area.scrollHeight, 152)}px`
    }
    // Called from the key listener below, which cuts the event off before
    // it would reach a listener on the textarea itself.
    card.typed = () => {
      grow()
      // Everyone sees the note as it is typed.
      clearTimeout(card.timer)
      card.timer = setTimeout(
        () => card && send({ t: "note", id, text: area.value, open: true }),
        120
      )
    }
    el.querySelector(".save").addEventListener("click", () => closeCard())
    el.querySelector(".remove").addEventListener("click", () =>
      closeCard(isNew ? "cancel" : "remove")
    )
    // Beside the element, wherever there is room.
    const box = boxOf(anchor) ?? { left: 40, top: 40, width: 0, height: 0 }
    const w = 300
    const h = el.offsetHeight
    const gap = 10
    const m = 8
    let x = box.left
    let y = box.top + box.height + gap
    if (box.left + box.width + gap + w <= innerWidth - m) {
      x = box.left + box.width + gap
      y = box.top
    } else if (box.left - gap - w >= m) {
      x = box.left - gap - w
      y = box.top
    } else if (y + h > innerHeight - m) {
      y = box.top - gap - h
    }
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max))
    el.style.transform = `translate(${clamp(x, m, innerWidth - w - m)}px,${clamp(y, m, innerHeight - h - m)}px)`
    grow()
    area.focus({ preventScroll: true })
    area.setSelectionRange(area.value.length, area.value.length)
    showHover(null)
    post({ type: "annotating", on: true, writing: true })
  }

  const ask = (msg, done) => {
    const id = ++seq
    pending.set(id, done)
    send({ ...msg, seq: id })
  }

  const pick = (a, b) => {
    closeCard()
    ask(
      { t: "pick", ax: a.x, ay: a.y, ...(b ? { bx: b.x, by: b.y } : {}) },
      (reply) => {
        if (!layer || reply.error) return
        // Someone else's pin: only its author edits it.
        const item = comments.find((entry) => entry.id === reply.id)
        if (reply.existing && item && item.by.userId !== me.userId) return
        openCard(reply.id, reply.anchor, !reply.existing, reply.number)
      }
    )
  }

  let wheel = { dx: 0, dy: 0, timer: 0 }
  const startAnnotating = () => {
    if (layer || !me.annotate) return
    layer = document.createElement("div")
    layer.className = "catch"
    hoverBox = document.createElement("div")
    hoverBox.className = "hover"
    hoverBox.style.display = "none"
    root.append(layer, hoverBox)
    fitLayer()
    const at = (event) => {
      const pic = picture()
      return pic ? fraction(event, pic) : null
    }
    layer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return
      const p = at(event)
      if (!p) return
      layer.setPointerCapture(event.pointerId)
      drag = { from: p, x: event.clientX, y: event.clientY, moved: false }
    })
    layer.addEventListener("pointermove", (event) => {
      const p = at(event)
      if (!p) return
      const now = Date.now()
      if (drag) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) {
          drag.moved = true
        }
        if (drag.moved && now - lastHover > 50) {
          lastHover = now
          showHover(null)
          send({
            t: "select",
            ax: drag.from.x,
            ay: drag.from.y,
            bx: p.x,
            by: p.y,
          })
        }
        return
      }
      if (card || now - lastHover < 70) return
      lastHover = now
      const mine = ++hoverSeq
      ask({ t: "hover", x: p.x, y: p.y }, (reply) => {
        if (mine === hoverSeq) showHover(reply.at?.rect ?? null)
      })
    })
    layer.addEventListener("pointerup", (event) => {
      const p = at(event)
      const from = drag
      drag = null
      if (!from || !p) return
      pick(from.from, from.moved ? p : null)
    })
    layer.addEventListener("pointercancel", () => {
      drag = null
    })
    layer.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault()
        const p = at(event)
        if (!p) return
        wheel.dx += event.deltaX
        wheel.dy += event.deltaY
        if (wheel.timer) return
        wheel.timer = setTimeout(() => {
          send({ t: "wheel", x: p.x, y: p.y, dx: wheel.dx, dy: wheel.dy })
          wheel = { dx: 0, dy: 0, timer: 0 }
        }, 30)
      },
      { passive: false }
    )
    layer.addEventListener("contextmenu", (event) => event.preventDefault())
    for (const type of [
      "pointerdown",
      "pointerup",
      "pointermove",
      "mousedown",
      "mouseup",
      "mousemove",
      "click",
      "dblclick",
      "wheel",
      "touchstart",
      "touchmove",
      "touchend",
    ]) {
      layer.addEventListener(type, (event) => event.stopPropagation())
    }
    try {
      sessionStorage.setItem(ANNOTATING, "1")
    } catch {}
    post({ type: "annotating", on: true, writing: false })
  }
  const stopAnnotating = () => {
    closeCard()
    layer?.remove()
    hoverBox?.remove()
    layer = null
    hoverBox = null
    drag = null
    try {
      sessionStorage.removeItem(ANNOTATING)
    } catch {}
    post({ type: "annotating", on: false, writing: false })
  }
  addEventListener("resize", fitLayer)
  setInterval(fitLayer, 1000)

  // Typing in a note stays here: Selkies would send the keys to the page.
  // This script loads first, so its listeners run before Selkies' own.
  for (const type of [
    "keydown",
    "keyup",
    "keypress",
    "beforeinput",
    "input",
    "paste",
    "copy",
    "cut",
    "compositionstart",
    "compositionupdate",
    "compositionend",
  ]) {
    addEventListener(
      type,
      (event) => {
        if (!card || event.target !== host) return
        event.stopImmediatePropagation()
        if (type === "input") card.typed()
        if (type !== "keydown" || event.isComposing) return
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault()
          closeCard()
        } else if (event.key === "Escape") {
          event.preventDefault()
          closeCard("cancel")
        }
      },
      true
    )
  }
  // From the Lor panel around this page.
  addEventListener("message", (event) => {
    if (event.source !== parent || parent === window) return
    const msg = event.data
    if (msg?.source !== "lor-panel") return
    if (msg.type === "annotate") {
      if (msg.on) startAnnotating()
      else stopAnnotating()
    } else if (msg.type === "export") {
      ask({ t: "export" }, (reply) =>
        post({ type: "exported", id: msg.id, items: reply.items ?? [] })
      )
    } else if (msg.type === "clear") {
      send({ t: "clear", ...(Array.isArray(msg.ids) ? { ids: msg.ids } : {}) })
    } else if (msg.type === "remove") {
      send({ t: "remove", id: msg.id })
    }
  })

  const listen = () => {
    ws = new WebSocket(
      `${location.protocol === "https:" ? "wss://" : "ws://"}${location.host}${base}__lor/events`
    )
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      switch (msg.type) {
        case "control":
          if (role && msg.role !== role) return reload()
          role = msg.role
          if (msg.you) me = { annotate: true, ...msg.you }
          host.style.setProperty("--me", me.color || LOR)
          if (!me.annotate) stopAnnotating()
          post({ type: "control", role: msg.role, controller: msg.controller })
          return
        case "presence":
          return post({
            type: "presence",
            people: msg.people,
            watching: msg.watching ?? 0,
          })
        case "page":
          return post({ type: "page", url: msg.url, title: msg.title })
        case "cursor":
          return onCursor(msg)
        case "lor":
          return onLor(msg)
        case "comments":
          comments = msg.items
          if (card && !comments.some((entry) => entry.id === card.id)) {
            dropCard()
          }
          return post({ type: "comments", items: msg.items })
        default: {
          const done = pending.get(msg.seq)
          if (!done) return
          pending.delete(msg.seq)
          done(msg)
        }
      }
    }
    ws.onopen = () => {
      post({ type: "hello", version: 3 })
      for (const msg of [...unsent.values()]) deliver(msg)
      let resume = false
      try {
        resume = sessionStorage.getItem(ANNOTATING) === "1"
      } catch {}
      // A role change reloaded the page in the middle of annotating.
      if (resume) startAnnotating()
    }
    ws.onclose = (event) => {
      pending.clear()
      if (leaving) return
      if (event.code === 4004) return post({ type: "expired" })
      // Nobody signed in is here: a public link's viewers wait.
      if (event.code === 4005) return post({ type: "asleep" })
      post({ type: "disconnected" })
      setTimeout(listen, 2000)
    }
  }
  listen()

  let last = 0
  const onInput = () => {
    const now = Date.now()
    if (now - last < 1000) return
    last = now
    post({ type: "input" })
  }
  for (const name of ["pointerdown", "keydown", "wheel"]) {
    addEventListener(name, onInput, { capture: true, passive: true })
  }
})()
