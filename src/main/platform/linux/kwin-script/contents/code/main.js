// Runs inside KWin (Plasma 6), loaded by Hexa on Plasma Wayland. Whenever your windows change, it
// tells Hexa where they are over D-Bus: geometry, state, the process id and the window class only,
// never titles or contents. Plain functions: KWin's script engine is not a browser.

var SERVICE = 'io.github.hexa';
var OBJECT = '/io/github/hexa/Windows';
var IFACE = 'io.github.hexa.Windows';

function info(w) {
  var g = w.frameGeometry;
  var area = workspace.clientArea(KWin.MaximizeArea, w);
  var desktops = [];
  for (var i = 0; i < (w.desktops || []).length; i++) desktops.push(String(w.desktops[i].id));
  return {
    id: String(w.internalId),
    x: g.x, y: g.y, w: g.width, h: g.height,
    pid: w.pid,
    cls: String(w.resourceClass),
    minimized: Boolean(w.minimized),
    fullScreen: Boolean(w.fullScreen),
    maximized: g.width >= area.width - 2 && g.height >= area.height - 2,
    desktops: desktops,
    onAll: Boolean(w.onAllDesktops)
  };
}

function report() {
  var wins = [];
  var order = workspace.stackingOrder; // bottom to top
  for (var i = 0; i < order.length; i++) {
    var w = order[i];
    if (w.normalWindow || w.dialog) wins.push(info(w));
  }
  var active = workspace.activeWindow ? String(workspace.activeWindow.internalId) : '';
  var desktop = workspace.currentDesktop ? String(workspace.currentDesktop.id) : '';
  callDBus(SERVICE, OBJECT, IFACE, 'update', JSON.stringify({ active: active, desktop: desktop, wins: wins }));
}

function watch(w) {
  w.frameGeometryChanged.connect(report);
  w.minimizedChanged.connect(report);
  w.fullScreenChanged.connect(report);
  w.desktopsChanged.connect(report);
}

for (var i = 0; i < workspace.stackingOrder.length; i++) watch(workspace.stackingOrder[i]);
workspace.windowAdded.connect(function (w) { watch(w); report(); });
workspace.windowRemoved.connect(report);
workspace.windowActivated.connect(report);
workspace.currentDesktopChanged.connect(report);
if (workspace.stackingOrderChanged) workspace.stackingOrderChanged.connect(report);
report();
