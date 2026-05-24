import { describe, it, expect, beforeEach } from 'vitest';
import { scanFields, resolveLabel, isFillable, applyFill } from '../lib/fields.js';

function setHtml(html) {
  document.body.innerHTML = html;
}

describe('isFillable', () => {
  beforeEach(() => setHtml(''));

  it('accepts text inputs', () => {
    setHtml('<input id="x" type="text">');
    expect(isFillable(document.getElementById('x'))).toBe(true);
  });
  it('accepts textareas', () => {
    setHtml('<textarea id="x"></textarea>');
    expect(isFillable(document.getElementById('x'))).toBe(true);
  });
  it('accepts selects', () => {
    setHtml('<select id="x"><option>a</option></select>');
    expect(isFillable(document.getElementById('x'))).toBe(true);
  });
  it('rejects file inputs', () => {
    setHtml('<input id="x" type="file">');
    expect(isFillable(document.getElementById('x'))).toBe(false);
  });
  it('rejects password inputs', () => {
    setHtml('<input id="x" type="password">');
    expect(isFillable(document.getElementById('x'))).toBe(false);
  });
  it('rejects hidden inputs', () => {
    setHtml('<input id="x" type="hidden">');
    expect(isFillable(document.getElementById('x'))).toBe(false);
  });
  it('rejects submit/button inputs', () => {
    setHtml('<input id="x" type="submit">');
    expect(isFillable(document.getElementById('x'))).toBe(false);
  });
  it('rejects elements inside [data-apply-plugin-skip]', () => {
    setHtml('<div data-apply-plugin-skip><input id="x" type="text"></div>');
    expect(isFillable(document.getElementById('x'))).toBe(false);
  });
});

describe('resolveLabel', () => {
  beforeEach(() => setHtml(''));

  it('uses <label for> when available', () => {
    setHtml('<label for="x">First Name</label><input id="x" type="text">');
    expect(resolveLabel(document.getElementById('x'))).toBe('First Name');
  });

  it('uses wrapping <label> when no for', () => {
    setHtml('<label>Email <input id="x" type="email"></label>');
    expect(resolveLabel(document.getElementById('x'))).toBe('Email');
  });

  it('uses aria-labelledby', () => {
    setHtml('<span id="lbl">Phone</span><input id="x" aria-labelledby="lbl" type="tel">');
    expect(resolveLabel(document.getElementById('x'))).toBe('Phone');
  });

  it('uses aria-label', () => {
    setHtml('<input id="x" aria-label="LinkedIn URL" type="url">');
    expect(resolveLabel(document.getElementById('x'))).toBe('LinkedIn URL');
  });

  it('uses placeholder when no label/aria', () => {
    setHtml('<input id="x" placeholder="Your name" type="text">');
    expect(resolveLabel(document.getElementById('x'))).toBe('Your name');
  });

  it('uses nearest preceding text in the same row when no label/aria/placeholder', () => {
    setHtml('<div class="row">Country of residence <input id="x" type="text"></div>');
    expect(resolveLabel(document.getElementById('x'))).toBe('Country of residence');
  });

  it('falls back to prettified name attribute', () => {
    setHtml('<input id="x" name="firstName" type="text">');
    expect(resolveLabel(document.getElementById('x'))).toBe('First Name');
  });

  it('returns empty string if nothing resolves', () => {
    setHtml('<input id="x" type="text">');
    expect(resolveLabel(document.getElementById('x'))).toBe('');
  });

  it('normalizes the resolved label', () => {
    setHtml('<label for="x">Email *</label><input id="x" type="email">');
    expect(resolveLabel(document.getElementById('x'))).toBe('Email');
  });
});

describe('scanFields', () => {
  beforeEach(() => setHtml(''));

  it('returns fields with id, type, label', () => {
    setHtml(`
      <label for="a">First Name</label><input id="a" type="text">
      <label for="b">Email</label><input id="b" type="email">
    `);
    const fields = scanFields(document.body);
    expect(fields.length).toBe(2);
    expect(fields[0].label).toBe('First Name');
    expect(fields[0].type).toBe('text');
    expect(fields[0].id).toMatch(/^apf-/);
    expect(fields[1].label).toBe('Email');
  });

  it('includes options for selects', () => {
    setHtml(`
      <label for="c">Country</label>
      <select id="c">
        <option value="us">United States</option>
        <option value="ca">Canada</option>
      </select>
    `);
    const [field] = scanFields(document.body);
    expect(field.type).toBe('select');
    expect(field.options).toEqual([
      { value: 'us', text: 'United States' },
      { value: 'ca', text: 'Canada' },
    ]);
  });

  it('groups radio buttons by name with options', () => {
    setHtml(`
      <label>Authorized to work?</label>
      <label><input type="radio" name="auth" value="yes"> Yes</label>
      <label><input type="radio" name="auth" value="no"> No</label>
    `);
    const fields = scanFields(document.body);
    const radioGroup = fields.find((f) => f.type === 'radio');
    expect(radioGroup).toBeDefined();
    expect(radioGroup.options).toEqual([
      { value: 'yes', text: 'Yes' },
      { value: 'no', text: 'No' },
    ]);
  });

  it('skips fields with no resolvable label', () => {
    setHtml('<input id="x" type="text">');
    expect(scanFields(document.body)).toEqual([]);
  });

  it('skips file/password/hidden/submit inputs', () => {
    setHtml(`
      <label for="a">Resume</label><input id="a" type="file">
      <label for="b">Password</label><input id="b" type="password">
    `);
    expect(scanFields(document.body)).toEqual([]);
  });

  it('assigns unique transient ids', () => {
    setHtml(`
      <label for="a">One</label><input id="a" type="text">
      <label for="b">Two</label><input id="b" type="text">
    `);
    const fields = scanFields(document.body);
    const ids = fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('applyFill', () => {
  beforeEach(() => setHtml(''));

  it('fills text inputs and dispatches input + change', () => {
    setHtml('<input id="x" type="text">');
    const el = document.getElementById('x');
    let inputFired = false, changeFired = false;
    el.addEventListener('input', () => { inputFired = true; });
    el.addEventListener('change', () => { changeFired = true; });
    applyFill(el, 'Hello');
    expect(el.value).toBe('Hello');
    expect(inputFired).toBe(true);
    expect(changeFired).toBe(true);
  });

  it('fills textareas', () => {
    setHtml('<textarea id="x"></textarea>');
    const el = document.getElementById('x');
    applyFill(el, 'Long text');
    expect(el.value).toBe('Long text');
  });

  it('fills selects by value and dispatches change', () => {
    setHtml('<select id="x"><option value="us">United States</option><option value="ca">Canada</option></select>');
    const el = document.getElementById('x');
    let changed = false;
    el.addEventListener('change', () => { changed = true; });
    applyFill(el, 'ca');
    expect(el.value).toBe('ca');
    expect(changed).toBe(true);
  });

  it('checks the matching radio in a group', () => {
    setHtml('<input type="radio" name="g" value="yes"><input type="radio" name="g" value="no">');
    // applyFill receives the group representative (first radio) and the value.
    const first = document.querySelector('input[name="g"][value="yes"]');
    applyFill(first, 'no');
    expect(document.querySelector('input[name="g"][value="no"]').checked).toBe(true);
    expect(document.querySelector('input[name="g"][value="yes"]').checked).toBe(false);
  });

  it('checks a standalone checkbox when value is truthy', () => {
    setHtml('<input id="x" type="checkbox">');
    const el = document.getElementById('x');
    applyFill(el, 'yes');
    expect(el.checked).toBe(true);
  });
});
