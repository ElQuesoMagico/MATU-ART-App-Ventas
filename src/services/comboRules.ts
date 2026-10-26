import { CatalogError } from './catalogValidation.ts'
import { applyManualDiscount, calculateSalePricing } from './discountRules.ts'
import { chileDay, promotionMatches, promotionGroups, groupMatches, validatePromotion, MAX_ACTIVE_PROMOTIONS } from './promotionConditions.ts'
import type { PromotionLine } from './promotionRules.ts'
import type { ManualDiscount } from '../types/discounts.ts'
import type { Promotion, AppliedPromotion, AppliedCombo } from '../types/promotions.ts'
export const COMBO_LIMITS = { eligibleUnits: 24, placements: 128, searchSteps: 20000 } as const
const compare = (a: string,b: string) => a === b ? 0 : a < b ? -1 : 1
interface Unit { line: number; quantity: number; original: number; balance: number; ordinal: number }
export function calculateComboPricing(lines: PromotionLine[], promotions: Promotion[], generalDiscount: ManualDiscount | undefined, now: string) {
  const manual = calculateSalePricing(lines)
  if (new Set(lines.map(l=>l.productId)).size !== lines.length || new Set(promotions.map(p=>p.id)).size !== promotions.length) throw new CatalogError('Identificadores repetidos.')
  const active = promotions.filter(p=>p.isActive && !p.isArchived)
  if (active.length > MAX_ACTIVE_PROMOTIONS) throw new CatalogError('Máximo 12 promociones activas, incluidos combos.')
  const day = chileDay(now)
  const valid = active.filter(p=>(!p.startDate || p.startDate<=day) && (!p.endDate || p.endDate>=day)).sort((a,b)=>compare(a.id,b.id))
  valid.forEach(validatePromotion)
  const combos = valid.filter(p=>(p.type === 'combo' || p.type === 'quantity') && (p.type !== 'quantity' || (lines.filter(l=>promotionMatches(l,p)).reduce((s,l)=>s+l.quantity,0)>=p.minimumQuantity && lines.filter(l=>promotionMatches(l,p)).reduce((s,l)=>s+l.quantity*l.unitPrice,0)>=p.minimumAmount)))
  const discounts = valid.filter(p=>p.type !== 'combo' && p.type !== 'quantity')
  const relevant = lines.map(line=>combos.some(p=>promotionGroups(p).some(c=>groupMatches(line,c,p))))
  const quantity = lines.reduce((sum,line,index)=>sum+(relevant[index]?BigInt(line.quantity):0n),0n)
  if (quantity > BigInt(COMBO_LIMITS.eligibleUnits)) throw new CatalogError('Límite exacto de combos: hasta 24 unidades elegibles. Reduce cantidades o desactiva combos; no se calculó un resultado aproximado.')
  const units: Unit[] = []
  lines.map((_,index)=>index).sort((a,b)=>compare(lines[a].productId,lines[b].productId)).forEach(index=>{
    const line=lines[index], net=manual.lines[index].netAmount
    if (relevant[index]) {
      const low=Number(BigInt(net)/BigInt(line.quantity)), extra=Number(BigInt(net)%BigInt(line.quantity))
      for(let ordinal=0;ordinal<line.quantity;ordinal++) units.push({line:index,quantity:1,original:line.unitPrice,balance:low+(ordinal<extra?1:0),ordinal})
    } else units.push({line:index,quantity:line.quantity,original:manual.lines[index].originalAmount,balance:net,ordinal:0})
  })
  let steps=0
  function tick() { if (++steps>COMBO_LIMITS.searchSteps) throw new CatalogError('Límite exacto de combos: más de 20.000 pasos de búsqueda. Reduce reglas o cantidades; no se aplicó una aproximación.') }
  function allocate(amount: number, ids: number[], balances: number[]) {
    const groups=new Map<number,number[]>()
    for(const index of ids) groups.set(units[index].line,[...(groups.get(units[index].line)??[]),index])
    const base=ids.reduce((sum,index)=>sum+BigInt(balances[index]),0n)
    const rows=[...groups].map(([line,indices])=>{ const weight=indices.reduce((sum,i)=>sum+BigInt(balances[i]),0n); return {line,indices,weight,amount:Number(BigInt(amount)*weight/base),remainder:BigInt(amount)*weight%base} })
    rows.sort((a,b)=>a.remainder===b.remainder?compare(lines[a.line].productId,lines[b.line].productId):a.remainder>b.remainder?-1:1)
    let left=amount-rows.reduce((sum,row)=>sum+row.amount,0)
    for(const row of rows) if(left>0) { row.amount++; left-- }
    const result: {index:number;amount:number}[]=[]
    for(const row of rows) {
      if(!row.amount || !row.weight) continue
      const portions=row.indices.map(index=>({index,amount:Number(BigInt(row.amount)*BigInt(balances[index])/row.weight),remainder:BigInt(row.amount)*BigInt(balances[index])%row.weight}))
      portions.sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1)
      let remainder=row.amount-portions.reduce((sum,p)=>sum+p.amount,0)
      for(const p of portions) if(remainder>0) {p.amount++;remainder--}
      result.push(...portions.map(({index,amount})=>({index,amount})))
    }
    return result
  }
  function products(ids: number[], allocation: {index:number;amount:number}[]) {
    const result=new Map<string,{productId:string;quantity:number;originalAmount:number;amount:number}>()
    for(const index of ids) {
      const unit=units[index], id=lines[unit.line].productId
      const row=result.get(id)??{productId:id,quantity:0,originalAmount:0,amount:0}
      row.quantity+=unit.quantity; row.originalAmount+=unit.original
      row.amount+=allocation.find(p=>p.index===index)?.amount??0;result.set(id,row)
    }
    return [...result.values()].sort((a,b)=>compare(a.productId,b.productId))
  }
  function placements(promotion: Promotion,used: Set<number>) {
    const results=new Map<string,number[]>()
    function component(position: number,selected: number[]) {
      tick()
      if(position===promotionGroups(promotion).length) {
        const ids=[...selected].sort((a,b)=>a-b)
        const gross=ids.reduce((sum,i)=>sum+units[i].original,0), net=ids.reduce((sum,i)=>sum+units[i].balance,0)
        if(gross<=promotion.value || net<=promotion.value) return
        results.set(ids.join(','),ids)
        if(results.size>COMBO_LIMITS.placements) throw new CatalogError('Límite exacto de combos: más de 128 asignaciones distintas. Reduce categorías/componentes o desactiva el combo.')
        return
      }
      const c=promotionGroups(promotion)[position]
      // Mismo SKU/saldo: mismas condiciones y ahorro. Elegir los primeros
      // ordinales evita permutaciones equivalentes, sin podar soluciones distintas.
      const groups=new Map<string,number[]>()
      units.forEach((unit,index)=>{
        if(!used.has(index) && !selected.includes(index) && relevant[unit.line] && groupMatches(lines[unit.line],c,promotion)) {
          const key=`${lines[unit.line].productId}|${unit.balance}`
          groups.set(key,[...(groups.get(key)??[]),index])
        }
      })
      const rows=[...groups.values()]
      function choose(group: number,needed: number,chosen: number[]) {
        tick()
        if(!needed) {component(position+1,[...selected,...chosen]);return}
        if(group===rows.length || rows.slice(group).reduce((sum,g)=>sum+g.length,0)<needed) return
        for(let count=0;count<=Math.min(needed,rows[group].length);count++) choose(group+1,needed-count,[...chosen,...rows[group].slice(0,count)])
      }
      choose(0,c.quantity,[])
    }
    component(0,[])
    return [...results.values()].sort((a,b)=>compare(a.join(','),b.join(',')))
  }
  type Occurrence={promotion:Promotion;ids:number[]}
  let best: {balances:number[];promotions:AppliedPromotion[];combos:AppliedCombo[];general:ReturnType<typeof applyManualDiscount>;total:number;key:string;benefits:number}|undefined
  function evaluate(occurrences:Occurrence[]) {
    const balances=units.map(u=>u.balance),owners=new Map<number,Promotion>()
    const appliedCombos=new Map<string,AppliedCombo>()
    for(const occurrence of occurrences) {
      const {promotion,ids}=occurrence
      const base=ids.reduce((sum,i)=>sum+balances[i],0), gross=ids.reduce((sum,i)=>sum+units[i].original,0)
      const amount=base-promotion.value
      const allocation=allocate(amount,ids,balances)
      for(const portion of allocation) balances[portion.index]-=portion.amount
      ids.forEach(i=>owners.set(i,promotion))
      const usedProducts=products(ids,allocation)
      const item=appliedCombos.get(promotion.id)??{id:promotion.id,name:promotion.name,price:promotion.value,applications:0,originalAmount:0,amount:0,configuration:promotion,products:[],occurrences:[]}
      item.applications++;item.originalAmount+=gross;item.amount+=amount
      item.occurrences.push({originalAmount:gross,baseAmount:base,amount,products:usedProducts})
      for(const row of usedProducts) {
        const previous=item.products.find(p=>p.productId===row.productId)
        if(previous) { previous.quantity+=row.quantity;previous.originalAmount+=row.originalAmount;previous.amount+=row.amount } else item.products.push({...row})
      }
      item.products.sort((a,b)=>compare(a.productId,b.productId));appliedCombos.set(item.id,item)
    }
    const candidates=discounts.map(p=>{
      const ids=units.flatMap((unit,index)=>promotionMatches(lines[unit.line],p) && (!owners.has(index) || (owners.get(index)!.isStackable && p.isStackable))?[index]:[])
      return {promotion:p,ids,valid:ids.length>0 && ids.reduce((sum,i)=>sum+BigInt(units[i].quantity),0n)>=BigInt(p.minimumQuantity) && ids.reduce((sum,i)=>sum+BigInt(units[i].original),0n)>=BigInt(p.minimumAmount)}
    }).filter(p=>p.valid)
    function traditional(index:number,selected:number[]) {
      tick()
      if(index<candidates.length) {
        traditional(index+1,selected)
        const current=candidates[index]
        if(selected.every(other=>(current.promotion.isStackable&&candidates[other].promotion.isStackable)||!current.ids.some(i=>candidates[other].ids.includes(i)))) traditional(index+1,[...selected,index])
        return
      }
      const final=[...balances],applied:AppliedPromotion[]=[]
      for(const index of selected) {
        const {promotion,ids}=candidates[index],base=ids.reduce((sum,i)=>sum+final[i],0)
        if(!base) continue
        const amount=applyManualDiscount(base,{type:promotion.type==='percentage'?'percentage':'fixed',value:promotion.type==='fixed'?Math.min(base,promotion.value):promotion.value})!.amount
        if(!amount) continue
        const allocation=allocate(amount,ids,final)
        allocation.forEach(p=>{final[p.index]-=p.amount})
        applied.push({id:promotion.id,name:promotion.name,type:promotion.type,value:promotion.value,amount,configuration:promotion,products:products(ids,allocation).filter(p=>p.amount>0)})
      }
      const remaining=final.reduce((sum,n)=>sum+n,0)
      let general:ReturnType<typeof applyManualDiscount>
      try {general=applyManualDiscount(remaining,generalDiscount)}catch{return}
      const total=remaining-(general?.amount??0),comboSnapshots=[...appliedCombos.values()]
      const key=occurrences.map(o=>`${o.promotion.id}:${o.ids.join(',')}`).join('|')+';'+applied.map(p=>p.id).join('|')
      const benefits=occurrences.length+applied.length
      if(!best || total<best.total || (total===best.total&&(benefits<best.benefits || (benefits===best.benefits&&key<best.key)))) best={balances:final,promotions:applied,combos:comboSnapshots,general,total,key,benefits}
    }
    traditional(0,[])
  }
  function search(start:number,used:Set<number>,occurrences:Occurrence[]) {
    // Evaluar también detenerse aquí: otra promoción puede superar el combo.
    // used impide reutilizar unidades incluso entre combos acumulables.
    tick();evaluate(occurrences)
    for(let index=start;index<combos.length;index++) for(const ids of placements(combos[index],used)) search(index,new Set([...used,...ids]),[...occurrences,{promotion:combos[index],ids}])
  }
  search(0,new Set(),[])
  if(!best) {applyManualDiscount(manual.remainingSubtotal,generalDiscount);throw new CatalogError('No hay una combinación válida.')}
  const chosen=best as NonNullable<typeof best>
  const netLines=lines.map((_,index)=>units.reduce((sum,unit,i)=>sum+(unit.line===index?chosen.balances[i]:0),0))
  return {lines:manual.lines.map((line,index)=>({...line,netAmount:netLines[index],promotionDiscount:line.netAmount-netLines[index]})),subtotal:manual.subtotal,remainingSubtotal:chosen.balances.reduce((a,b)=>a+b,0),appliedGeneralDiscount:chosen.general,promotions:structuredClone(chosen.promotions),combos:structuredClone(chosen.combos),automaticDiscount:chosen.promotions.reduce((sum,p)=>sum+p.amount,0)+chosen.combos.reduce((sum,c)=>sum+c.amount,0),discount:manual.subtotal-chosen.total,total:chosen.total}
}
