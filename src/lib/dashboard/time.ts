// A 24-hour "HH:MM" check shared by the Dashboard settings. Pure.
export const validTimeText = (time: string): boolean =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
