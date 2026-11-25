export interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    prerelease: string[];
}

/** Разбирает `x.y.z` с необязательными `-pre` и `+build`; мусор возвращает null. */
export function parseVersion(value: string): ParsedVersion | null {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
    if (!match) return null;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ? match[4].split('.') : [],
    };
}

function comparePrerelease(left: string[], right: string[]): number {
    if (!left.length && !right.length) return 0;
    // Версия без prerelease новее той же версии с prerelease.
    if (!left.length) return 1;
    if (!right.length) return -1;
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const a = left[index];
        const b = right[index];
        if (a === undefined) return -1;
        if (b === undefined) return 1;
        const aNumeric = /^\d+$/.test(a);
        const bNumeric = /^\d+$/.test(b);
        if (aNumeric && bNumeric) {
            const delta = Number(a) - Number(b);
            if (delta !== 0) return delta < 0 ? -1 : 1;
        } else if (aNumeric !== bNumeric) {
            // Числовые идентификаторы младше буквенных.
            return aNumeric ? -1 : 1;
        } else {
            const delta = a < b ? -1 : a > b ? 1 : 0;
            if (delta !== 0) return delta;
        }
    }
    return 0;
}

/** Сравнение в стиле semver: <0, 0 или >0. Невалидные версии считаются равными. */
export function compareVersions(left: string, right: string): number {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b) return 0;
    const delta = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
    if (delta !== 0) return delta < 0 ? -1 : 1;
    return comparePrerelease(a.prerelease, b.prerelease);
}

export function isNewerVersion(latest: string, current: string): boolean {
    return compareVersions(latest, current) > 0;
}
