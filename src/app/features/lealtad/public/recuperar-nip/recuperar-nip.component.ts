import { Component } from '@angular/core';
import { LoyaltyService } from '../../../../core/services/loyalty.service';
import { TELEFONO_RE } from '../../lealtad.constants';

const CODIGO_RE = /^\d{6}$/;

// Mismo criterio "Generic Error, No Field Disclosure" que LealtadConsultaComponent
// (spec loyalty-public-lookup) — un solo mensaje para código incorrecto, expirado,
// tarjeta bloqueada, teléfono desconocido o formato inválido. Nunca distinguir causa.
const GENERIC_ERROR = 'El código no es válido o expiró. Solicitá uno nuevo.';

type Paso = 'telefono' | 'codigo' | 'exito';

/**
 * Recuperación de NIP en 2 pasos (/lealtad/consulta/recuperar, sin guard —
 * mismo módulo público que LealtadConsultaComponent, D14). El cliente nunca
 * elige su propio NIP (mismo criterio que crearTarjeta/cambiarNip de staff):
 * al confirmar el código, el backend genera uno nuevo y lo muestra una sola
 * vez — igual que app-nip-reveal-modal del lado staff, pero como página
 * pública en vez de modal (acá no hay sesión ni shell).
 */
@Component({
  standalone: false,
  selector: 'app-recuperar-nip',
  templateUrl: './recuperar-nip.component.html',
  styleUrls: ['./recuperar-nip.component.css'],
})
export class RecuperarNipComponent {
  paso: Paso = 'telefono';
  loading = false;
  error = '';

  telefono = '';
  codigo = '';

  mensajeSolicitud = '';
  /** SIMULACIÓN TEMPORAL — ver loyalty.service.ts#solicitarCodigoRecuperacion. */
  codigoDev: string | null = null;

  nipNuevo = '';
  copiado = false;
  private copiadoTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private loyalty: LoyaltyService) {}

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

  confirmarCodigo(): void {
    if (this.loading) return;
    const codigo = this.codigo.trim();
    this.error = '';

    if (!CODIGO_RE.test(codigo)) {
      this.error = GENERIC_ERROR;
      return;
    }

    this.loading = true;
    this.loyalty.confirmarCodigoRecuperacion(this.telefono.trim(), codigo).subscribe({
      next: (res) => {
        this.loading = false;
        this.nipNuevo = res.nip;
        this.paso = 'exito';
      },
      // Mismo criterio que LealtadConsultaComponent: nunca propagar
      // err?.error?.error, un solo mensaje sin importar la causa (código
      // incorrecto, expirado, tarjeta bloqueada, 429, error de red).
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

  copiarNip(): void {
    navigator.clipboard?.writeText(this.nipNuevo).then(() => {
      this.copiado = true;
      if (this.copiadoTimeout) clearTimeout(this.copiadoTimeout);
      this.copiadoTimeout = setTimeout(() => { this.copiado = false; }, 1500);
    }).catch(() => { /* portapapeles no disponible — el NIP sigue visible para anotarlo a mano */ });
  }
}
