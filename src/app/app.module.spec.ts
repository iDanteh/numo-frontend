import { isCacheableApiUri } from './app.module';

// Función PURA extraída del uriMatcher de AuthHttpInterceptor (mismo criterio
// que buildIdentificarPayload en collection-request.component.ts) — sin esto
// un NgModule-decorator inline arrow function no se puede probar en
// aislamiento. RED first: isCacheableApiUri no existe todavía en
// app.module.ts (D13 — excluir '/loyalty/public/' para que la consulta
// anónima no intente mandar un Bearer token).
describe('isCacheableApiUri (AuthHttpInterceptor uriMatcher logic)', () => {
  it('matches a normal staff API call — needs a Bearer token', () => {
    expect(isCacheableApiUri('/api/banks/movements', '/api')).toBe(true);
  });

  it('does NOT match a non-API url (e.g. an asset or external origin)', () => {
    expect(isCacheableApiUri('/assets/logo.png', '/api')).toBe(false);
  });

  it('excludes /api/loyalty/public/* — the anonymous consulta must never get a Bearer token attached (D13)', () => {
    expect(isCacheableApiUri('/api/loyalty/public/consulta', '/api')).toBe(false);
  });

  it('still matches the STAFF loyalty routes (no public/ segment)', () => {
    expect(isCacheableApiUri('/api/loyalty/cards', '/api')).toBe(true);
  });
});
