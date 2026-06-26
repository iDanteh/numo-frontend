import { Component } from '@angular/core';

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
        <a routerLink="pagos-banco" class="report-card">
          <div class="report-card__icon">💳</div>
          <div class="report-card__title">CFDIs con Pagos Asociados</div>
          <div class="report-card__desc">Cruza complementos de pago con movimientos bancarios. Identifica CFDIs con y sin depósito vinculado.</div>
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
export class ReportesHubComponent {}
