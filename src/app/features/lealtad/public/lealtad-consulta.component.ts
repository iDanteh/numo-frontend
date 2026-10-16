import { Component } from '@angular/core';

/**
 * Placeholder (PR5) — la UI pública real ("Celular (10 dígitos)" / "NIP (4
 * dígitos)", error genérico 422) llega en PR7 (Phase 7 de tasks.md). Esta
 * vista solo prueba que la ruta /lealtad/consulta resuelve sin guard y sin
 * el layout de staff (ver AppComponent.isPublicLealtad).
 */
@Component({
  standalone: false,
  selector: 'app-lealtad-consulta',
  templateUrl: './lealtad-consulta.component.html',
})
export class LealtadConsultaComponent {}
