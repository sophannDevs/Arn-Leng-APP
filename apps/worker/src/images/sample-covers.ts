import sharp from 'sharp';

const escapeXml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const hashOf = (text: string) =>
  [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);

/** Splits a title into lines of at most `max` characters, on spaces. */
function wrap(title: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of title.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= max)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** A made-up series cover (600 x 800): a colorful scene with the title across the top. Development data only. */
export async function makeSampleCover(input: { title: string; slug: string }): Promise<Buffer> {
  const width = 600;
  const height = 800;
  const hue = hashOf(input.slug) % 360;
  const lines = wrap(input.title.toUpperCase(), 12).slice(0, 3);
  const text = lines
    .map(
      (line, i) =>
        `<text x="36" y="${96 + i * 92}" font-family="sans-serif" font-size="84" font-weight="900" fill="#ffd60a" stroke="#111" stroke-width="6" paint-order="stroke">${escapeXml(line)}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 75% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 70% 38%)"/></linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <circle cx="${width * 0.72}" cy="${height * 0.52}" r="120" fill="hsl(${(hue + 40) % 360} 95% 65%)" stroke="#111" stroke-width="6"/>
    <polygon points="0,${height} ${width * 0.42},${height * 0.58} ${width * 0.9},${height}" fill="hsl(${(hue + 200) % 360} 55% 30%)" stroke="#111" stroke-width="6"/>
    <polygon points="${width * 0.45},${height} ${width * 0.8},${height * 0.7} ${width},${height}" fill="hsl(${(hue + 180) % 360} 60% 22%)" stroke="#111" stroke-width="6"/>
    ${text}
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}
