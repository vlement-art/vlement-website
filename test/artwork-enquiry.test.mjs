import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkEnquiryLink, enquiryDraft } from '../src/lib/artwork-enquiry.mjs';

function draft(data) {
  const url = new URL(artworkEnquiryLink(data, 'https://vlement.com/work/so-ar'), 'https://vlement.com');
  return enquiryDraft(url.searchParams);
}

test('prefills a private-code-free enquiry for an accented original', () => {
  const result = draft({ title: 'Dejar de Soñar & más', category: 'Original painting' });
  assert.equal(result.message, 'I would like to enquire about “Dejar de Soñar & más”.\nType: Original\nArtwork: https://vlement.com/work/so-ar\n\n');
  assert.equal(result.subject, 'Enquiry about “Dejar de Soñar & más”');
});

test('includes known print edition details without inventing unknown ones', () => {
  assert.match(draft({ title: 'Print', category: 'Print', editionType: 'limited', editionSize: 25 }).message, /Type: Print\nEdition: Limited edition of 25/);
  assert.match(draft({ title: 'Print', category: 'Print', editionType: 'open' }).message, /Edition: Open edition/);
  assert.doesNotMatch(draft({ title: 'Print', category: 'Print' }).message, /Edition:/);
});

test('leaves normal contact empty and preserves old enquiry links', () => {
  assert.equal(enquiryDraft(new URLSearchParams()), null);
  assert.equal(enquiryDraft(new URLSearchParams({ piece: 'Old work' })).message, 'I would like to enquire about “Old work”.\n\n');
  assert.equal(enquiryDraft(new URLSearchParams({ title: 'Old title' })).subject, 'Enquiry about “Old title”');
});
