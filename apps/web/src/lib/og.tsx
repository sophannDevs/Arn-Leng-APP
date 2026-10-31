import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 } as const;

/**
 * A 1200 x 630 social preview in the Inkline style. Text only, so it works for every series with
 * no image processing (the card builder can't read AVIF or WebP covers anyway).
 */
export function ogImage(input: { title: string; subtitle?: string; tag?: string }) {
  const size = input.title.length > 40 ? 76 : input.title.length > 24 ? 96 : 120;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 64,
        background: '#efebe5',
        color: '#111',
        border: '14px solid #111',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div
          style={{
            display: 'flex',
            background: '#d91e1e',
            color: '#fff',
            fontSize: 40,
            fontWeight: 800,
            letterSpacing: 4,
            padding: '8px 24px',
            border: '4px solid #111',
            borderRadius: 14,
          }}
        >
          INKLINE
        </div>
        {input.tag ? (
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, color: '#4a4a4a' }}>
            {input.tag}
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            display: 'flex',
            fontSize: size,
            fontWeight: 800,
            lineHeight: 1.02,
            letterSpacing: -2,
          }}
        >
          {input.title}
        </div>
        {input.subtitle ? (
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 600, color: '#4a4a4a' }}>
            {input.subtitle}
          </div>
        ) : null}
      </div>
      <div
        style={{ display: 'flex', height: 14, background: '#ffd60a', border: '4px solid #111' }}
      />
    </div>,
    OG_SIZE,
  );
}
