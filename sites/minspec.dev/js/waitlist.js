/* Shared waitlist client — progressive enhancement over a native POST form.
   CSP-clean (external file, no inline). Works on minspec.dev / scroogellm.com / sealbox.dev:
   expects #waitlist-form, #email, #waitlist-submit, #waitlist-msg, and a honeypot #website. */
(function () {
  var form = document.getElementById("waitlist-form");
  if (!form) return;
  var email = document.getElementById("email");
  var btn = document.getElementById("waitlist-submit");
  var msg = document.getElementById("waitlist-msg");
  var sending = false;

  function show(text, kind) {
    if (!msg) return;
    msg.textContent = text;
    msg.className = "form-msg" + (kind ? " " + kind : "");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;
    var val = (email && email.value || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) {
      show("Please enter a valid email address.", "err");
      if (email) email.focus();
      return;
    }
    sending = true;
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = "Joining…"; }
    show("", "");

    var hp = document.getElementById("website");
    fetch(form.getAttribute("action") || "/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ email: val, website: hp ? hp.value : "" })
    })
      .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
      .then(function (data) {
        if (data && data.ok) {
          show("You're on the list — we'll email you at launch. ✓", "ok");
          form.reset();
        } else {
          show((data && data.error) || "Something went wrong. Please try again.", "err");
        }
      })
      .catch(function () { show("Network error. Please try again.", "err"); })
      .finally(function () {
        sending = false;
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || "Join the waitlist"; }
      });
  });
})();
