// Times as Owner reads them, in UTC like the run they come from.

/** "20 Nov, 19:10" */
export const dayAndTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

/** "19:10" */
export const timeOfDay = (iso: string) => iso.slice(11, 16)
