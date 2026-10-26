export function modalDismissal(busy: boolean, dirty: boolean, protectChanges: boolean): 'blocked' | 'confirm' | 'close' {
  return busy ? 'blocked' : dirty && protectChanges ? 'confirm' : 'close'
}
