/* AgentGrid web chat loader: <script src="https://<host>/widget.js" data-channel="<channelId>" async></script> */
(function () {
  var s = document.currentScript;
  var channel = s && s.getAttribute("data-channel");
  if (!channel) return;
  var origin = new URL(s.src).origin;
  var color = s.getAttribute("data-color") || "#4f46e5";
  var btn = document.createElement("button");
  btn.setAttribute("aria-label", "Open chat");
  btn.textContent = "💬";
  btn.style.cssText = "position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;border:0;font-size:24px;cursor:pointer;z-index:2147483646;box-shadow:0 4px 16px rgba(0,0,0,.2);background:" + color;
  var frame = document.createElement("iframe");
  frame.src = origin + "/widget/" + encodeURIComponent(channel);
  frame.title = "Chat";
  frame.style.cssText = "position:fixed;bottom:88px;right:20px;width:360px;max-width:calc(100vw - 40px);height:540px;max-height:calc(100vh - 120px);border:0;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.25);z-index:2147483647;display:none;background:#fff";
  btn.onclick = function () { frame.style.display = frame.style.display === "none" ? "block" : "none"; };
  document.body.appendChild(frame);
  document.body.appendChild(btn);
})();
