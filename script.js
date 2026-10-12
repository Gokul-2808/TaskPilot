"use strict";

const $ = (id) => document.getElementById(id);
const db = window.supabaseClient;

let tasks = [];
let currentUser = null;
let currentFilter = "all";
let loadingTasks = false;
let currentView = "tasks";
let calendarCursor = new Date();
let selectedCalendarDate = localDateString(new Date());
let authRequestInProgress = false;
let displayedUserId = null;

const notifiedReminders = new Set();

if (!db) {
  document.body.innerHTML = `
    <div style="font-family:Arial;padding:30px">
      <h2>TaskFlow configuration error</h2>
      <p>Check supabase.js and the script order in index.html.</p>
    </div>`;
  throw new Error("Supabase client not initialized.");
}

const app = document.querySelector(".app");
const dialog = $("taskDialog");
const form = $("taskForm");
const taskList = $("taskList");

if (!app || !dialog || !form || !taskList) {
  throw new Error("Required TaskFlow HTML elements are missing.");
}

/* =========================================
   1. AUTHENTICATION SCREEN
========================================= */

function createAuthScreen() {
  let screen = $("authScreen");
  if (screen) return screen;

  screen = document.createElement("section");
  screen.id = "authScreen";
  screen.className = "auth-screen";

  screen.innerHTML = `
    <div class="auth-card">
      <div class="auth-brand">
        <i class="fa-solid fa-layer-group"></i> TaskFlow
      </div>

      <div class="auth-tag">YOUR PRODUCTIVITY SPACE</div>

      <h1 id="authHeading">Welcome back!</h1>
      <p id="authSubtitle">
        Sign in to organize your day and manage your tasks.
      </p>

      <form id="authForm">
        <label for="authEmail">Email address</label>
        <input
          id="authEmail"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          required
        >

        <label for="authPassword">Password</label>
        <input
          id="authPassword"
          type="password"
          autocomplete="current-password"
          minlength="6"
          placeholder="At least 6 characters"
          required
        >

        <p id="authMessage" role="status" aria-live="polite"></p>

        <button id="loginBtn" class="primary auth-submit" type="submit">
          Sign in
        </button>

        <button id="signupBtn" class="secondary auth-submit" type="button">
          Create account
        </button>

        <button id="forgotBtn" class="forgot-button" type="button">
          Forgot password?
        </button>
      </form>

      <p class="auth-foot">
        <i class="fa-solid fa-shield-halved"></i>
        Your tasks are protected by your account.
      </p>
    </div>
  `;

  document.body.insertBefore(screen, document.body.firstChild);
  return screen;
}

const authScreen = createAuthScreen();

app.hidden = true;
authScreen.hidden = false;

/* =========================================
   2. NOTIFICATIONS
========================================= */

function notify(message, isError = false) {
  let toast = $("taskToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "taskToast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }

  toast.style.background = isError
    ? "#b4233b"
    : document.body.classList.contains("dark")
      ? "#343052"
      : "#25233f";

  toast.textContent = message;

  clearTimeout(notify.timer);

  notify.timer = setTimeout(() => {
    toast.remove();
  }, 3800);
}

function authMessage(message, isError = false) {
  const element = $("authMessage");
  if (!element) return;

  element.textContent = message;
  element.style.color = isError ? "#c03950" : "#16845c";
}

function setAuthBusy(busy) {
  ["loginBtn", "signupBtn", "forgotBtn"].forEach(id => {
    if ($(id)) $(id).disabled = busy;
  });
}

/* =========================================
   3. HELPER FUNCTIONS
========================================= */

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function localDateString(date) {
  const local = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  );

  return local.toISOString().slice(0, 10);
}

function today() {
  return localDateString(new Date());
}

function formatDate(value) {
  if (!value) return "No date";

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) return "No date";

  return new Date(year, month - 1, day).toLocaleDateString(
    "en-IN",
    {
      day: "numeric",
      month: "short",
      year: "numeric"
    }
  );
}

