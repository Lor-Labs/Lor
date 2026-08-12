/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "notification-service",
  displayName: "Lor Notifications",
  bundleIdentifier: ".notification-service",
  deploymentTarget: "15.1",
  frameworks: ["Intents", "UserNotifications"],
}
