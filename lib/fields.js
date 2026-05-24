import { normalizeLabel } from './storage.js';

const TEXT_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url', 'number', 'date', 'search']);

// CSS.escape is unavailable in jsdom; fall back to a manual escape for CSS identifiers.
function cssEscape(s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_\-]/g, (ch) => '\\' + ch);
}

export function isFillable(el) {
  if (!el || !el.tagName) return false;
  if (el.closest('[data-apply-plugin-skip]')) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag !== 'input') return false;
  const type = (el.type || 'text').toLowerCase();
  if (type === 'radio' || type === 'checkbox') return true;
  return TEXT_INPUT_TYPES.has(type);
}

function prettify(name) {
  if (!name) return '';
  return name
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function resolveLabel(el) {
  if (!el) return '';
  // 1. <label for="id">
  if (el.id) {
    const lbl = el.ownerDocument.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (lbl && lbl.textContent.trim()) return normalizeLabel(lbl.textContent);
  }
  // 2. wrapping <label>
  const wrap = el.closest('label');
  if (wrap) {
    // text content minus the input itself
    const clone = wrap.cloneNode(true);
    clone.querySelectorAll('input, textarea, select').forEach((n) => n.remove());
    const text = clone.textContent.trim();
    if (text) return normalizeLabel(text);
  }
  // 3. aria-labelledby
  const ariaLbl = el.getAttribute('aria-labelledby');
  if (ariaLbl) {
    const target = el.ownerDocument.getElementById(ariaLbl);
    if (target && target.textContent.trim()) return normalizeLabel(target.textContent);
  }
  // 4. aria-label
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return normalizeLabel(aria);
  // 5. placeholder
  const ph = el.getAttribute('placeholder');
  if (ph && ph.trim()) return normalizeLabel(ph);
  // 6. nearest preceding text in the same block ancestor
  const nearby = nearestPrecedingText(el);
  if (nearby) return normalizeLabel(nearby);
  // 7. name attribute prettified
  const name = el.getAttribute('name');
  if (name && name.trim()) return normalizeLabel(prettify(name));
  return '';
}

function nearestPrecedingText(el) {
  // Walk up to the closest block-ish ancestor (div, p, fieldset, td, li, tr).
  let container = el.parentElement;
  while (container && !['DIV', 'P', 'FIELDSET', 'TD', 'LI', 'TR', 'SECTION'].includes(container.tagName)) {
    container = container.parentElement;
  }
  if (!container) return '';
  // Collect text nodes that precede the element in document order within the container.
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const collected = [];
  let node;
  while ((node = walker.nextNode())) {
    const cmp = node.compareDocumentPosition(el);
    // el follows the text node
    if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) {
      const t = node.textContent.trim();
      if (t) collected.push(t);
    } else {
      break;
    }
  }
  // Take the last preceding text fragment (closest in document order).
  return collected.length ? collected[collected.length - 1] : '';
}

function selectOptions(selectEl) {
  return Array.from(selectEl.options).map((o) => ({
    value: o.value,
    text: (o.textContent || '').trim(),
  }));
}

function radioGroupOptions(doc, name) {
  const radios = doc.querySelectorAll(`input[type="radio"][name="${cssEscape(name)}"]`);
  return Array.from(radios).map((r) => {
    // option text: associated label or sibling text
    let text = '';
    if (r.id) {
      const lbl = doc.querySelector(`label[for="${cssEscape(r.id)}"]`);
      if (lbl) text = lbl.textContent.trim();
    }
    if (!text) {
      const wrap = r.closest('label');
      if (wrap) {
        const clone = wrap.cloneNode(true);
        clone.querySelectorAll('input').forEach((n) => n.remove());
        text = clone.textContent.trim();
      }
    }
    return { value: r.value, text: text || r.value };
  });
}

export function scanFields(root) {
  const doc = root.ownerDocument || document;
  const all = root.querySelectorAll('input, textarea, select');
  const fields = [];
  const seenRadioGroups = new Set();
  let counter = 0;

  for (const el of all) {
    if (!isFillable(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? (el.type || 'text').toLowerCase() : tag;

    if (type === 'radio') {
      const name = el.name;
      if (!name || seenRadioGroups.has(name)) continue;
      seenRadioGroups.add(name);
      // label: try to find a grouping label (legend, preceding heading) or use name
      // We look for a fieldset > legend, otherwise resolveLabel on this radio.
      const fieldset = el.closest('fieldset');
      let label = '';
      if (fieldset) {
        const legend = fieldset.querySelector('legend');
        if (legend && legend.textContent.trim()) label = normalizeLabel(legend.textContent);
      }
      if (!label) label = resolveLabel(el);
      if (!label) continue;
      fields.push({
        el,
        id: `apf-${++counter}`,
        type: 'radio',
        label,
        options: radioGroupOptions(doc, name),
      });
      continue;
    }

    const label = resolveLabel(el);
    if (!label) continue;

    const field = { el, id: `apf-${++counter}`, type, label };
    if (type === 'select' || tag === 'select') {
      field.type = 'select';
      field.options = selectOptions(el);
    } else if (type === 'checkbox') {
      field.type = 'checkbox';
    } else if (tag === 'textarea') {
      field.type = 'textarea';
    } else {
      field.type = 'text';
    }
    fields.push(field);
  }
  return fields;
}

function fire(el, evt) {
  el.dispatchEvent(new Event(evt, { bubbles: true }));
}

export function applyFill(el, value) {
  const tag = el.tagName.toLowerCase();
  const type = tag === 'input' ? (el.type || 'text').toLowerCase() : tag;

  if (type === 'radio') {
    const radios = el.ownerDocument.querySelectorAll(
      `input[type="radio"][name="${cssEscape(el.name)}"]`
    );
    for (const r of radios) {
      const match = r.value === value;
      if (match !== r.checked) {
        r.checked = match;
        if (match) fire(r, 'change');
      }
    }
    return;
  }
  if (type === 'checkbox') {
    const truthy = ['yes', 'true', '1', 'on', 'checked'].includes(String(value).toLowerCase());
    if (el.checked !== truthy) {
      el.checked = truthy;
      fire(el, 'change');
    }
    return;
  }
  // text, textarea, select
  el.value = value;
  fire(el, 'input');
  fire(el, 'change');
}
