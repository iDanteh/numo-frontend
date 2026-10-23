import { Component } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

@Component({
  standalone: false,
  selector: 'app-reportes-hub',
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">Reportes</div>
          <div class="page-subtitle">Selecciona el tipo de reporte que deseas consultar</div>
        </div>
      </div>
      <div style="display:flex; gap:1rem; flex-wrap:wrap; margin-top:1rem;">
        <!-- "CFDIs con Pagos Asociados" y "Depósitos Ingresos" ocultos (2026-10-22,
             pedido del usuario) — sus rutas siguen en ReportesModule. -->
        <a *ngIf="puede('reportes:por-facturar')" routerLink="por-facturar" class="report-card">
          <div class="report-card__icon">🧾</div>
          <div class="report-card__title">Por facturar</div>
          <div class="report-card__desc">Igual que la pestaña MOSTRADOR de la póliza: facturas globales, PPD ya facturado a nombre del cliente y depósitos pendientes de generar factura. Por día o rango, con historial.</div>
        </a>
        <a *ngIf="puede('visor:reports')" routerLink="cierre-de-mes" class="report-card">
          <div class="report-card__icon">🔒</div>
          <div class="report-card__title">Cierre de Mes</div>
          <div class="report-card__desc">Historial de reportes generados al cerrar cada mes. Redescarga cualquier cierre anterior.</div>
        </a>
      </div>
    </div>
    <style>
    .report-card {
      display:flex; flex-direction:column; gap:.5rem;
      background:#fff; border:1px solid var(--gray-100,#e2e8f0);
      border-radius:.75rem; padding:1.5rem; width:280px;
      text-decoration:none; color:inherit;
      transition:box-shadow .15s, border-color .15s;
      cursor:pointer;
    }
    .report-card:hover { box-shadow:0 4px 16px rgba(0,0,0,.08); border-color:#3b82f6; }
    .report-card__icon { font-size:2rem; }
    .report-card__title { font-weight:700; font-size:.95rem; color:#1e293b; }
    .report-card__desc  { font-size:.8rem; color:#64748b; line-height:1.4; }
    </style>
  `,
})
export class ReportesHubComponent {
  constructor(private auth: AuthService) {}

  /** Cada tarjeta se muestra solo con su permiso ("Por facturar" tiene uno propio). */
  puede(permiso: string): boolean {
    return this.auth.hasPermission(permiso);
  }
}
