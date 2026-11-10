import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function salesContext(token = 'test-github-token') {
  const elements = new Map();
  const requests = [];
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.style = {};
      this.value = '';
    }
    set id(value) { elements.set(value, this); }
    addEventListener(type, handler) { this[`on${type}`] = handler; }
    setAttribute() {}
    append(...children) {
      this.children.push(...children);
      if (this.tag === 'select' && !this.value && this.children.length) {
        this.value = this.children[0].value;
      }
    }
    replaceChildren(...children) {
      this.children = [];
      if (this.tag === 'select') this.value = '';
      this.append(...children);
    }
    get options() { return this.children; }
    querySelector(selector) {
      return selector === 'button[type="submit"]'
        ? this.children.find(child => child.tag === 'button' && child.type === 'submit')
        : null;
    }
  }
  elements.set('modal', new Element('div'));
  elements.set('modal-overlay', new Element('div'));
  const window = {
    CERTIFICATES_API_URL: 'https://certificates.test',
    VlementAdmin: { getToken: () => token },
    confirm: () => true,
  };
  const context = vm.createContext({
    window,
    document: {
      createElement: tag => new Element(tag),
      getElementById: id => elements.get(id),
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const body = url.endsWith('/artworks')
        ? { artworks: [{ slug: 'print', title: 'Print', available: true, editionType: 'open', price: '10' }] }
        : options.method === 'POST'
          ? { sale: { sale_number: 'test-sale' }, artworkAvailable: true }
          : { sales: [], total: 0 };
      return { ok: true, status: 200, json: async () => body };
    },
  });
  vm.runInContext(await readFile('public/admin/sales.js', 'utf8'), context);
  return { window, elements, requests };
}

test('Sales sends the current GitHub bearer token on reads and writes', async () => {
  const { window, elements, requests } = await salesContext();
  await window.VlementSales.open();
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.options.headers.Authorization === 'Bearer test-github-token'));

  elements.get('sales-buyer-name').value = 'Test buyer';
  const modal = elements.get('modal');
  const form = modal.children.find(child => child.tag === 'section').children[0];
  form.onsubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const write = requests.find(request => request.options.method === 'POST');
  assert.ok(write, 'recording a sale sends a POST request');
  assert.equal(write.options.headers.Authorization, 'Bearer test-github-token');
  assert.equal(write.options.headers['Content-Type'], 'application/json');
});

test('Sales does not send requests without a GitHub token', async () => {
  const { window, elements, requests } = await salesContext(null);
  await window.VlementSales.open();
  assert.equal(requests.length, 0);
  assert.equal(elements.get('modal').children[3].textContent, 'Sign in again before managing sales.');
});