function isOverdue(task) {
  return Boolean(
    !task.completed &&
    task.due_date &&
    task.due_date < today()
  );
}

function priorityRank(priority) {
  return ({ High: 0, Medium: 1, Low: 2 })[priority] ?? 3;
}

/* =========================================
   4. LOGIN AND SIGNUP
========================================= */

async function authenticate(mode) {
  if (authRequestInProgress) return;

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    authMessage("Please enter your email and password.", true);
    return;
  }

  if (password.length < 6) {
    authMessage("Password must contain at least 6 characters.", true);
    return;
  }

  authRequestInProgress = true;
  setAuthBusy(true);

  authMessage(
    mode === "signup"
      ? "Creating your account..."
      : "Signing in..."
  );

  try {
    const result = mode === "signup"
      ? await db.auth.signUp({ email, password })
      : await db.auth.signInWithPassword({ email, password });

    if (result.error) {
      authMessage(result.error.message, true);
      return;
    }

    if (mode === "signup" && !result.data.session) {
      $("authPassword").value = "";

      authMessage(
        "Account created! Check your email for the confirmation link, then sign in."
      );

      return;
    }

    if (result.data.session) {
      await handleSession(result.data.session);
    } else {
      authMessage("No active session. Please sign in again.", true);
    }
  } catch (error) {
    console.error("Authentication error:", error);

    authMessage(
      "Unable to connect. Check your internet connection and try again.",
      true
    );
  } finally {
    authRequestInProgress = false;
    setAuthBusy(false);
  }
}

async function resetPassword() {
  const email = $("authEmail").value.trim();

  if (!email) {
    authMessage("Enter your email address first.", true);
    $("authEmail").focus();
    return;
  }

  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });

  if (error) {
    authMessage(error.message, true);
    return;
  }

  authMessage(
    "If the account exists, a password reset email will be sent."
  );
}

/* =========================================
   5. ACCOUNT CONTROLS
========================================= */

function createAccountControls() {
  let account = $("accountControls");

  if (account) return account;

  account = document.createElement("div");
  account.id = "accountControls";
  account.className = "account-controls";

  account.innerHTML = `
    <span id="userEmail"></span>

    <button id="logoutBtn" type="button" class="secondary">
      <i class="fa-solid fa-right-from-bracket"></i>
      Sign out
    </button>
  `;

  app.querySelector(".topbar").insertAdjacentElement(
    "afterend",
    account
  );

  $("logoutBtn").addEventListener("click", signOut);

  return account;
}

async function handleSession(session) {
  const user = session?.user || null;

  if (!user) {
    currentUser = null;
    displayedUserId = null;
    tasks = [];

    app.hidden = true;
    authScreen.hidden = false;

    renderTasks();
    updateInsights();

    return;
  }

  const changed = currentUser?.id !== user.id;

  currentUser = user;
  authScreen.hidden = true;
  app.hidden = false;

  createAccountControls();

  $("userEmail").textContent = user.email || "Signed in";

  if (changed || displayedUserId !== user.id) {
    displayedUserId = user.id;
    tasks = [];
    await loadTasks();
  }
}

