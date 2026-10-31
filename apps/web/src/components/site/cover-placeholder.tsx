/** A cover for a series that has none yet: a color picked from its address, with its title in comic lettering. */
export function CoverPlaceholder({ title, slug }: { title: string; slug: string }) {
  const hue = [...slug].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) % 360;
  return (
    <span
      className="absolute inset-0 block"
      style={{
        background: `linear-gradient(160deg, hsl(${hue} 70% 62%), hsl(${(hue + 40) % 360} 65% 42%))`,
      }}
    >
      <span className="absolute inset-x-2.5 top-2 block font-comic text-[clamp(22px,4vw,34px)] leading-[0.95] tracking-wide text-pop [text-shadow:2px_2px_0_var(--color-ink)]">
        {title}
      </span>
    </span>
  );
}
