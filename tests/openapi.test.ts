import { describe, expect, it } from 'vitest';
import { openApiPathRegExp, parseOpenApi, renderOpenApiSummary } from '../src/core/openapi.js';

const SPEC = `openapi: 3.1.0
info:
  title: Refunds API
  version: 1.2.0
paths:
  /refunds:
    post:
      operationId: createRefund
      summary: Create a refund
      parameters:
        - name: Idempotency-Key
          in: header
          required: true
          schema: { type: string }
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RefundRequest'
      responses:
        '200':
          description: Existing refund
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Refund'
        '409':
          description: Duplicate
components:
  schemas:
    RefundRequest:
      type: object
      required: [amount, idempotency_key]
      properties:
        amount: { type: number }
        idempotency_key: { type: string }
    Refund:
      type: object
      properties:
        id: { type: string }
        amount: { type: number }
`;

describe('OpenAPI contract', () => {
    it('parses operations, parameters, bodies and responses', () => {
        const parsed = parseOpenApi(SPEC);
        expect(parsed.kind).toBe('openapi');
        const summary = parsed.summary!;
        expect(summary.title).toBe('Refunds API');
        expect(summary.specVersion).toBe('3.1.0');
        expect(summary.operations).toHaveLength(1);
        const operation = summary.operations[0]!;
        expect(operation).toMatchObject({ method: 'POST', path: '/refunds', operationId: 'createRefund' });
        expect(operation.parameters[0]).toMatchObject({ name: 'Idempotency-Key', location: 'header', required: true, type: 'string' });
        expect(operation.requestBody).toContain('amount:number!');
        expect(operation.responses.map((response) => response.status)).toEqual(['200', '409']);
        expect(summary.schemas.find((schema) => schema.name === 'RefundRequest')?.properties).toHaveLength(2);
    });

    it('renders a compact readable summary', () => {
        const parsed = parseOpenApi(SPEC);
        const rendered = renderOpenApiSummary(parsed.summary!);
        expect(rendered).toContain('POST /refunds');
        expect(rendered).toContain('Idempotency-Key');
        expect(rendered).toContain('RefundRequest');
        expect(rendered).toContain('Refund');
    });

    it('returns markdown for a non-OpenAPI contract', () => {
        expect(parseOpenApi('# Contract\nPOST /refunds').kind).toBe('markdown');
    });

    it('matches parameterized paths in changed lines', () => {
        const pattern = openApiPathRegExp('/refunds/{id}');
        expect(pattern.test("fetch('/refunds/42')")).toBe(true);
        expect(pattern.test("fetch('/refunds')")).toBe(false);
    });

    it('uses path boundaries and ignores the root path', () => {
        const pattern = openApiPathRegExp('/refunds');
        expect(pattern.test("fetch('/refunds')")).toBe(true);
        expect(pattern.test("fetch('/refunds/42')")).toBe(true);
        expect(pattern.test("fetch('/refunds-old')")).toBe(false);
        expect(openApiPathRegExp('/').test('anything /')).toBe(false);
    });

    it('rejects Swagger 2.0 with a clear error', () => {
        const parsed = parseOpenApi(`swagger: '2.0'
info: { title: Legacy, version: '1' }
paths:
  /refunds:
    post:
      responses:
        '200': { description: ok }
`);
        expect(parsed.kind).toBe('openapi');
        expect(parsed.error).toMatch(/Swagger 2\.0|OpenAPI 3/);
    });
});
