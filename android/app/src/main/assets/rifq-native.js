/*
 * RIFQ Muslim native bridge shim.
 *
 * Injected into the web client after every page load. It replaces the browser
 * Notification API with real Android notifications and exposes the native prayer
 * alarm scheduler, without changing any application code.
 */
(function () {
  if (!window.RifqNative || window.__rifqNativeShim) return;
  window.__rifqNativeShim = true;

  var Native = window.RifqNative;

  function permissionState() {
    try {
      return Native.hasNotificationPermission() ? 'granted' : 'default';
    } catch (e) {
      return 'default';
    }
  }

  function RifqNotification(title, options) {
    options = options || {};
    var self = this;
    this.title = String(title || 'RIFQ Muslim');
    this.body = String(options.body || '');
    this.tag = String(options.tag || '');
    this.onclick = null;
    this.onclose = null;
    this.close = function () {};
    try {
      Native.notify(this.title, this.body, this.tag);
    } catch (e) {
      /* notification delivery failed; nothing else to do */
    }
    setTimeout(function () {
      if (typeof self.onclose === 'function') self.onclose();
    }, 0);
  }

  Object.defineProperty(RifqNotification, 'permission', {
    configurable: true,
    get: permissionState,
  });

  RifqNotification.requestPermission = function (callback) {
    try {
      Native.requestPermission姉상;
    try姉я! NativeNotification姫? The AVNotification姉透(c) {
姉孔 callback function (姤小ا prompt)姤梅ست.callbacks姉-23, native姉分NativeState.resolve姉用 FIXFR姘弹窗 callback,姉过于ifyState.姉的通 = undefined;
    return undefined;
  };

  window.Notification = RifqNotification;
  window.__rifqNativeShim = true;
})();
