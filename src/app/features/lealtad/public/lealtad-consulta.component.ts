import { Component, OnDestroy } from '@angular/core';
import { LoyaltyService, LoyaltyConsultaPublicaResult } from '../../../core/services/loyalty.service';
import { TELEFONO_RE } from '../lealtad.constants';

const CODIGO_RE = /^\d{6}$/;
// Validación de formato en el cliente, solo para evitar un viaje de red con algo obviamente mal
// tipeado — el backend reigualmente valida (ver EMAIL_RE en loyalty-recovery.service.js).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Spec loyalty-public-lookup "Generic Error, No Field Disclosure" — UN SOLO
// mensaje para teléfono desconocido, código incorrecto/expirado, tarjeta
// bloqueada o inactiva, o formato inválido. Nunca distinguir la causa.
const GENERIC_ERROR = 'El código no es válido o expiró. Solicitá uno nuevo.';

// El error de formato de email SÍ se distingue (2026-11-09) — no es parte del threat model de
// enumeración/fuerza bruta (no revela nada sobre teléfono/sesión), es validación de formulario
// común. Nunca se muestra el texto que manda el backend (misma convención que el resto de esta
// pantalla): branch por `code`, mensaje propio en los dos casos.
const EMAIL_ERROR_FORMATO = 'Ingresá un correo electrónico válido.';
const EMAIL_ERROR_GENERICO = 'No pudimos guardar tu correo. Intentá de nuevo.';

type Paso = 'telefono' | 'codigo';

