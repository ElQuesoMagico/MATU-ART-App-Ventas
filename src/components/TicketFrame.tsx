import { useLayoutEffect, useRef, useState } from 'react'
import { ticketPath } from '../services/ticketGeometry'
export function TicketFrame({axis='sides',notch=10}:{axis?:'sides'|'ends';notch?:number}) {
  const ref=useRef<SVGSVGElement>(null),[size,setSize]=useState({width:300,height:200})
  useLayoutEffect(()=>{const parent=ref.current?.parentElement;if(!parent)return;const measure=()=>setSize({width:parent.clientWidth,height:parent.clientHeight});const observer=new ResizeObserver(measure);observer.observe(parent);measure();return()=>observer.disconnect()},[])
  return <svg ref={ref} className="ticket-frame" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={ticketPath(size.width,size.height,axis,notch)} /></svg>
}
