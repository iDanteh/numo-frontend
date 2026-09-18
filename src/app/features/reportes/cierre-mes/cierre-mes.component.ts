import { Component, OnInit } from '@angular/core';
import { CierreMesService, CierreMesHistoricoRow } from '../../../core/services/cierre-mes.service';

@Component({
  standalone: false,
  selector: 'app-cierre-mes',
  templateUrl: './cierre-mes.component.html',
})
export class CierreMesComponent implements OnInit {
  rows:    CierreMesHistoricoRow[] = [];
  loading = false;
  descargandoId: number | null = null;

  constructor(private cierreMesService: CierreMesService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.cierreMesService.listCierres().subscribe({
      next: (res) => { this.rows = res.data; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  descargar(row: CierreMesHistoricoRow): void {
    this.descargandoId = row.id;
    this.cierreMesService.descargarCierre(row.id).subscribe({
      next: (blob) => {
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href  = url;
        link.download = row.filename;
        link.click();
        URL.revokeObjectURL(url);
        this.descargandoId = null;
      },
      error: () => { this.descargandoId = null; },
    });
  }

  formatSize(bytes: number): string {
    if (!bytes) return '—';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(0)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }
}
