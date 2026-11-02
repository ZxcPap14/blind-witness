// Лицо игрока: картинка не больше 200 КБ. SVG не принимаем — он умеет исполнять скрипты.
export const AVATAR_LIMIT = 200 * 1024;

const starts = (bytes, ...signature) => signature.every((value, index) => bytes[index] === value);

// Тип определяем по первым байтам, а не по заголовку запроса: заголовку верить нельзя.
export function sniffImage(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (starts(bytes, 0x89, 0x50, 0x4e, 0x47)) return { mime: "image/png" };
  if (starts(bytes, 0xff, 0xd8, 0xff)) return { mime: "image/jpeg" };
  const webp = starts(bytes, 0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (webp) return { mime: "image/webp" };
  return null;
}

// Ключ аккаунта: SQLite NOCASE не знает кириллицы, поэтому сравниваем нормализованное имя.
export const nameKey = (name) => String(name ?? "").trim().toLowerCase();
