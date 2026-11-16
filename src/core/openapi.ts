import { parse as parseYaml } from 'yaml';
import { tr } from './locale.js';

export interface OpenApiParameter {
    name: string;
    location: string;
    required: boolean;
    type: string;
}

export interface OpenApiResponse {
    status: string;
    description: string;
    schema: string;
}

export interface OpenApiOperation {
    method: string;
    path: string;
    operationId: string;
    summary: string;
    parameters: OpenApiParameter[];
    requestBody: string;
    responses: OpenApiResponse[];
}

export interface OpenApiProperty {
    name: string;
    type: string;
    required: boolean;
}

export interface OpenApiSchema {
    name: string;
    properties: OpenApiProperty[];
}

export interface OpenApiSummary {
    title: string;
    version: string;
    specVersion: string;
    operations: OpenApiOperation[];
    schemas: OpenApiSchema[];
}

export interface ContractParse {
    kind: 'openapi' | 'markdown';
    summary?: OpenApiSummary;
    error?: string;
}

type Json = Record<string, unknown>;

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const;

function isRecord(value: unknown): value is Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function referenceName(schema: unknown): string {
    if (!isRecord(schema)) return '';
    const ref = schema.$ref;
    if (typeof ref === 'string') return ref.split('/').pop() ?? ref;
    const type = typeof schema.type === 'string' ? schema.type : '';
    const format = typeof schema.format === 'string' ? `(${schema.format})` : '';
    return `${type}${format}` || 'object';
}

function resolveSchema(schema: unknown, document: Json): unknown {
    if (!isRecord(schema) || typeof schema.$ref !== 'string') return schema;
    const name = schema.$ref.split('/').pop() ?? '';
    const components = isRecord(document.components) ? document.components : {};
    const schemas = isRecord(components.schemas) ? components.schemas : {};
    return schemas[name] ?? schema;
}

function propertiesOf(schema: unknown, document: Json): OpenApiProperty[] {
    const resolved = resolveSchema(schema, document);
    if (!isRecord(resolved) || !isRecord(resolved.properties)) return [];
    const required = new Set(Array.isArray(resolved.required) ? resolved.required.map(String) : []);
    return Object.entries(resolved.properties).slice(0, 40).map(([name, value]) => {
        const property = isRecord(value) ? value : {};
        const enumValues = Array.isArray(property.enum) ? property.enum.map(String).slice(0, 8) : [];
        return {
            name,
            type: enumValues.length ? `${referenceName(property)} enum(${enumValues.join('|')})` : referenceName(property),
            required: required.has(name),
        };
    });
}

function bodyLabel(schema: unknown, document: Json, expandReference = false): string {
    if (!isRecord(schema)) return '';
    const name = typeof schema.$ref === 'string' ? schema.$ref.split('/').pop() ?? 'object' : '';
    const properties = propertiesOf(schema, document);
    const fields = properties.length ? properties.map((item) => `${item.name}:${item.type}${item.required ? '!' : ''}`).join(', ') : '';
    if (name) return expandReference && fields ? `${name} (${fields})` : name;
    return fields || referenceName(schema);
}

function parametersOf(operation: Json, document: Json): OpenApiParameter[] {
    const raw = Array.isArray(operation.parameters) ? operation.parameters : [];
    return raw
        .map((value) => {
            const parameter = isRecord(value) ? value : {};
            const schema = isRecord(parameter.schema) ? parameter.schema : {};
            return {
                name: String(parameter.name ?? ''),
                location: String(parameter.in ?? ''),
                required: parameter.required === true,
                type: referenceName(schema),
            };
        })
        .filter((item) => item.name);
}

function responsesOf(operation: Json, document: Json): OpenApiResponse[] {
    const responses = isRecord(operation.responses) ? operation.responses : {};
    return Object.entries(responses)
        .slice(0, 20)
        .map(([status, value]) => {
            const response = isRecord(value) ? value : {};
            const content = isRecord(response.content) ? response.content : {};
            const first = Object.values(content)[0];
            const media = isRecord(first) ? first : {};
            return {
                status,
                description: String(response.description ?? ''),
                schema: bodyLabel(media.schema, document),
            };
        });
}

