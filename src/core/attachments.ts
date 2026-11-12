/**
 * Вложения комментариев: только растровые картинки и видео.
 *
 * SVG и произвольные файлы не принимаются: платформа рендерит их у получателя,
 * а SVG/HTML — исполняемое содержимое. Тип проверяется и по расширению, и по
 * сигнатуре файла, чтобы загрузка не зависела от клиентского MIME.
 */

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type AttachmentKind = 'image' | 'video';

export interface AttachmentSpec {
    /** Имя для показа; без каталогов и управляющих символов. */
    name: string;
    contentType: string;
    extension: string;
    kind: AttachmentKind;
}

const MIME_BY_EXTENSION: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.ogv': 'video/ogg',
    '.ogg': 'video/ogg',
    '.mov': 'video/quicktime',
};

export function extensionOf(name: string): string {
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index).toLowerCase() : '';
}

/** Разбирает имя и MIME; null — тип не разрешён. */
export function attachmentSpec(name: string, contentType = ''): AttachmentSpec | null {
    if (/[/\\]/.test(name)) return null;
    const base = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!base || base.length > 240) return null;
    const extension = extensionOf(base);
    const expected = MIME_BY_EXTENSION[extension];
    if (!expected) return null;
    const provided = normalizeContentType(String(contentType));
    if (provided && provided !== expected) return null;
    return {
        name: base,
        contentType: expected,
        extension,
        kind: expected.startsWith('image/') ? 'image' : 'video',
    };
}

/** Декодирует base64 из JSON/CLI и проверяет размер. */
const CONTENT_TYPE_ALIASES: Record<string, string> = {
    'image/jpg': 'image/jpeg',
    'image/pjpeg': 'image/jpeg',
    'video/x-m4v': 'video/mp4',
    'video/x-ogg': 'video/ogg',
};

function normalizeContentType(value: string): string {
    const type = value.split(';')[0]!.trim().toLowerCase();
    return CONTENT_TYPE_ALIASES[type] ?? type;
}

export function decodeAttachment(data: string): Buffer {
    const clean = String(data ?? '').replace(/\s+/g, '');
    if (!clean || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
        throw new Error('вложение: ожидался base64');
    }
    const buffer = Buffer.from(clean, 'base64');
    if (!buffer.length) throw new Error('вложение пустое');
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(`вложение больше ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} МБ`);
    }
    return buffer;
}

/** Проверяет сигнатуру, чтобы расширение не расходилось с содержимым. */
export function matchesSignature(buffer: Buffer, contentType: string): boolean {
    if (contentType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (contentType === 'image/jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (contentType === 'image/gif') return buffer.subarray(0, 4).toString('latin1') === 'GIF8';
    if (contentType === 'image/webp') return buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
    if (contentType === 'image/avif') return buffer.subarray(4, 8).toString('latin1') === 'ftyp';
    if (contentType === 'video/webm') return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (contentType === 'video/ogg') return buffer.subarray(0, 4).toString('latin1') === 'OggS';
    if (contentType === 'video/mp4' || contentType === 'video/quicktime') return buffer.subarray(4, 8).toString('latin1') === 'ftyp';
    return false;
}
