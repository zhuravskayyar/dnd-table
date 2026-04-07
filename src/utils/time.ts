export function formatClockTime(value: string) {
  return new Date(value).toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