export function parseOpenApi(text: string): ContractParse {
    const trimmed = text.trim();
    if (!trimmed) return { kind: 'markdown' };
    let document: unknown;
    try {
        document = parseYaml(trimmed);
    } catch (error) {
        return trimmed.includes('openapi:') || trimmed.includes('swagger:')
            ? { kind: 'openapi', error: (error as Error).message }
            : { kind: 'markdown' };
    }
    if (!isRecord(document)) return { kind: 'markdown' };
    if (document.openapi === undefined && document.swagger !== undefined) {
        return {
            kind: 'openapi',
            error: tr(
                'Swagger 2.0 не поддерживается: приложите контракт OpenAPI 3.x',
                'Swagger 2.0 is not supported: provide an OpenAPI 3.x contract',
            ),
        };
    }
    if (typeof document.openapi !== 'string') return { kind: 'markdown' };
    const specVersion = document.openapi;
    const info = isRecord(document.info) ? document.info : {};
    const paths = isRecord(document.paths) ? document.paths : {};
    const operations: OpenApiOperation[] = [];
    for (const [path, value] of Object.entries(paths)) {
        if (!isRecord(value)) continue;
        for (const method of METHODS) {
            const operation = value[method];
            if (!isRecord(operation)) continue;
            const requestBody = isRecord(operation.requestBody) ? operation.requestBody : {};
            const content = isRecord(requestBody.content) ? requestBody.content : {};
            const firstMedia = Object.values(content)[0];
            const media = isRecord(firstMedia) ? firstMedia : {};
            operations.push({
                method: method.toUpperCase(),
                path,
                operationId: String(operation.operationId ?? ''),
                summary: String(operation.summary ?? ''),
                parameters: parametersOf(operation, document),
                requestBody: bodyLabel(media.schema, document, true),
                responses: responsesOf(operation, document),
            });
        }
    }
    const components = isRecord(document.components) ? document.components : {};
    const schemasObject = isRecord(components.schemas) ? components.schemas : {};
    const schemas: OpenApiSchema[] = Object.entries(schemasObject)
        .slice(0, 60)
        .map(([name, value]) => ({ name, properties: propertiesOf(value, document) }));
    return {
        kind: 'openapi',
        summary: {
            title: String(info.title ?? 'API'),
            version: String(info.version ?? ''),
            specVersion,
            operations: operations.slice(0, 120),
            schemas,
        },
    };
}

export function renderOpenApiSummary(summary: OpenApiSummary): string {
    const lines: string[] = [];
    lines.push(`## ${tr('API-контракт', 'API contract')}: ${summary.title}${summary.version ? ` ${summary.version}` : ''} (${summary.specVersion})`);
    if (!summary.operations.length) lines.push(tr('Операции не найдены.', 'No operations found.'));
    for (const operation of summary.operations) {
        lines.push('');
        lines.push(`### ${operation.method} ${operation.path}${operation.operationId ? ` (${operation.operationId})` : ''}`);
        if (operation.summary) lines.push(operation.summary);
        if (operation.parameters.length) {
            lines.push(
                `${tr('Параметры', 'Parameters')}: ` +
                    operation.parameters
                        .map((parameter) => `${parameter.name} (${parameter.location}${parameter.required ? ', required' : ''}, ${parameter.type})`)
                        .join(', '),
            );
        }
        if (operation.requestBody) lines.push(`${tr('Тело запроса', 'Request body')}: ${operation.requestBody}`);
        if (operation.responses.length) {
            lines.push(
                `${tr('Ответы', 'Responses')}: ` +
                    operation.responses
                        .map((response) => `${response.status}${response.schema ? ` → ${response.schema}` : ''}${response.description ? ` (${response.description})` : ''}`)
                        .join('; '),
            );
        }
    }
    if (summary.schemas.length) {
        lines.push('');
        lines.push(`## ${tr('Схемы', 'Schemas')}`);
        for (const schema of summary.schemas) {
            lines.push(`- **${schema.name}**: ${schema.properties.map((property) => `${property.name}:${property.type}${property.required ? '!' : ''}`).join(', ') || '—'}`);
        }
    }
    return lines.join('\n');
}

/** Путь OpenAPI -> regex, где `{param}` совпадает с одним сегментом URL. */
export function openApiPathRegExp(path: string): RegExp {
    if (path === '/') return /(?!)/;
    const escaped = path.replace(/\{[^}]+\}/g, '\u0000').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\u0000/g, '[^/?#\\s]+');
    return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`);
}
