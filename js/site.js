(function () {
  var TZ = "Australia/Perth";
  var THEME_KEY = "subzero-theme";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function perthYmd(date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function addDaysYmd(ymd, n) {
    var p = ymd.split("-").map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return dt.toISOString().slice(0, 10);
  }

  function weekdayIndex(ymd) {
    return new Date(ymd + "T12:00:00+08:00").getDay();
  }

  function prettyDay(ymd) {
    var p = ymd.split("-").map(Number);
    return WEEKDAYS[weekdayIndex(ymd)] + " " + p[2] + " " + MONTHS[p[1] - 1];
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function initTheme() {
    var stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch (e) {
      stored = null;
    }
    var theme;
    if (stored === "light" || stored === "dark") {
      theme = stored;
    } else {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    applyTheme(theme);
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.addEventListener("click", function () {
        var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        applyTheme(next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch (e) {}
      });
    }
  }

  function group(root, onChange) {
    if (!root) return;
    root.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn || !root.contains(btn) || btn.disabled) return;
      root.querySelectorAll("button").forEach(function (b) {
        b.classList.remove("is-on");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("is-on");
      btn.setAttribute("aria-pressed", "true");
      if (onChange) onChange(btn);
    });
  }

  function selected(root) {
    var on = root && root.querySelector("button.is-on");
    return on ? (on.getAttribute("data-value") || on.textContent.trim()) : "";
  }

  function initFault() {
    var jobRoot = document.getElementById("job-type");
    var faultBlock = document.getElementById("fault-block");
    var roomBlock = document.getElementById("room-block");
    var form = document.getElementById("quote-form");
    var saved = document.getElementById("quote-saved");
    var err = document.getElementById("quote-error");

    function syncJob() {
      var job = selected(jobRoot);
      if (faultBlock) faultBlock.classList.toggle("is-hidden", job !== "Breakdown");
      if (roomBlock) roomBlock.classList.toggle("is-hidden", job !== "Cool-room or freezer room");
    }

    group(jobRoot, syncJob);
    group(document.getElementById("fault-type"));
    syncJob();

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = (document.getElementById("q-name") || {}).value || "";
        var phone = (document.getElementById("q-phone") || {}).value || "";
        var email = (document.getElementById("q-email") || {}).value || "";
        if (!name.trim() || !phone.trim() || !email.trim()) {
          if (err) {
            err.textContent = "Add your name, phone and email.";
            err.classList.remove("is-hidden");
          }
          return;
        }
        if (err) err.classList.add("is-hidden");
        var job = selected(jobRoot);
        var bits = [job];
        if (job === "Breakdown") {
          var fault = selected(document.getElementById("fault-type"));
          if (fault) bits.push(fault);
        }
        form.classList.add("is-hidden");
        if (saved) {
          saved.classList.remove("is-hidden");
          var line = document.getElementById("quote-saved-text");
          if (line) line.textContent = "Saved: " + bits.join(" · ") + ".";
        }
      });
    }
  }

  function initBooking() {
    var dayRoot = document.getElementById("day-chips");
    var timeRoot = document.getElementById("time-pills");
    var jobRoot = document.getElementById("book-jobs");
    var summary = document.getElementById("book-summary");
    var form = document.getElementById("book-form");
    var saved = document.getElementById("book-saved");
    var err = document.getElementById("book-error");

    if (dayRoot) {
      var today = perthYmd(new Date());
      var firstOn = null;
      for (var i = 1; i <= 14; i++) {
        var ymd = addDaysYmd(today, i);
        var wd = weekdayIndex(ymd);
        var weekend = wd === 0 || wd === 6;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip";
        btn.setAttribute("data-value", ymd);
        btn.setAttribute("data-day", ymd);
        btn.innerHTML = "<span>" + WEEKDAYS[wd] + "</span><small>" + Number(ymd.slice(8, 10)) + " " + MONTHS[Number(ymd.slice(5, 7)) - 1] + "</small>";
        if (weekend) {
          btn.disabled = true;
          btn.setAttribute("aria-disabled", "true");
          btn.title = "Weekends are not available";
        } else if (!firstOn) {
          firstOn = btn;
        }
        dayRoot.appendChild(btn);
      }
      if (firstOn) {
        firstOn.classList.add("is-on");
        firstOn.setAttribute("aria-pressed", "true");
      }
    }

    function refreshSummary() {
      if (!summary) return;
      var day = selected(dayRoot);
      var windowName = selected(timeRoot) || "Morning";
      var job = selected(jobRoot) || "Service and maintenance";
      var dayLabel = day ? prettyDay(day) : "a weekday";
      summary.textContent = dayLabel + " · " + windowName + " · " + job;
    }

    group(dayRoot, refreshSummary);
    group(timeRoot, refreshSummary);
    group(jobRoot, refreshSummary);
    refreshSummary();

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = (document.getElementById("b-name") || {}).value || "";
        var phone = (document.getElementById("b-phone") || {}).value || "";
        if (!name.trim() || !phone.trim()) {
          if (err) {
            err.textContent = "Add your name and phone number.";
            err.classList.remove("is-hidden");
          }
          return;
        }
        if (err) err.classList.add("is-hidden");
        form.classList.add("is-hidden");
        if (saved) {
          saved.classList.remove("is-hidden");
          var line = document.getElementById("book-saved-text");
          if (line && summary) line.textContent = "Saved: " + summary.textContent + ".";
        }
      });
    }
  }

  initTheme();
  initFault();
  initBooking();
})();
