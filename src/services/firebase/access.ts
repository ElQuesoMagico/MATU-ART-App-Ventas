export type FirebaseRole = 'administrator' | 'manager' | 'seller'
export interface VerifiedAccess { role: FirebaseRole; workspaceName: string; verifiedAt: string }
export function parseAccess(member: unknown, workspace: unknown): VerifiedAccess {
  if (!member || typeof member !== 'object' || !('enabled' in member) || member.enabled !== true || !('role' in member) || !['administrator', 'manager', 'seller'].includes(String(member.role))) throw new Error('Tu cuenta no tiene una membresía activa en este espacio.')
  if (!workspace || typeof workspace !== 'object' || !('schemaVersion' in workspace) || workspace.schemaVersion !== 1 || !('name' in workspace) || typeof workspace.name !== 'string' || !workspace.name.trim()) throw new Error('El espacio de trabajo no tiene el formato esperado.')
  return { role: member.role as FirebaseRole, workspaceName: workspace.name, verifiedAt: new Date().toISOString() }
}
export function firebaseMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-email', 'auth/user-disabled'].includes(code)) return 'No se pudo iniciar sesión. Revisa el correo y la contraseña.'
  if (code === 'auth/too-many-requests') return 'Demasiados intentos. Espera antes de volver a intentarlo.'
  if (code === 'permission-denied') return 'No tienes acceso. Revisa la membresía y las reglas publicadas en Firebase.'
  if (['unavailable', 'auth/network-request-failed'].includes(code)) return 'No se pudo conectar con Firebase. Tus datos locales siguen disponibles.'
  if (code) return 'Firebase no pudo completar la solicitud. Revisa la configuración o vuelve a intentarlo.'
  return error instanceof Error ? error.message : 'No se pudo completar la solicitud.'
}
