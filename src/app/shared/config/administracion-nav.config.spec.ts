import { ADMINISTRACION_NAV } from './administracion-nav.config';

// RED first: this file imports a module that does not exist yet
// (`./administracion-nav.config`) — it must fail to compile/run until the
// GREEN step creates it. Asserts the exact shared shape both SidebarComponent
// (Numo shell) and the new Lealtad shell must render identically (spec
// requirement "Shared Administración Section").
describe('ADMINISTRACION_NAV', () => {
  it('exposes the "Administración" section label', () => {
    expect(ADMINISTRACION_NAV.label).toBe('Administración');
  });

  it('lists the exact 4 entries currently hardcoded in SidebarComponent, each gated by its own permission', () => {
    expect(ADMINISTRACION_NAV.items.map(i => i.route)).toEqual([
      '/users', '/entities', '/config', '/system-monitor',
    ]);
    expect(ADMINISTRACION_NAV.items.map(i => i.permissions)).toEqual([
      ['users:manage'], ['entities:read'], ['config:manage', 'loyalty:config'], ['system:monitor:read'],
    ]);
  });

  it('every item has a non-empty label and icon (rendered by both shells)', () => {
    for (const item of ADMINISTRACION_NAV.items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });
});
