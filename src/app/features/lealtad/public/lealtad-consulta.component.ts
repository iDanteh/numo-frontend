import { Component, OnDestroy } from '@angular/core';
import { LoyaltyService, LoyaltyConsultaPublicaResult } from '../../../core/services/loyalty.service';
import { TELEFONO_RE } from '../lealtad.constants';

const CODIGO_RE = /^\d{6}$/;

// Spec loyalty-public-lookup "Generic Error, No Field Disclosure" — UN SOLO
// mensaje para teléfono desconocido, código incorrecto/expirado, tarjeta
// bloqueada o inactiva, o formato inválido. Nunca distinguir la causa.
const GENERIC_ERROR = 'El código no es válido o expiró. Solicitá uno nuevo.';

type Paso = 'telefono' | 'codigo';

/**
 * Consulta pública (/lealtad/consulta, sin guard — ver app-routing.module.ts
 * D14). POST, nunca GET (D8: el middleware de tráfico registra la URL
 * completa en respuestas de error, y un GET filtraría el teléfono/código
 * ahí). Respuesta mínima: nombre, nivel, saldoPuntos — SIN actividad
 * reciente (spec "Minimal Response Payload").
 *
 * 2026-10-26: reemplaza el NIP estático de 4 dígitos por un código de
 * verificación (OTP) enviado por el proveedor de mensajería, en 2 pasos
 * (`solicitarCodigoRecuperacion` + `confirmarCodigoConsulta`, ver
 * loyalty.service.ts), todavía en modo SIMULACIÓN (sin proveedor real
 * conectado, ver banner `codigoDev`). El NIP estático sigue existiendo solo
 * para uso interno de staff (tarjeta-detail), no se toca acá. El flujo
 * público "recuperar NIP olvidado" (RecuperarNipComponent, modelo original
 * de esta pantalla de 2 pasos) se eliminó el mismo día — ver memoria
 * project_lealtad_consulta_publica_otp.
 */
@Component({
  standalone: false,
  selector: 'app-lealtad-consulta',
  templateUrl: './lealtad-consulta.component.html',
  styleUrls: ['./lealtad-consulta.component.css'],
})
export class LealtadConsultaComponent implements OnDestroy {
  paso: Paso = 'telefono';
  telefono = '';
  codigo = '';
  loading = false;
  error = '';
  result: LoyaltyConsultaPublicaResult | null = null;

  mensajeSolicitud = '';
  /** SIMULACIÓN TEMPORAL — ver loyalty-recovery.service.js#solicitarCodigo. */
  codigoDev: string | null = null;

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

  solicitarCodigo(): void {
    if (this.loading) return;
    const telefono = this.telefono.trim();
    this.error = '';

    if (!TELEFONO_RE.test(telefono)) {
      this.error = 'Ingresá un celular válido de 10 dígitos.';
      return;
    }

    this.loading = true;
    this.loyalty.solicitarCodigoRecuperacion(telefono).subscribe({
      next: (res) => {
        this.loading = false;
        this.mensajeSolicitud = res.mensaje;
        this.codigoDev = res.codigoDev ?? null;
        this.paso = 'codigo';
      },
      // El endpoint de solicitud nunca responde error por "no encontrado"
      // (anti-enumeración) — un error acá es de verdad infraestructura/red.
      error: () => {
        this.loading = false;
        this.error = 'No pudimos procesar tu solicitud. Intentá de nuevo en unos minutos.';
      },
    });
  }

  consultar(): void {
    if (this.loading) return;
    const codigo = this.codigo.trim();
    this.error = '';

    if (!CODIGO_RE.test(codigo)) {
      this.error = GENERIC_ERROR;
      return;
    }

    this.loading = true;
    this.loyalty.confirmarCodigoConsulta(this.telefono.trim(), codigo).subscribe({
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

  reintentarSolicitud(): void {
    this.paso = 'telefono';
    this.codigo = '';
    this.error = '';
    this.mensajeSolicitud = '';
    this.codigoDev = null;
  }

  nuevaConsulta(): void {
    this.paso = 'telefono';
    this.telefono = '';
    this.codigo = '';
    this.result = null;
    this.error = '';
    this.mensajeSolicitud = '';
    this.codigoDev = null;
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
