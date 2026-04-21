import { Directive, Input, OnInit,
         TemplateRef, ViewContainerRef } from '@angular/core';
import { AuthService }                  from '../services/auth.service';

/**
 * HasRoleDirective — directiva estructural para mostrar/ocultar elementos por rol.
 *
 * Uso en template:
 *   <button *appHasRole="'admin'">Solo admin</button>
 *   <div *appHasRole="['admin', 'contabilidad']">Admin o contabilidad</div>
 *
 * El elemento NO se renderiza si el usuario no tiene el rol requerido.
 */
@Directive({ selector: '[appHasRole]', standalone: false })
export class HasRoleDirective implements OnInit {

  @Input() appHasRole: string | string[] = [];

  constructor(
    private templateRef:     TemplateRef<unknown>,
    private viewContainer:   ViewContainerRef,
    private auth:            AuthService,
  ) {}

  ngOnInit(): void {
    const roles = Array.isArray(this.appHasRole)
      ? this.appHasRole
      : [this.appHasRole];

    if (this.auth.hasRole(...roles)) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    } else {
      this.viewContainer.clear();
    }
  }
}
