export const money = (value: number | bigint) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value)
export const currentDateLabel = () => new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' }).format(new Date())
export const dateLabel = (date: string) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' }).format(new Date(`${date}T12:00:00-03:00`))
export const timeLabel = (date: string) => new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' }).format(new Date(date))
const santiagoCalendar = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Santiago' })
export const santiagoDay = (date: string) => {
  const parts = santiagoCalendar.formatToParts(new Date(date))
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
}
export const dateTimeLabel = (date: string) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(date))

export const marginLabel = (margin?: number) => margin === undefined ? 'No disponible' : margin.toLocaleString('es-CL', { maximumFractionDigits: 2 }) + ' %'
