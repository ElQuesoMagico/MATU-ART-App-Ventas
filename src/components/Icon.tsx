export type IconName = 'home' | 'bag' | 'box' | 'clock' | 'tent' | 'search' | 'arrow' | 'sparkle' | 'plus' | 'minus' | 'close'
const paths: Record<IconName, string> = {
  home: 'M4 11h16v10H4V11Zm-1-1 3-6h12l3 6M3 10q2 4 4 0 2 4 5 0 3 4 5 0 2 4 4 0M9 21v-6h6v6M10 4v6m4-6v6', bag: 'M5 8q7 2 14 0l1 12q-8 3-16 0L5 8Zm3 0V6a4 4 0 0 1 8 0v2M9 14h6m-3-3v6',
  box: 'M3 9h18v4H3V9Zm2 4v8h14v-8M12 9v12m0-12q-9-1-6-5 3-3 6 5Zm0 0q9-1 6-5-3-3-6 5Z', clock: 'M10 2h4M12 2v3M12 9v5l3 2M21 14a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  tent: 'M2 20h20M3 20 12 7l9 13M12 7V2l5 2-5 2M9 20l3-7 3 7', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6', sparkle: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', close: 'm6 6 12 12M6 18 18 6',
}
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
