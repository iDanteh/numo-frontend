import { Component, ElementRef, EventEmitter, Input, Output, QueryList, ViewChildren } from '@angular/core';
import { PermissionOption } from '../../../../core/services/user.service';

export interface PermGroup {
  module: string;
  perms:  PermissionOption[];
}

/**
 * Checklist de permisos agrupados por módulo, con buscador interno — compartido
 * entre el modal "Editar rol" (interactiveHeader, sin permisos deshabilitados) y el
 * modal "Permisos extra" (header plano, permisos ya dados por el rol deshabilitados
 * con badge). Antes vivía duplicado en los dos modales; la duplicación fue la causa
 * de un bug real (trackBy faltante en una de las dos copias).
 */
@Component({
  standalone: false,
  selector: 'app-permisos-checklist',
  templateUrl: './permisos-checklist.component.html',
})
export class PermisosChecklistComponent {
  @Input() groups: PermGroup[] = [];
  @Input() search = '';
  @Output() searchChange = new EventEmitter<string>();

  @Input() isChecked:  (key: string) => boolean = () => false;
  @Input() isDisabled: (key: string) => boolean = () => false;
  @Input() disabledBadgeText: string | null = null;

  /** true = header de módulo clickeable con dot de estado y "Seleccionar/Quitar todos" (rol). */
  @Input() interactiveHeader = false;

  @Output() permToggle       = new EventEmitter<string>();
  @Output() moduleHeaderClick = new EventEmitter<string>();

  @ViewChildren('moduleCard') private moduleCards!: QueryList<ElementRef<HTMLElement>>;

  onSearchInput(value: string): void {
    this.searchChange.emit(value);
  }

  /**
   * Salta directo a un módulo sin tener que scrollear toda la lista — con 15+ módulos
   * en el catálogo, buscar "Bancos" a mano para tocar 2 permisos era la fricción real.
   * Si había una búsqueda activa, se limpia primero (si no, el módulo podría estar
   * oculto por el filtro) y se espera un tick para que el DOM ya refleje `groups` completo.
   */
  scrollToModule(module: string): void {
    if (this.search) this.onSearchInput('');
    setTimeout(() => {
      const idx = this.groups.findIndex(g => g.module === module);
      this.moduleCards?.toArray()[idx]?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  get filteredGroups(): PermGroup[] {
    const q = this.search.toLowerCase().trim();
    if (!q) return this.groups;
    return this.groups
      .map(g => ({
        module: g.module,
        perms: g.perms.filter(p =>
          p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q),
        ),
      }))
      .filter(g => g.perms.length > 0);
  }

  moduleCheckedCount(group: PermGroup): number {
    return group.perms.filter(p => this.isChecked(p.key)).length;
  }

  moduleSelectionState(group: PermGroup): 'all' | 'partial' | 'none' {
    const checked = this.moduleCheckedCount(group);
    if (checked === 0) return 'none';
    if (checked === group.perms.length) return 'all';
    return 'partial';
  }

  trackByModule(_: number, group: PermGroup): string { return group.module; }
  trackByPermKey(_: number, p: PermissionOption): string { return p.key; }
}
