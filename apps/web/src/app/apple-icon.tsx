// Home-screen icon (iOS): the logo mark from ./icon.svg as a 180px PNG.
import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <svg width={180} height={180} viewBox="0 0 24 24">
      <rect width={24} height={24} fill="#1c2321" />
      <path d="M1 6V1h5M18 1h5v5" stroke="#ff4fb4" strokeWidth={1.5} fill="none" />
      <circle cx={12} cy={13} r={8} fill="#f4efe2" />
      <path
        d="M8.4 10.4 10.8 12.8 8.4 15.2M12.6 15.6h3.6"
        stroke="#121614"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>,
    size,
  );
}
