/** Pixel-space SVG outline. Concave arcs use the same stroke as the outside edge. */
export function ticketPath(width:number,height:number,axis:'sides'|'ends'='sides',notch=10) {
  const x=.75,y=.75,w=Math.max(40,width)-.75,h=Math.max(40,height)-.75,r=9,cx=(x+w)/2,cy=(y+h)/2,n=notch
  return `M${x+r},${y} ${axis==='ends'?`H${cx-n} A${n},${n} 0 0 0 ${cx+n},${y}`:''} H${w-r} Q${w},${y} ${w},${y+r} ${axis==='sides'?`V${cy-n} A${n},${n} 0 0 0 ${w},${cy+n}`:''} V${h-r} Q${w},${h} ${w-r},${h} ${axis==='ends'?`H${cx+n} A${n},${n} 0 0 0 ${cx-n},${h}`:''} H${x+r} Q${x},${h} ${x},${h-r} ${axis==='sides'?`V${cy+n} A${n},${n} 0 0 0 ${x},${cy-n}`:''} V${y+r} Q${x},${y} ${x+r},${y} Z`
}
