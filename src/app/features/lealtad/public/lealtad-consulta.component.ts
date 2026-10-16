import { Component } from '@angular/core';
import { LoyaltyService, LoyaltyConsultaPublicaResult } from '../../../core/services/loyalty.service';

const TELEFONO_RE = /^\d{10}$/;
const NIP_RE = /^\d{4}$/;

// Spec loyalty-public-lookup "Generic Error, No Field Disclosure" — UN SOLO
// mensaje para teléfono desconocido, NIP incorrecto, tarjeta bloqueada,
// tarjeta inactiva o formato inválido. Nunca distinguir la causa.
const GENERIC_ERROR = 'No encontramos una tarjeta con ese celular y NIP. Verifica los datos e intenta de nuevo.';

/**
 * Consulta pública (/lealtad/consulta, sin guard — ver app-routing.module.ts
 * D14). Reemplaza el placeholder de PR5. POST, nunca GET (D8: el middleware
 * de tráfico registra la URL completa en respuestas de error, y un GET
 * filtraría el NIP ahí). Respuesta mínima: nombre, nivel, saldoPuntos — SIN
 * actividad reciente (spec "Minimal Response Payload", confirmado con el
 * usuario 2026-10-15, ver specs/loyalty-public-lookup/spec.md actualizado).
 */
@Component({
  standalone: false,
  selector: 'app-lealtad-consulta',
  templateUrl: './lealtad-consulta.component.html',
  styleUrls: ['./lealtad-consulta.component.css'],
})
export class LealtadConsultaComponent {
  telefono = '';
  nip = '';
  loading = false;
  error = '';
  result: LoyaltyConsultaPublicaResult | null = null;

  constructor(private loyalty: LoyaltyService) {}

  consultar(): void {
    if (this.loading) return;
    const telefono = this.telefono.trim();
    const nip = this.nip.trim();
    this.error = '';
    this.result = null;

    // Validación de formato local — usa el MISMO mensaje genérico que
    // cualquier otra causa de fallo (spec: nunca revelar qué campo está mal).
    if (!TELEFONO_RE.test(telefono) || !NIP_RE.test(nip)) {
      this.error = GENERIC_ERROR;
      return;
    }

    this.loading = true;
    this.loyalty.consultaPublica(telefono, nip).subscribe({
      next: (res) => {
        this.loading = false;
        this.result = res;
      },
      // Nunca propagar err?.error?.error acá (a diferencia del resto de la
      // app, house convention) — el backend siempre manda el mismo mensaje
      // para 422 (D8), pero esta pantalla no distingue NI siquiera un 429 o
      // un error de red: un solo texto, sin importar la causa.
      error: () => {
        this.loading = false;
        this.error = GENERIC_ERROR;
      },
    });
  }

  nuevaConsulta(): void {
    this.telefono = '';
    this.nip = '';
    this.result = null;
    this.error = '';
  }
}
