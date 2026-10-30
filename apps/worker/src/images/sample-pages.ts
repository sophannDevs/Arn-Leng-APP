import sharp from 'sharp';

const escapeXml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** A stable number from text, so the same episode always gets the same colors. */
const hashOf = (text: string) =>
  [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);

/**
 * A made-up comic page: stacked panels with a simple scene each and a caption. For development
 * data only (pnpm seed:images): it lets the whole image pipeline run on realistic, tall pages.
 */
export async function makeSamplePage(input: {
  seriesTitle: string;
  episodeNumber: number;
  page: number;
  pages: number;
  width: number;
  height: number;
}): Promise<Buffer> {
  const { width, height } = input;
  const seed = hashOf(`${input.seriesTitle}:${input.episodeNumber}`);
  const hue = seed % 360;
  const gutter = 28;
  const panelHeight = Math.round(width * 0.9);
  const panels = Math.max(1, Math.floor((height - gutter) / (panelHeight + gutter)));
  const fitted = Math.floor((height - gutter * (panels + 1)) / panels);

  const shapes: string[] = [];
  for (let i = 0; i < panels; i++) {
    const top = gutter + i * (fitted + gutter);
    const left = gutter;
    const panelWidth = width - gutter * 2;
    const shade = (hue + i * 47 + input.page * 23) % 360;
    shapes.push(
      `<rect x="${left}" y="${top}" width="${panelWidth}" height="${fitted}" fill="hsl(${shade} 70% 82%)" stroke="#111" stroke-width="6"/>`,
      `<circle cx="${left + panelWidth * 0.78}" cy="${top + fitted * 0.25}" r="${fitted * 0.12}" fill="hsl(${(shade + 40) % 360} 90% 60%)" stroke="#111" stroke-width="4"/>`,
      `<polygon points="${left},${top + fitted} ${left + panelWidth * 0.35},${top + fitted * 0.55} ${left + panelWidth * 0.7},${top + fitted} " fill="hsl(${(shade + 200) % 360} 55% 45%)" stroke="#111" stroke-width="4"/>`,
      `<ellipse cx="${left + panelWidth * 0.3}" cy="${top + fitted * 0.22}" rx="${panelWidth * 0.2}" ry="${fitted * 0.1}" fill="#fff" stroke="#111" stroke-width="4"/>`,
      `<text x="${left + panelWidth * 0.3}" y="${top + fitted * 0.245}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(fitted * 0.07)}" font-weight="700" fill="#111">${escapeXml(`${i + 1}/${panels}`)}</text>`,
    );
  }
  const caption = `${input.seriesTitle} · Episode ${input.episodeNumber} · Page ${input.page}/${input.pages}`;
  shapes.push(
    `<text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#555">${escapeXml(caption)}</text>`,
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#efebe5"/>${shapes.join('')}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}
