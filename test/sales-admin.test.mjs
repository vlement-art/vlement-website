import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

async function salesContext(token = 'test-github-token', options = {}) {
  const elements = new Map();
  const requests = [];
  const downloads = [];
  const optionsForTest = options;
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.style = {};
      this.value = '';
    }
    set id(value) { elements.set(value, this); }
    addEventListener(type, handler) { this[`on${type}`] = handler; }
    setAttribute(name, value) { this[name] = value; }
    checkValidity() { return this.value.includes('@') && this.value.includes('.'); }
    click() { downloads.push(this.download); }
    append(...children) {
      this.children.push(...children);
      for (const child of children) if (child.tag === 'iframe') queueMicrotask(() => child.onload());
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
    XLSX: options.xlsx,
  };
  const context = vm.createContext({
    window,
    document: {
      createElement: tag => {
        const node = new Element(tag);
        if (tag === 'iframe') node.contentWindow = {
          focus() {},
          print() { requests.push({ url: 'print-dialog' }); },
        };
        return node;
      },
      getElementById: id => elements.get(id),
    },
    ensureExcelJsLibrary: async () => options.exceljs,
    Blob, Date,
    URL: { createObjectURL: blob => { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/receipt/email') && options.method === 'POST' && optionsForTest.failEmail) {
        return { ok: false, status: 502, json: async () => ({ error: 'Email provider failed.' }) };
      }
      const body = url.endsWith('/artworks')
        ? { artworks: [{ slug: 'print', title: 'Print', available: true, editionType: 'open', price: '10' }] }
        : url.includes('/sales?page=') && optionsForTest.exportSales
          ? {
            sales: optionsForTest.exportSales.slice(
              (Number(new URL(url).searchParams.get('page')) - 1) * Number(new URL(url).searchParams.get('per_page')),
              Number(new URL(url).searchParams.get('page')) * Number(new URL(url).searchParams.get('per_page'))
            ),
            total: optionsForTest.exportSales.length
          }
        : url.endsWith('/receipt/printed')
          ? { sale: { receipt_printed_at: '2026-11-11T00:00:00Z' } }
        : url.endsWith('/receipt/email')
          ? { ok: true }
        : options.method === 'POST'
          ? { sale: { sale_number: 'test-sale', artwork_slug: 'print', item_type: 'open_edition', buyer_name: 'Test buyer', buyer_email: 'buyer@example.com', price: 10, currency: 'GBP', status: 'active' }, artworkAvailable: true }
          : { sales: [], total: 0 };
      return { ok: true, status: 200, json: async () => body, text: async () => '<html>Receipt</html>' };
    },
  });
  vm.runInContext(await readFile('public/admin/sales.js', 'utf8'), context);
  return { window, elements, requests, downloads };
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

test('exports all pages as formatted Excel with real dates and cancelled styling', {
  skip: !process.env.SALES_TEST_SHEETJS || !process.env.SALES_TEST_EXCELJS,
}, async () => {
  const require = createRequire(import.meta.url);
  const xlsx = require(process.env.SALES_TEST_SHEETJS);
  const exceljs = require(process.env.SALES_TEST_EXCELJS);
  const exportSales = Array.from({ length: 101 }, (_, index) => ({
    sale_number: `SALE-${index}`, sale_date: '2026-11-11', artwork_slug: 'print',
    item_type: 'open_edition', open_edition_number: index + 1,
    buyer_name: 'Buyer', buyer_email: 'buyer@example.com', price: 12.5,
    currency: 'GBP', status: index === 100 ? 'cancelled' : 'active',
    notes: '', receipt_printed_at: '2026-11-11T12:30:00.000Z', receipt_emailed_at: null,
  }));
  const { window, elements, downloads, requests } = await salesContext('test-github-token', { xlsx, exceljs, exportSales });
  await window.VlementSales.open();
  const section = elements.get('modal').children.filter(child => child.tag === 'section')[1];
  await section.children[0].onclick();
  assert.ok(requests.some(request => request.url.includes('page=2&per_page=100')));
  const blob = downloads.find(item => item instanceof Blob);
  assert.ok(blob);
  const workbook = new exceljs.Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  const sheet = workbook.getWorksheet('Sales');
  assert.equal(sheet.rowCount, 102);
  assert.equal(sheet.getCell('B2').value.toISOString(), '2026-11-11T00:00:00.000Z');
  assert.equal(sheet.getCell('M2').value.toISOString(), '2026-11-11T12:30:00.000Z');
  assert.equal(sheet.getCell('I2').value, 12.5);
  assert.equal(sheet.getCell('I2').numFmt, '0.00');
  assert.equal(sheet.getCell('D2').value, 'Print');
  assert.equal(sheet.getCell('A1').font.bold, true);
  assert.equal(sheet.getCell('A102').font.strike, true);
  assert.equal(sheet.views[0].ySplit, 1);
  assert.match(downloads.find(item => typeof item === 'string'), /^vlement-sales-\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test('Sales does not send requests without a GitHub token', async () => {
  const { window, elements, requests } = await salesContext(null);
  await window.VlementSales.open();
  assert.equal(requests.length, 0);
  assert.equal(elements.get('modal').children[3].textContent, 'Sign in again before managing sales.');
});

test('Both opens the authenticated print dialog before emailing and preserves print success on email failure', async () => {
  const { window, elements, requests } = await salesContext('test-github-token', { failEmail: true });
  await window.VlementSales.open();
  elements.get('sales-buyer-name').value = 'Test buyer';
  const modal = elements.get('modal');
  const form = modal.children.find(child => child.tag === 'section').children[0];
  form.onsubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const actions = modal.children.find(child => child.className === 'modal-footer');
  await actions.children.find(child => child.textContent === 'Both').onclick();
  const calls = requests.map(request => request.url);
  const printIndex = calls.indexOf('print-dialog');
  const printedIndex = calls.findIndex(url => url.endsWith('/receipt/printed'));
  const emailIndex = calls.findIndex(url => url.endsWith('/receipt/email'));
  assert.ok(printIndex >= 0 && printedIndex > printIndex && emailIndex > printedIndex);
  const receipt = requests.find(request => request.url.includes('/receipt?'));
  assert.equal(receipt.options.headers.Authorization, 'Bearer test-github-token');
  assert.match(modal.children[2].textContent, /Print dialog opened\. Email provider failed\./);
});
