import { Component, OnDestroy } from '@angular/core';
import { LoyaltyService, LoyaltyConsultaPublicaResult } from '../../../core/services/loyalty.service';
import { TELEFONO_RE } from '../lealtad.constants';

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
export class LealtadConsultaComponent implements OnDestroy {
  telefono = '';
  nip = '';
  loading = false;
  error = '';
  result: LoyaltyConsultaPublicaResult | null = null;

  // Conteo ascendente del saldo (único momento "de producto" de todo el
  // módulo — un cliente real viendo su puntaje). Respeta
  // prefers-reduced-motion igual que el resto de Lealtad: si está activo,
  // se muestra el valor final directo sin animar.
  saldoAnimado = 0;
  private saldoAnimFrame: number | null = null;

  constructor(private loyalty: LoyaltyService) {}

  // Rating visual de 3 estrellas (mockup de diseño) — se deriva del propio
  // `nivel` ya devuelto por el endpoint público, sin pedir ni exponer datos
  // adicionales (umbrales de puntos por nivel son config de negocio, no se
  // exponen a este endpoint anónimo).
  get tierRank(): number {
    if (!this.result) return 0;
    if (this.result.nivel === 'Oro') return 3;
    if (this.result.nivel === 'Plata') return 2;
    return 1;
  }

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
        this.animarSaldo(res.saldoPuntos);
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
    this.cancelarAnimacionSaldo();
    this.saldoAnimado = 0;
  }

  private animarSaldo(valor: number): void {
    this.cancelarAnimacionSaldo();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.saldoAnimado = valor;
      return;
    }
    const duracion = 700;
    const inicio = performance.now();
    const paso = (ahora: number) => {
      const progreso = Math.min(1, (ahora - inicio) / duracion);
      this.saldoAnimado = valor * progreso;
      if (progreso < 1) {
        this.saldoAnimFrame = requestAnimationFrame(paso);
      } else {
        this.saldoAnimado = valor;
        this.saldoAnimFrame = null;
      }
    };
    this.saldoAnimFrame = requestAnimationFrame(paso);
  }

  private cancelarAnimacionSaldo(): void {
    if (this.saldoAnimFrame != null) {
      cancelAnimationFrame(this.saldoAnimFrame);
      this.saldoAnimFrame = null;
    }
  }

  ngOnDestroy(): void {
    this.cancelarAnimacionSaldo();
  }
}
