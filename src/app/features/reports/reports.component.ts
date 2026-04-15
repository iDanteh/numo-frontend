import { Component } from '@angular/core';
import { ComparisonFacade } from '../../core/facades';

@Component({
  standalone: false,
  selector: 'app-reports',
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">Reportes</div>
          <div class="page-subtitle">Exporta información del sistema en formato Excel</div>
        </div>
      </div>
      <div class="table-card">
        <div class="card-body">
          <div class="mb-2 font-semibold">Exportar Comparaciones</div>
          <p class="text-muted mb-4" style="font-size:0.875rem;">Descarga un Excel con todas las comparaciones y su estado.</p>
          <button (click)="exportExcel()" [disabled]="loading" class="btn btn-primary">
            {{ loading ? 'Generando...' : '↓ Descargar Excel' }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ReportsComponent {
  loading = false;

  constructor(private comparisonFacade: ComparisonFacade) {}

  exportExcel(): void {
    this.loading = true;
    this.comparisonFacade.exportExcel().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reporte_cfdis_${Date.now()}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }
}
