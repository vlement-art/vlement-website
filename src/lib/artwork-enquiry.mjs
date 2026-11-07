export function artworkEnquiryLink(data, pageURL) {
  const params = new URLSearchParams({ artwork: data.title, url: pageURL });
  const isPrint = data.editionType === 'limited' || data.editionType === 'open' ||
    data.category.toLowerCase() === 'print';
  const type = isPrint ? 'Print' :
    data.editionType === 'original' || data.category.toLowerCase() === 'original painting'
      ? 'Original' : data.category;
  params.set('type', type);
  if (isPrint && data.editionType === 'limited') {
    params.set('edition', data.editionSize ? `Limited edition of ${data.editionSize}` : 'Limited edition');
  } else if (isPrint && data.editionType === 'open') {
    params.set('edition', 'Open edition');
  } else if (isPrint && data.editionSize) {
    params.set('edition', `Edition of ${data.editionSize}`);
  }
  return `/contact?${params.toString()}`;
}

export function enquiryDraft(params) {
  const artwork = params.get('artwork');
  if (!artwork) {
    const piece = params.get('piece') || params.get('title');
    return piece ? { message: `I would like to enquire about “${piece}”.\n\n`, subject: `Enquiry about “${piece}”` } : null;
  }
  const lines = [`I would like to enquire about “${artwork}”.`];
  if (params.get('type')) lines.push(`Type: ${params.get('type')}`);
  if (params.get('edition')) lines.push(`Edition: ${params.get('edition')}`);
  if (params.get('url')) lines.push(`Artwork: ${params.get('url')}`);
  return { message: `${lines.join('\n')}\n\n`, subject: `Enquiry about “${artwork}”` };
}