async function signOut() {
  const button = $("logoutBtn");

  if (button) button.disabled = true;

  try {
    const { error } = await db.auth.signOut();

    if (error) {
      notify("Could not sign out: " + error.message, true);
      return;
    }

    currentUser = null;
    displayedUserId = null;
    tasks = [];

    app.hidden = true;
    authScreen.hidden = false;

    $("authPassword").value = "";
    authMessage("You have signed out successfully.");

    renderTasks();
  } catch (error) {
    console.error(error);
    notify("Sign-out failed. Please try again.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

/* =========================================
   6. LOAD TASKS FROM SUPABASE
========================================= */

async function loadTasks() {
  if (!currentUser || loadingTasks) return;

  loadingTasks = true;
  const userId = currentUser.id;

  try {
    const { data, error } = await db
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Loading tasks failed:", error);
      notify("Could not load tasks: " + error.message, true);
      return;
    }

    if (!currentUser || currentUser.id !== userId) return;

    tasks = (data || []).map(task => ({
      ...task,
      description: task.description || "",
      due_date: task.due_date || "",
      completed: task.completed === true
    }));

    renderTasks();
    updateInsights();
    renderCalendar();
    checkReminders();
  } finally {
    loadingTasks = false;
  }
}

/* =========================================
   7. DASHBOARD STATISTICS
========================================= */

function updateStatistics() {
  $("total").textContent = tasks.length;

  $("activeCount").textContent =
    tasks.filter(task => !task.completed).length;

  $("doneCount").textContent =
    tasks.filter(task => task.completed).length;

  $("overdueCount").textContent =
    tasks.filter(isOverdue).length;

  if ($("allNavCount")) {
    $("allNavCount").textContent = tasks.length;
  }
}

/* =========================================
   8. RENDER TASK TABLE
========================================= */

function renderTasks() {
  if (!taskList) return;

  updateStatistics();

  const titles = {
    all: "All Tasks",
    active: "In Progress",
    completed: "Completed",
    today: "Due Today"
  };

  $("listTitle").textContent =
    titles[currentFilter] || "All Tasks";

  const query = $("search").value.trim().toLowerCase();
  const priority = $("priorityFilter").value;
  const sort = $("sortFilter")?.value || "due";

  const visible = tasks.filter(task => {
    const searchableText =
      `${task.title} ${task.description || ""}`.toLowerCase();

    const matchesSearch = searchableText.includes(query);

    const matchesPriority =
      priority === "all" || task.priority === priority;

    let matchesFilter = true;

    if (currentFilter === "active") {
      matchesFilter = !task.completed;
    } else if (currentFilter === "completed") {
      matchesFilter = task.completed;
    } else if (currentFilter === "today") {
      matchesFilter = task.due_date === today();
    }

    return matchesSearch && matchesPriority && matchesFilter;
  });

  visible.sort((a, b) => {
    if (a.completed !== b.completed) {
      return Number(a.completed) - Number(b.completed);
    }

    if (sort === "priority") {
      return priorityRank(a.priority) - priorityRank(b.priority);
    }

    if (sort === "created") {
      return String(b.created_at || "").localeCompare(
        String(a.created_at || "")
      );
    }

    return (a.due_date || "9999-12-31").localeCompare(
      b.due_date || "9999-12-31"
    );
  });

  taskList.innerHTML = visible.map(task => {
    let dueLabel = formatDate(task.due_date);
    let dueClass = "";

    if (isOverdue(task)) {
      dueLabel = "Overdue · " + dueLabel;
      dueClass = "due-overdue";
    } else if (!task.completed && task.due_date === today()) {
      dueLabel = "Today · " + dueLabel;
      dueClass = "due-today";
    }

    return `
      <tr class="${task.completed ? "completed" : ""}">
        <td>
          <span class="task-name">${escapeHTML(task.title)}</span>

          ${task.description ? `
            <span class="task-description">
              ${escapeHTML(task.description)}
            </span>
          ` : ""}
        </td>

        <td>
          <span class="pill ${escapeHTML(task.priority)}">
            ${escapeHTML(task.priority)}
          </span>
        </td>

        <td class="${dueClass}">
          ${escapeHTML(dueLabel)}
        </td>

        <td>
          <span class="pill status ${task.completed ? "done" : ""}">
            ${task.completed ? "Completed" : "In progress"}
          </span>
        </td>

        <td>
          <div class="actions">
            <button
              class="icon-btn"
              data-action="toggle"
              data-id="${escapeHTML(task.id)}"
              aria-label="${task.completed ? "Reopen" : "Complete"} task"
              title="${task.completed ? "Reopen task" : "Complete task"}"
            >
              <i class="fa-solid ${
                task.completed ? "fa-rotate-left" : "fa-check"
              }"></i>
            </button>

            <button
              class="icon-btn"
              data-action="edit"
              data-id="${escapeHTML(task.id)}"
              aria-label="Edit task"
              title="Edit task"
            >
              <i class="fa-solid fa-pen"></i>
            </button>

            <button
              class="icon-btn"
              data-action="delete"
              data-id="${escapeHTML(task.id)}"
              aria-label="Delete task"
              title="Delete task"
            >
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  $("empty").hidden = visible.length > 0;

  updateInsights();
}

/* =========================================
   9. CREATE AND UPDATE TASKS
========================================= */

async function saveTask(taskId, values) {
  if (!currentUser) {
    notify("Please sign in first.", true);
    return false;
  }

  if (
    values.priority &&
    !["High", "Medium", "Low"].includes(values.priority)
  ) {
    notify("Invalid priority selected.", true);
    return false;
  }

  try {
    const result = taskId
      ? await db
          .from("tasks")
          .update(values)
          .eq("id", taskId)
          .select()
          .single()
      : await db
          .from("tasks")
          .insert({
            ...values,
            user_id: currentUser.id
          })
          .select()
          .single();

    if (result.error) {
      console.error("Task save failed:", result.error);
      notify("Unable to save task: " + result.error.message, true);
      return false;
    }

    await loadTasks();

    notify(taskId ? "Task updated!" : "Task created!");

    return true;
  } catch (error) {
    console.error(error);
    notify("Unexpected error while saving task.", true);
    return false;
  }
}

/* =========================================
   10. CREATE / EDIT DIALOG
========================================= */

function openTaskDialog(task = null, presetDate = "") {
  if (!currentUser) {
    notify("Sign in to manage tasks.", true);
    return;
  }

  form.reset();

  $("taskId").value = task?.id || "";
  $("taskTitle").value = task?.title || "";
  $("taskDescription").value = task?.description || "";
  $("taskPriority").value = task?.priority || "Medium";
  $("taskDue").value = task?.due_date || presetDate || today();

  $("formTitle").textContent = task
    ? "Edit task"
    : "Create a task";

  form.querySelector('[type="submit"]').innerHTML = `
    <i class="fa-solid fa-check"></i>
    ${task ? "Update task" : "Save task"}
  `;

  dialog.showModal();
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  const submit = form.querySelector('[type="submit"]');

  if (submit.disabled) return;

  const title = $("taskTitle").value.trim();
  const description = $("taskDescription").value.trim();
  const priority = $("taskPriority").value;
  const dueDate = $("taskDue").value;
  const taskId = $("taskId").value;

  if (!title || title.length > 100) {
    notify("Enter a title of 1–100 characters.", true);
    return;
  }

  if (description.length > 500) {
    notify("Description cannot exceed 500 characters.", true);
    return;
  }

  if (!["High", "Medium", "Low"].includes(priority)) {
    notify("Choose a valid priority.", true);
    return;
  }

  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    notify("Please select a valid due date.", true);
    return;
  }

  submit.disabled = true;

  try {
    const success = await saveTask(taskId, {
      title,
      description,
      priority,
      due_date: dueDate
    });

    if (success) dialog.close();
  } finally {
    submit.disabled = false;
  }
});

/* =========================================
   11. TASK ACTIONS
========================================= */

taskList.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");

  if (!button || button.disabled || !currentUser) return;

  const task = tasks.find(item => item.id === button.dataset.id);

  if (!task) return;

  const action = button.dataset.action;

  if (action === "edit") {
    openTaskDialog(task);
    return;
  }

  button.disabled = true;

  try {
    if (action === "delete") {
      if (!confirm(`Delete "${task.title}"?`)) return;

      const { error } = await db
        .from("tasks")
        .delete()
        .eq("id", task.id);

      if (error) {
        notify("Delete failed: " + error.message, true);
        return;
      }

      await loadTasks();
      notify("Task deleted successfully!");
    }

    if (action === "toggle") {
      await saveTask(task.id, {
        completed: !task.completed
      });
    }
  } finally {
    button.disabled = false;
  }
});

/* =========================================
   12. PRODUCTIVITY ANALYTICS
========================================= */

function updateInsights() {
  const total = tasks.length;
  const done = tasks.filter(task => task.completed).length;
  const percentage = total
    ? Math.round((done / total) * 100)
    : 0;

  if ($("progressBar")) {
    $("progressBar").style.width = percentage + "%";
  }

  if ($("progressPercent")) {
    $("progressPercent").textContent = percentage + "%";
  }

  if ($("progressText")) {
    $("progressText").textContent = total
      ? `${done} of ${total} tasks completed`
      : "No tasks completed yet";
  }

  if ($("analyticsCompletion")) {
    $("analyticsCompletion").textContent = percentage + "%";
  }

  if ($("analyticsCompletionBar")) {
    $("analyticsCompletionBar").style.width = percentage + "%";
  }

  if ($("analyticsCompleted")) {
    $("analyticsCompleted").textContent = done;
  }

  if ($("analyticsHigh")) {
    $("analyticsHigh").textContent = tasks.filter(
      task => !task.completed && task.priority === "High"
    ).length;
  }

  const upcoming = tasks
    .filter(task => !task.completed && task.due_date)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  if ($("upNextText")) {
    const next = upcoming[0];

    $("upNextText").textContent = !next
      ? "Nothing scheduled. You're all caught up!"
      : `${next.title} · ${
          next.due_date < today()
            ? "Overdue"
            : next.due_date === today()
              ? "Due today"
              : "Due " + formatDate(next.due_date)
        }`;
  }

  if ($("priorityBreakdown")) {
    const priorities = ["High", "Medium", "Low"];
    const openTasks = tasks.filter(task => !task.completed).length;

    $("priorityBreakdown").innerHTML = priorities.map(priority => {
      const count = tasks.filter(
        task => task.priority === priority && !task.completed
      ).length;

      const percent = openTasks
        ? Math.round((count / openTasks) * 100)
        : 0;

      const color = priority === "High"
        ? "#e65c76"
        : priority === "Medium"
          ? "#e2a53b"
          : "#29a879";

      return `
        <div class="breakdown-row">
          <span>${priority}</span>
          <div class="mini-track">
            <span style="width:${percent}%;background:${color}"></span>
          </div>
          <strong>${count}</strong>
        </div>
      `;
    }).join("");
  }

  if ($("recentTasks")) {
    const recent = [...tasks]
      .sort((a, b) =>
        String(b.created_at || "").localeCompare(
          String(a.created_at || "")
        )
      )
      .slice(0, 5);

    $("recentTasks").innerHTML = recent.length
      ? recent.map(task => `
          <div class="recent-item">
            <strong>${escapeHTML(task.title)}</strong>
            <small>${escapeHTML(formatDate(task.due_date))}</small>
          </div>
        `).join("")
      : '<p class="muted">Your recent tasks will appear here.</p>';
  }
}

/* =========================================
   13. VIEW NAVIGATION
========================================= */

function setView(view) {
  currentView = view;

  $("tasksView").hidden = view !== "tasks";
  $("calendarView").hidden = view !== "calendar";
  $("analyticsView").hidden = view !== "analytics";

  document.querySelectorAll(".view-nav").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  if (view === "calendar") renderCalendar();
  if (view === "analytics") updateInsights();
}

/* =========================================
   14. INTERACTIVE CALENDAR
========================================= */

function renderCalendar() {
  const container = $("calendarDays");

  if (!container) return;

  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();

  $("calendarMonth").textContent =
    new Date(year, month, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric"
    });

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();

  let cells = "";

  for (let index = 0; index < 42; index++) {
    let dayNumber;
    let date;
    let outside = false;

    if (index < firstWeekday) {
      dayNumber = previousMonthDays - firstWeekday + index + 1;
      date = localDateString(
        new Date(year, month - 1, dayNumber)
      );
      outside = true;
    } else if (index >= firstWeekday + daysInMonth) {
      dayNumber = index - firstWeekday - daysInMonth + 1;
      date = localDateString(
        new Date(year, month + 1, dayNumber)
      );
      outside = true;
    } else {
      dayNumber = index - firstWeekday + 1;
      date = localDateString(
        new Date(year, month, dayNumber)
      );
    }

    const dayTasks = tasks.filter(
      task => task.due_date === date && !task.completed
    );

    cells += `
      <button
        type="button"
        class="calendar-day
          ${outside ? "outside" : ""}
          ${date === today() ? "is-today" : ""}
          ${date === selectedCalendarDate ? "selected" : ""}"
        data-date="${date}"
        aria-label="${formatDate(date)}, ${dayTasks.length} open tasks"
      >
        <span class="day-number">${dayNumber}</span>

        ${dayTasks.length ? `
          <span class="day-dots">
            ${dayTasks.slice(0, 4).map(task => `
              <i class="day-dot ${escapeHTML(task.priority)}"></i>
            `).join("")}
          </span>
          <span class="day-task-count">
            ${dayTasks.length} task${dayTasks.length === 1 ? "" : "s"}
          </span>
        ` : ""}
      </button>
    `;
  }

  container.innerHTML = cells;
  renderSelectedDate();
}

function renderSelectedDate() {
  $("selectedDateTitle").textContent =
    formatDate(selectedCalendarDate);

  const selected = tasks
    .filter(task => task.due_date === selectedCalendarDate)
    .sort((a, b) => Number(a.completed) - Number(b.completed));

  $("selectedDateTasks").innerHTML = selected.length
    ? selected.map(task => `
        <div class="calendar-task">
          <div>
            <strong>${escapeHTML(task.title)}</strong>
            <span class="pill ${escapeHTML(task.priority)}">
              ${escapeHTML(task.priority)}
            </span>
            <div class="muted">
              ${task.completed ? "Completed" : "In progress"}
            </div>
          </div>
          <button
            type="button"
            data-calendar-edit="${escapeHTML(task.id)}"
          >
            Edit
          </button>
        </div>
      `).join("")
    : '<p class="muted">No tasks due on this date.</p>';
}

$("calendarDays").addEventListener("click", event => {
  const day = event.target.closest("[data-date]");

  if (!day) return;

  selectedCalendarDate = day.dataset.date;

  const [year, month] = selectedCalendarDate
    .split("-")
    .map(Number);

  calendarCursor = new Date(year, month - 1, 1);

  renderCalendar();
});

$("selectedDateTasks").addEventListener("click", event => {
  const button = event.target.closest("[data-calendar-edit]");

  if (!button) return;

  const task = tasks.find(
    item => item.id === button.dataset.calendarEdit
  );

  if (task) openTaskDialog(task);
});

$("prevMonth").addEventListener("click", () => {
  calendarCursor = new Date(
    calendarCursor.getFullYear(),
    calendarCursor.getMonth() - 1,
    1
  );

  renderCalendar();
});

$("nextMonth").addEventListener("click", () => {
  calendarCursor = new Date(
    calendarCursor.getFullYear(),
    calendarCursor.getMonth() + 1,
    1
  );

  renderCalendar();
});

$("todayMonth").addEventListener("click", () => {
  calendarCursor = new Date();
  selectedCalendarDate = today();
  renderCalendar();
});

/* =========================================
   15. BROWSER REMINDERS
========================================= */

function checkReminders() {
  if (
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return;
  }

  const dueTasks = tasks.filter(task =>
    !task.completed &&
    task.due_date &&
    task.due_date <= today()
  );

  dueTasks.forEach(task => {
    const key = `${task.id}:${today()}`;

    if (notifiedReminders.has(key)) return;

    notifiedReminders.add(key);

    try {
      new Notification(
        task.due_date < today()
          ? "Overdue task"
          : "Task due today",
        { body: task.title }
      );
    } catch (error) {
      console.warn("Notification could not be shown:", error);
    }
  });
}

$("reminderToggle").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    notify("Browser notifications are not supported in this browser.", true);
    return;
  }

  if (Notification.permission === "granted") {
    notify("Browser reminders are already enabled.");
    checkReminders();
    return;
  }

  if (Notification.permission === "denied") {
    notify(
      "Notifications are blocked in browser settings. Allow them for this site.",
      true
    );
    return;
  }

  const permission = await Notification.requestPermission();

  if (permission === "granted") {
    notify("Browser reminders enabled!");
    checkReminders();
  } else {
    notify("Notification permission was not granted.", true);
  }
});

/* =========================================
   16. DARK MODE
========================================= */

$("themeToggle").addEventListener("click", () => {
  const dark = document.body.classList.toggle("dark");

  try {
    localStorage.setItem(
      "taskflow-theme",
      dark ? "dark" : "light"
    );
  } catch (error) {
    console.warn("Theme preference could not be saved.");
  }

  $("themeToggle").innerHTML = `
    <i class="fa-solid ${dark ? "fa-sun" : "fa-moon"}"></i>
  `;

  $("themeToggle").title = dark
    ? "Switch to light mode"
    : "Switch to dark mode";
});

try {
  if (localStorage.getItem("taskflow-theme") === "dark") {
    document.body.classList.add("dark");
    $("themeToggle").innerHTML =
      '<i class="fa-solid fa-sun"></i>';
    $("themeToggle").title = "Switch to light mode";
  }
} catch (error) {
  console.warn("Saved theme could not be loaded.");
}

/* =========================================
   17. SEARCH, FILTERS AND SORTING
========================================= */

$("search").addEventListener("input", renderTasks);

$("priorityFilter").addEventListener("change", renderTasks);

$("sortFilter").addEventListener("change", renderTasks);

document.querySelectorAll(".nav[data-filter]").forEach(button => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;

    document.querySelectorAll(".nav[data-filter]").forEach(nav => {
      const selected = nav === button;

      nav.classList.toggle("active", selected);
      nav.setAttribute("aria-pressed", String(selected));
    });

    setView("tasks");
    renderTasks();
  });
});

document.querySelectorAll(".view-nav").forEach(button => {
  button.addEventListener("click", () => {
    setView(button.dataset.view);
  });
});

$("showUpcomingBtn").addEventListener("click", () => {
  currentFilter = "active";

  document.querySelectorAll(".nav[data-filter]").forEach(nav => {
    nav.classList.toggle(
      "active",
      nav.dataset.filter === "active"
    );
  });

  setView("tasks");
  renderTasks();
});

/* =========================================
   18. DIALOG CONTROLS
========================================= */

$("addBtn").addEventListener("click", () => {
  openTaskDialog();
});

$("closeBtn").addEventListener("click", () => {
  dialog.close();
});

$("cancelBtn").addEventListener("click", () => {
  dialog.close();
});

dialog.addEventListener("click", event => {
  if (event.target === dialog) {
    dialog.close();
  }
});

/* =========================================
   19. AUTHENTICATION BUTTONS
========================================= */

$("authForm").addEventListener("submit", event => {
  event.preventDefault();
  authenticate("login");
});

$("signupBtn").addEventListener("click", () => {
  authenticate("signup");
});

$("forgotBtn").addEventListener("click", resetPassword);

/* =========================================
   20. INITIALIZE APPLICATION
========================================= */

$("todayLabel").textContent =
  new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }) + " · Let's make today productive.";

async function initializeApp() {
  app.hidden = true;
  authScreen.hidden = false;

  db.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      handleSession(session).catch(error => {
        console.error("Session handling failed:", error);
        notify("Unable to load your dashboard.", true);
      });
    }, 0);
  });

  try {
    const { data, error } = await db.auth.getSession();

    if (error) throw error;

    await handleSession(data.session);
  } catch (error) {
    console.error("Session initialization failed:", error);

    app.hidden = true;
    authScreen.hidden = false;

    authMessage(
      "Could not verify your session. Check your connection and refresh.",
      true
    );
  }
}

initializeApp();

/* Check due tasks while the page is open. */
setInterval(checkReminders, 60000);