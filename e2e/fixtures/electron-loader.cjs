'use strict'

const { app } = require('electron')
const { chromiumSwitches } = require('playwright-core/lib/server/chromium/chromiumSwitches')

app.commandLine.appendSwitch('remote-debugging-port', '0')

for (const arg of chromiumSwitches()) {
  const match = arg.match(/--([^=]*)=?(.*)/)
  app.commandLine.appendSwitch(match[1], match[2])
}

const originalWhenReady = app.whenReady()
const originalEmit = app.emit.bind(app)
let readyEventArgs

app.emit = (event, ...args) => {
  if (event === 'ready') {
    readyEventArgs = args
    return app.listenerCount('ready') > 0
  }
  return originalEmit(event, ...args)
}

let isReady = false
let whenReadyCallback
const whenReadyPromise = new Promise((resolve) => {
  whenReadyCallback = resolve
})

app.isReady = () => isReady
app.whenReady = () => whenReadyPromise

globalThis.__playwright_run = async () => {
  const event = await originalWhenReady
  isReady = true
  whenReadyCallback(event)
  originalEmit('ready', ...(readyEventArgs ?? []))
}
