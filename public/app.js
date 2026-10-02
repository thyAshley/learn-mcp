// Browser client for the notes API. No framework, no build step.
//
// All note text reaches the DOM through textContent, never innerHTML, so a note
// containing markup renders as literal characters instead of executing.

const composer = document.querySelector('#composer');
const titleInput = document.querySelector('#title');
const bodyInput = document.querySelector('#body');
const list = document.querySelector('#notes');
const template = document.querySelector('#note-template');
const banner = document.querySelector('#banner');
const empty = document.querySelector('#empty');
const count = document.querySelector('#count');

/** Id of the note currently open for editing, if any. */
let editingId = null;

/**
 * Calls the API and returns the parsed body.
 * Throws an Error carrying the server's message so callers can surface it.
 */
async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // A response with no JSON body is fine; fall through to the status check.
  }

  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed (${response.status})`);
  }

  return payload;
}

function showError(message) {
  banner.textContent = message;
  banner.hidden = false;
}

function clearError() {
  banner.hidden = true;
  banner.textContent = '';
}

/** Renders a timestamp as a coarse relative label. */
function relativeTime(iso) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';

  const units = [
    ['minute', 60],
    ['hour', 60],
    ['day', 24],
  ];

  let value = Math.floor(seconds / 60);
  let unit = 'minute';
  for (let i = 0; i < units.length - 1; i += 1) {
    const [, divisor] = units[i + 1];
    if (value < divisor) break;
    value = Math.floor(value / divisor);
    unit = units[i + 1][0];
  }

  if (unit === 'day' && value > 30) {
    return new Date(then).toLocaleDateString();
  }

  return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
}

function metaLabel(note) {
  const created = relativeTime(note.createdAt);
  return note.updatedAt !== note.createdAt
    ? `edited ${relativeTime(note.updatedAt)}`
    : `added ${created}`;
}

/** Builds the <li> for one note, wiring up its own buttons. */
function renderNote(note) {
  const item = template.content.firstElementChild.cloneNode(true);
  item.dataset.id = note.id;

  const view = item.querySelector('.note__view');
  const form = item.querySelector('.note__edit');

  item.querySelector('.note__title').textContent = note.title;
  item.querySelector('.note__body').textContent = note.body;
  item.querySelector('.note__meta').textContent = metaLabel(note);

  const titleField = form.querySelector('[data-field="title"]');
  const bodyField = form.querySelector('[data-field="body"]');

  function openEditor() {
    editingId = note.id;
    titleField.value = note.title;
    bodyField.value = note.body;
    view.hidden = true;
    form.hidden = false;
    titleField.focus();
  }

  function closeEditor() {
    if (editingId === note.id) editingId = null;
    form.hidden = true;
    view.hidden = false;
  }

  item.querySelector('[data-action="edit"]').addEventListener('click', openEditor);
  item
    .querySelector('[data-action="cancel"]')
    .addEventListener('click', closeEditor);

  item
    .querySelector('[data-action="delete"]')
    .addEventListener('click', async () => {
      if (!confirm(`Delete “${note.title}”?`)) return;

      clearError();
      try {
        await api(`/notes/${note.id}`, { method: 'DELETE' });
        await refresh();
      } catch (error) {
        showError(error.message);
      }
    });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const title = titleField.value.trim();
    if (title === '') {
      showError('Title must not be empty.');
      return;
    }

    clearError();
    try {
      await api(`/notes/${note.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title, body: bodyField.value }),
      });
      closeEditor();
      await refresh();
    } catch (error) {
      showError(error.message);
    }
  });

  // Keep the editor open across the re-render that follows a save elsewhere.
  if (editingId === note.id) openEditor();

  return item;
}

function render(notes) {
  list.replaceChildren(...notes.map(renderNote));
  empty.hidden = notes.length > 0;
  count.textContent = notes.length === 1 ? '1 note' : `${notes.length} notes`;
}

async function refresh() {
  try {
    render(await api('/notes'));
  } catch (error) {
    showError(`Could not load notes: ${error.message}`);
  }
}

composer.addEventListener('submit', async (event) => {
  event.preventDefault();

  const title = titleInput.value.trim();
  if (title === '') {
    showError('Title must not be empty.');
    return;
  }

  clearError();
  try {
    await api('/notes', {
      method: 'POST',
      body: JSON.stringify({ title, body: bodyInput.value }),
    });
    composer.reset();
    titleInput.focus();
    await refresh();
  } catch (error) {
    showError(error.message);
  }
});

refresh();