/**
 * Consulta pública (/lealtad/consulta, sin guard — ver app-routing.module.ts
 * D14). POST, nunca GET (D8: el middleware de tráfico registra la URL
 * completa en respuestas de error, y un GET filtraría el teléfono/código
 * ahí). Respuesta: nombre, nivel, saldoPuntos y, desde 2026-11-03 (pedido
 * explícito del usuario), un historial recortado de movimientos
 * (fecha/tipoLabel/puntos/saldoAnterior/saldoActual) — spec "Minimal
 * Response Payload" sigue aplicando al resto del contrato: NUNCA
 * reasonId/usuarioId/justificacion/referenciaExterna ni otro campo interno
 * (ver loyalty-ledger.service.js#listarMovimientosPublicos en el backend).
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
 *
 * Reingreso transparente (2026-11-09, pedido explícito del usuario — reemplaza un botón "Ver de
 * nuevo" que se había construido antes y se descartó): al confirmar el código, el token de sesión
 * se persiste en `localStorage` (ver guardarSesionLocal/leerSesionLocal/borrarSesionLocal). Si el
 * cliente sale ("Salir") y vuelve a tipear el MISMO celular, `iniciarConsulta()` prueba
 * `verConsultaSesion()` ANTES de pedir un código nuevo — si todavía hay usos/vigencia, salta
 * directo al saldo, sin botón ni paso intermedio. Si el backend lo rechaza (expiró/se agotó/nunca
 * existió), cae al camino de siempre (pedir código) de forma transparente, mismo error genérico.
 * `nuevaConsulta()` ("Salir") limpia el estado visible pero NUNCA el `localStorage` — si lo
 * borrara, el reingreso del mismo número nunca podría saltarse el código.
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

  // ── Sesión de consulta post-código (2026-11-09) ───────────────────────────
  // Token emitido por confirmarCodigoConsulta/verConsultaSesion — null cuando no hay sesión
  // vigente (recién llegado, sesión agotada/expirada, o tras "Salir"). Persistido en localStorage
  // (ver guardarSesionLocal) para que el reingreso del MISMO teléfono lo recupere — ver docstring
  // de la clase.
  private sesionToken: string | null = null;
  usosRestantes = 0;

  email = '';
  emailLoading = false;
  emailError = '';
  emailGuardado = false;
  // Correo ya registrado (de esta sesión o de una anterior, ver emailContacto en la respuesta del
  // backend) — bloqueado/opaco hasta que el cliente pide "Actualizar" (2026-11-09).
  emailBloqueado = false;

  // Clave única de localStorage — un solo teléfono con sesión activa a la vez (pantalla de un solo
  // uso por dispositivo, no hace falta soportar varios simultáneos).
  private static readonly SESION_STORAGE_KEY = 'lealtad-consulta-sesion';

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

  /** Handler del botón de envío en paso 'telefono' (2026-11-09, reemplaza la llamada directa a
   *  solicitarCodigo()). Si hay una sesión guardada en localStorage para ESTE MISMO teléfono,
   *  prueba `verConsultaSesion()` primero — éxito salta directo al saldo sin pasar por el paso de
   *  código; fallo (sesión inválida/expirada/agotada) cae al camino de siempre. Sin sesión
   *  guardada (o de otro teléfono), delega 100% en solicitarCodigo() de siempre — esa función es
   *  la única dueña de la validación de formato del teléfono, no se duplica acá. */
  iniciarConsulta(): void {
    if (this.loading) return;
    const telefono = this.telefono.trim();
    const tokenGuardado = this.leerSesionLocal(telefono);

    if (!tokenGuardado) {
      this.solicitarCodigo();
      return;
    }

    this.error = '';
    this.loading = true;
    this.loyalty.verConsultaSesion(telefono, tokenGuardado).subscribe({
      next: (res) => {
        this.loading = false;
        this.result = res;
        this.usosRestantes = res.usosRestantes;
        this.email = res.emailContacto ?? '';
        this.emailBloqueado = !!res.emailContacto;
        this.animarSaldo(res.saldoPuntos);
        if (this.usosRestantes > 0) {
          this.sesionToken = tokenGuardado;
          this.guardarSesionLocal(telefono, tokenGuardado);
        } else {
          this.sesionToken = null;
          this.borrarSesionLocal();
        }
      },
      // Mismo error genérico que consultar()/verConsultaSesion de siempre — la sesión local ya no
      // es confiable, se descarta y se cae al camino normal de pedir un código.
      error: () => {
        this.loading = false;
        this.borrarSesionLocal();
        this.solicitarCodigo();
      },
    });
  }

  // ── Persistencia de la sesión en el dispositivo (2026-11-09) ──────────────────────────────
  // try/catch defensivo: localStorage puede fallar (modo privado del navegador, cuota, bloqueo de
  // sitio) — nunca debe romper el flujo real, en el peor caso el cliente simplemente vuelve a
  // pedir un código la próxima vez, como si esta feature no existiera.
  private guardarSesionLocal(telefono: string, token: string): void {
    try {
      localStorage.setItem(
        LealtadConsultaComponent.SESION_STORAGE_KEY,
        JSON.stringify({ telefono, token }),
      );
    } catch { /* no crítico, ver comentario de arriba */ }
  }

  private leerSesionLocal(telefono: string): string | null {
    try {
      const raw = localStorage.getItem(LealtadConsultaComponent.SESION_STORAGE_KEY);
      if (!raw) return null;
      const datos = JSON.parse(raw) as { telefono?: string; token?: string };
      return datos.telefono === telefono && datos.token ? datos.token : null;
    } catch {
      return null;
    }
  }

  private borrarSesionLocal(): void {
    try { localStorage.removeItem(LealtadConsultaComponent.SESION_STORAGE_KEY); } catch { /* no crítico */ }
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

    const telefono = this.telefono.trim();
    this.loading = true;
    this.loyalty.confirmarCodigoConsulta(telefono, codigo).subscribe({
      next: (res) => {
        this.loading = false;
        this.result = res;
        // Sesión de consulta (2026-11-09) — token en texto plano UNA sola vez, igual que
        // codigoDev arriba: se persiste en localStorage (ver guardarSesionLocal), nunca se loguea.
        this.sesionToken = res.token ?? null;
        this.usosRestantes = res.usosRestantes ?? 0;
        this.email = res.emailContacto ?? '';
        this.emailBloqueado = !!res.emailContacto;
        this.animarSaldo(res.saldoPuntos);
        if (this.sesionToken && this.usosRestantes > 0) {
          this.guardarSesionLocal(telefono, this.sesionToken);
        } else {
          this.borrarSesionLocal();
        }
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

  /** Deja o actualiza un correo de contacto futuro (2026-11-09) — opcional, el cliente puede
   *  ignorarlo. Requiere la sesión abierta por consultar()/iniciarConsulta(), pero NO la consume
   *  (no toca usosRestantes). Al guardar con éxito, el campo vuelve a quedar bloqueado/opaco — ver
   *  actualizarEmail() para desbloquearlo de nuevo. */
  guardarEmail(): void {
    if (this.emailLoading || !this.sesionToken) return;
    const email = this.email.trim();
    this.emailError = '';
    this.emailGuardado = false;

    if (!EMAIL_RE.test(email)) {
      this.emailError = EMAIL_ERROR_FORMATO;
      return;
    }

    this.emailLoading = true;
    this.loyalty.guardarEmailConsulta(this.telefono.trim(), this.sesionToken, email).subscribe({
      next: (res) => {
        this.emailLoading = false;
        this.emailGuardado = true;
        this.email = res.emailContacto;
        this.emailBloqueado = true;
      },
      // Acá SÍ se distingue el `code` (no el texto) — formato inválido no es parte del threat
      // model de enumeración (ver EMAIL_ERROR_FORMATO arriba), cualquier otra causa (sesión
      // expirada/agotada, red) comparte el mensaje genérico de siempre.
      error: (err: { error?: { code?: string } }) => {
        this.emailLoading = false;
        this.emailError = err?.error?.code === 'LOYALTY_EMAIL_INVALIDO' ? EMAIL_ERROR_FORMATO : EMAIL_ERROR_GENERICO;
      },
    });
  }

  /** Desbloquea un correo ya registrado para editarlo (2026-11-09) — el valor actual queda
   *  precargado en el input, el cliente lo modifica y vuelve a llamar guardarEmail(). */
  actualizarEmail(): void {
    this.emailBloqueado = false;
    this.emailError = '';
    this.emailGuardado = false;
  }

  reintentarSolicitud(): void {
    this.paso = 'telefono';
    this.codigo = '';
    this.error = '';
    this.mensajeSolicitud = '';
    this.codigoDev = null;
  }

  /** "Salir" — resetea el estado VISIBLE del componente (vuelve a paso 'telefono', limpia el
   *  teléfono tipeado, el resultado, etc.). NUNCA borra la sesión guardada en localStorage
   *  (ver resetSesionYEmail) — si la borrara, reingresar el MISMO teléfono nunca podría saltarse
   *  el código, que es justo el punto de la sesión post-código (ver docstring de la clase). */
  nuevaConsulta(): void {
    this.paso = 'telefono';
    this.telefono = '';
    this.codigo = '';
    this.result = null;
    this.error = '';
    this.mensajeSolicitud = '';
    this.codigoDev = null;
    this.resetSesionYEmail();
    this.cancelarAnimacionSaldo();
    this.saldoAnimado = 0;
  }

  /** Limpia el estado EN MEMORIA de la sesión/email (nunca el localStorage, ver nuevaConsulta). */
  private resetSesionYEmail(): void {
    this.sesionToken = null;
    this.usosRestantes = 0;
    this.email = '';
    this.emailError = '';
    this.emailGuardado = false;
    this.emailBloqueado = false;
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
