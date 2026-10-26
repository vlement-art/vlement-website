let excelJsLibraryPromise = null;

function ensureExcelJsLibrary() {
  if (window.ExcelJS?.Workbook) return Promise.resolve(window.ExcelJS);
  if (!excelJsLibraryPromise) {
    excelJsLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('/admin/exceljs.min.js', location.origin).href;
      script.onload = () => {
        if (window.ExcelJS?.Workbook) {
          resolve(window.ExcelJS);
        } else {
          reject(new Error('ExcelJS loaded but its workbook API is unavailable. Refresh the page and try again.'));
        }
      };
      script.onerror = () => {
        reject(new Error(`Could not load the Excel export library from ${script.src}. Refresh the page and try again.`));
      };
      document.head.appendChild(script);
    }).catch(err => {
      excelJsLibraryPromise = null;
      throw err;
    });
  }
  return excelJsLibraryPromise;
}

function excelValue(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function imageFilename(path) {
  return String(path || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

function thumbnailAsPng(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error(`Thumbnail has no readable dimensions: ${path}`));
        return;
      }
      const maxEdge = 180;
      const scale = Math.min(1, maxEdge / image.naturalWidth, maxEdge / image.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('The browser could not prepare a thumbnail for the Excel backup.'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    image.onerror = () => reject(new Error(`Could not load thumbnail: ${path}`));
    image.src = new URL(path, location.origin).href;
  });
}

window.exportArtworksExcel = async function exportArtworksExcel() {
  const btn = document.getElementById('export-xlsx-btn');
  if (!btn) throw new Error('The Excel export button is unavailable.');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Building Excel…';

  try {
    const ExcelJS = await ensureExcelJsLibrary();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Vlement Art';
    workbook.created = new Date();

    const knownKeys = new Set([
      'title', 'year', 'medium', 'dimensions', 'category', 'collection',
      'summary', 'image', 'thumbnail', 'altText', 'featured', 'available',
      'price', 'displayOrder', 'width', 'height'
    ]);
    const extraKeys = [...new Set(entries.flatMap(entry => Object.keys(entry.data || {})))]
      .filter(key => !knownKeys.has(key));
    const columns = [
      { header: 'Artwork ID', key: 'slug', width: 30 },
      { header: 'Title', key: 'title', width: 28 },
      { header: 'Year', key: 'year', width: 10 },
      { header: 'Medium', key: 'medium', width: 30 },
      { header: 'Measurements (with units)', key: 'dimensions', width: 30 },
      { header: 'Image width (pixels)', key: 'width', width: 18 },
      { header: 'Image height (pixels)', key: 'height', width: 18 },
      { header: 'Short description', key: 'summary', width: 48 },
      { header: 'Full description (Markdown)', key: 'body', width: 60 },
      { header: 'Category', key: 'category', width: 24 },
      { header: 'Collection', key: 'collection', width: 24 },
      { header: 'Image filename', key: 'imageFilename', width: 32 },
      { header: 'Image path / URL', key: 'image', width: 46 },
      { header: 'Thumbnail filename', key: 'thumbnailFilename', width: 32 },
      { header: 'Thumbnail path / URL', key: 'thumbnail', width: 46 },
      { header: 'Embedded thumbnail', key: 'embeddedThumbnail', width: 20 },
      { header: 'Public artwork page URL', key: 'pageUrl', width: 46 },
      { header: 'Featured on homepage', key: 'featured', width: 20 },
      { header: 'Available for sale', key: 'available', width: 18 },
      { header: 'Homepage hero', key: 'isHero', width: 16 },
      { header: 'Hero image path / URL', key: 'heroImage', width: 46 },
      { header: 'Alt text', key: 'altText', width: 55 },
      { header: 'Price', key: 'price', width: 18 },
      { header: 'Display order', key: 'displayOrder', width: 15 },
      ...extraKeys.map(key => ({ header: `Additional metadata: ${key}`, key: `metadata:${key}`, width: 32 })),
      { header: 'Raw frontmatter JSON', key: 'rawFrontmatter', width: 60 }
    ];
    const worksheet = workbook.addWorksheet('Artworks');
    worksheet.columns = columns;
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.getRow(1).height = 30;
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C1A17' } };
    worksheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };

    const heroEntry = entries.find(entry => entry.slug === homepageSettings.heroSlug);
    const heroImage = heroEntry
      ? (homepageSettings.heroImageField === 'thumbnail' ? heroEntry.data.thumbnail : heroEntry.data.image)
      : '';
    for (const entry of entries) {
      const d = entry.data || {};
      const isHero = entry.slug === homepageSettings.heroSlug;
      const row = {
        slug: entry.slug,
        title: excelValue(d.title),
        year: excelValue(d.year),
        medium: excelValue(d.medium),
        dimensions: excelValue(d.dimensions),
        width: excelValue(d.width),
        height: excelValue(d.height),
        summary: excelValue(d.summary),
        body: entry.body || '',
        category: excelValue(d.category),
        collection: excelValue(d.collection),
        imageFilename: imageFilename(d.image),
        image: excelValue(d.image),
        thumbnailFilename: imageFilename(d.thumbnail),
        thumbnail: excelValue(d.thumbnail),
        embeddedThumbnail: '',
        pageUrl: new URL(`/work/${encodeURIComponent(entry.slug)}/`, 'https://vlement.com').href,
        featured: !!d.featured,
        available: d.available !== false,
        isHero,
        heroImage: isHero ? heroImage : '',
        altText: excelValue(d.altText),
        price: excelValue(d.price),
        displayOrder: excelValue(d.displayOrder),
        rawFrontmatter: JSON.stringify(d, null, 2)
      };
      for (const key of extraKeys) row[`metadata:${key}`] = excelValue(d[key]);
      const excelRow = worksheet.addRow(row);
      excelRow.height = 88;
      excelRow.alignment = { vertical: 'top', wrapText: true };
    }

    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: entries.length + 1, column: columns.length }
    };

    const imageColumn = columns.findIndex(column => column.key === 'embeddedThumbnail');
    const imageFailures = [];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (!entry.data.thumbnail) continue;
      try {
        const base64 = await thumbnailAsPng(entry.data.thumbnail);
        const imageId = workbook.addImage({ base64, extension: 'png' });
        worksheet.addImage(imageId, {
          tl: { col: imageColumn, row: index + 1 },
          br: { col: imageColumn + 1, row: index + 2 }
        });
      } catch (err) {
        imageFailures.push(`${entry.slug}: ${err.message}`);
        console.warn(`Excel backup: thumbnail not embedded for ${entry.slug}.`, err);
      }
    }

    const notes = workbook.addWorksheet('Backup notes');
    notes.columns = [{ width: 28 }, { width: 100 }];
    notes.addRows([
      ['Vlement artwork backup'],
      ['Exported', new Date().toISOString()],
      ['Artwork records', entries.length],
      ['Thumbnail images', 'Embedded as reduced-size PNG previews where readable; image and thumbnail paths are retained on the Artworks sheet.'],
      ['Full-size artwork files', 'Full-resolution files are not embedded. Back them up separately from the repository paths listed on the Artworks sheet.'],
      ['Additional metadata', 'Unrecognized fields are included in separate columns and in Raw frontmatter JSON.'],
      ['Image embedding warnings', imageFailures.length ? imageFailures.join('\n') : 'None']
    ]);
    notes.getColumn(1).font = { bold: true };
    notes.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `vlement-artworks-${new Date().toISOString().slice(0, 10)}.xlsx`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showBanner(
      `Excel backup downloaded with ${entries.length} artwork record${entries.length === 1 ? '' : 's'}${imageFailures.length ? `; ${imageFailures.length} thumbnail${imageFailures.length === 1 ? '' : 's'} could not be embedded, but their paths are included` : ' and embedded thumbnails'}.`,
      imageFailures.length ? 'error' : 'info'
    );
  } catch (err) {
    console.error(err);
    showBanner('Failed to create Excel backup: ' + escapeHtml(err.message), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};
